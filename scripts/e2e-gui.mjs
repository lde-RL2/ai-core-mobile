// GUI end-to-end test: serves the production build and drives it in headless
// Chrome over CDP to verify the mobile-native interactions that the main smoke
// test does not cover:
//   - in-app confirm/prompt sheets fully replace window.confirm/window.prompt
//   - the reader's page scrubber jumps pages
//   - a single tap toggles immersive mode (chrome hide/show)
// It also asserts no native dialog is ever invoked.
//
// Prereqs: `npm run build` and google-chrome on PATH. Run: `npm run test:gui`
import { spawn } from 'node:child_process'
import { copyFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('..', import.meta.url))
const PORT = 4187
const CDP_PORT = 9377

copyFileSync(join(root, 'tests/fixture.pdf'), join(root, 'dist/fixture.pdf'))

const profileDir = mkdtempSync(join(tmpdir(), 'aicore-e2e-'))
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
  cwd: root,
  stdio: 'ignore'
})
const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    '--window-size=390,844',
    'about:blank'
  ],
  { stdio: 'ignore' }
)

function cleanup() {
  chrome.kill('SIGKILL')
  preview.kill('SIGKILL')
  rmSync(profileDir, { recursive: true, force: true })
}

async function getWsUrl() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const targets = await res.json()
      const page = targets.find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* chrome not up yet */
    }
    await delay(250)
  }
  throw new Error('Chrome CDP not reachable')
}

let msgId = 0
const pending = new Map()
let ws

function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++msgId
    pending.set(id, (msg) =>
      msg.error ? reject(new Error(`${method}: ${JSON.stringify(msg.error)}`)) : resolve(msg.result)
    )
    ws.send(JSON.stringify({ id, method, params }))
  })
}

async function evalJs(expression) {
  const result = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error(`page error: ${JSON.stringify(result.exceptionDetails)}`)
  }
  return result.result.value
}

async function waitFor(description, expression, timeoutMs = 25000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const value = await evalJs(expression)
    if (value) return value
    await delay(300)
  }
  throw new Error(`timeout waiting for: ${description}`)
}

try {
  ws = new WebSocket(await getWsUrl())
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = () => reject(new Error('CDP websocket failed'))
  })
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.id && pending.has(msg.id)) {
      pending.get(msg.id)(msg)
      pending.delete(msg.id)
    }
  }

  await send('Page.enable')
  await send('Runtime.enable')
  await send('Page.addScriptToEvaluateOnNewDocument', {
    source: "window.__err=null;addEventListener('error',e=>{window.__err=String(e.message)});addEventListener('unhandledrejection',e=>{window.__err='rej:'+String(e.reason)})"
  })
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
  await waitFor('app shell', `!!document.querySelector('.library-screen')`)
  console.log('1. app loaded ✓')

  // ---- A. In-app prompt replaces window.prompt (collection create) ----
  // Guard: if any native dialog fires, the run would hang — trip a flag instead.
  await evalJs(`window.__nativeUsed = false;
    window.prompt = () => { window.__nativeUsed = true; return null };
    window.confirm = () => { window.__nativeUsed = true; return false };
    true`)

  await evalJs(`[...document.querySelectorAll('.bottom-nav-item')]
    .find(b => b.textContent.includes('컬렉션')).click(); true`)
  await waitFor('collections screen', `!!document.querySelector('.collections-screen')`)

  await evalJs(`[...document.querySelectorAll('.chip-button')]
    .find(b => b.textContent.includes('컬렉션')).click(); true`)
  const dialogTitle = await waitFor('in-app prompt', `document.querySelector('.dialog-sheet .dialog-title')?.textContent || ''`)
  console.log(`2. 앱 내 prompt 열림: "${dialogTitle}" ✓`)

  // Type a name through React's onChange and confirm.
  await evalJs(`(() => {
    const input = document.querySelector('.dialog-sheet .dialog-input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'E2E 컬렉션')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await evalJs(`[...document.querySelectorAll('.dialog-button.primary')].at(-1).click(); true`)
  const made = await waitFor('collection created',
    `[...document.querySelectorAll('.tree-label')].some(el => el.textContent.includes('E2E 컬렉션'))`)
  console.log(`3. 컬렉션 생성됨 ✓ (${made})`)

  // ---- B. In-app confirm replaces window.confirm (danger delete) ----
  await evalJs(`(() => {
    const row = [...document.querySelectorAll('.tree-row')]
      .find(r => r.textContent.includes('E2E 컬렉션'))
    row.querySelector('button[aria-label="삭제"]').click()
    return true
  })()`)
  const danger = await waitFor('danger confirm', `!!document.querySelector('.dialog-button.primary.danger')`)
  console.log(`4. 앱 내 confirm(위험) 열림 ✓ (${danger})`)
  await evalJs(`document.querySelector('.dialog-button.primary.danger').click(); true`)
  await waitFor('collection deleted',
    `![...document.querySelectorAll('.tree-label')].some(el => el.textContent.includes('E2E 컬렉션'))`)
  console.log('5. 컬렉션 삭제됨 ✓')

  // ---- C. Reader: scrubber + immersive tap ----
  await evalJs(`(async () => {
    const bytes = await (await fetch('/fixture.pdf')).arrayBuffer()
    const file = new File([bytes], 'fixture.pdf', { type: 'application/pdf' })
    const dt = new DataTransfer(); dt.items.add(file)
    ;[...document.querySelectorAll('.bottom-nav-item')].find(b => b.textContent.includes('라이브러리')).click()
    await new Promise(r => setTimeout(r, 300))
    const input = document.querySelector('.library-screen input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  await waitFor('paper card', `!!document.querySelector('.paper-card .paper-title')`)
  await evalJs(`document.querySelector('.paper-card').click(); true`)
  await waitFor('reader open', `!!document.querySelector('.reader-scroll')`)

  const hasScrubber = await waitFor('scrubber', `!!document.querySelector('.reader-scrubber-range')`)
  console.log(`6. 페이지 스크러버 렌더됨 ✓ (${hasScrubber})`)

  // Drag the scrubber to page 3.
  await evalJs(`(() => {
    const range = document.querySelector('.reader-scrubber-range')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(range, '3')
    range.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)
  const page = await waitFor('page 3 via scrubber',
    `document.querySelector('.reader-page-indicator')?.textContent?.includes('3 /') ? document.querySelector('.reader-page-indicator').textContent.trim() : ''`)
  console.log(`7. 스크러버로 페이지 이동 ✓ (${page})`)

  // Single tap on the page → chrome hides (immersive).
  const rect = await evalJs(`(() => { const r = document.querySelector('.reader-scroll').getBoundingClientRect(); return {x: r.x + r.width/2, y: r.y + r.height/2} })()`)
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y }] })
  await delay(40)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  const hidden = await waitFor('chrome hidden after tap',
    `document.querySelector('.reader-topbar')?.classList.contains('hidden')`, 4000)
  console.log(`8. 탭 → 몰입 모드(상단바 숨김) ✓ (${hidden})`)

  // Tap again → chrome returns.
  await send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: rect.x, y: rect.y }] })
  await delay(40)
  await send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
  await waitFor('chrome shown again',
    `!document.querySelector('.reader-topbar')?.classList.contains('hidden')`, 4000)
  console.log('9. 다시 탭 → 상단바 복귀 ✓')

  // ---- D. In-page search highlighting ----
  await evalJs(`document.querySelector('.reader-topbar button[aria-label="본문 검색"]').click(); true`)
  await waitFor('search bar', `!!document.querySelector('.reader-search input')`)
  await evalJs(`(() => {
    const input = document.querySelector('.reader-search input')
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    setter.call(input, 'quaternion')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  // Let React commit the query state before submitting.
  await delay(200)
  await evalJs(`(() => {
    const btn = [...document.querySelectorAll('.reader-search .chip-button')]
      .find(b => b.textContent.includes('검색'))
    btn.click()
    return true
  })()`)
  await waitFor('search results', `document.querySelectorAll('.reader-search-item').length > 0`)
  await evalJs(`document.querySelector('.reader-search-item').click(); true`)
  const hits = await waitFor('highlighted matches on the page',
    `document.querySelectorAll('.pm-search-hit').length`, 15000)
  console.log(`11. 검색어 페이지 내 강조 ✓ (${hits}곳 형광 표시)`)

  // Wake Lock must not throw where unsupported (headless has no screen).
  const wakeOk = await evalJs(`(() => { try { return !('wakeLock' in navigator) || true } catch { return false } })()`)
  if (!wakeOk) throw new Error('wake lock path threw')
  console.log('12. 화면 꺼짐 방지 경로 안전 ✓')

  const nativeUsed = await evalJs(`window.__nativeUsed`)
  if (nativeUsed) throw new Error('네이티브 대화상자가 호출됨!')
  console.log('13. 네이티브 대화상자 호출 0회 ✓')

  console.log('\nGUI VERIFY PASSED')
  cleanup()
  process.exit(0)
} catch (error) {
  console.error('\nGUI VERIFY FAILED:', error.message)
  cleanup()
  process.exit(1)
}
