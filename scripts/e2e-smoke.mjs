// End-to-end smoke test: serves the production build, drives it in headless
// Chrome over CDP, and exercises import → metadata extraction → reader
// rendering → reading-position restore → in-PDF search.
//
// Prereqs: `npm run build` and google-chrome on PATH. Run: `npm run test:e2e`
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
  await send('Page.navigate', { url: `http://127.0.0.1:${PORT}/` })
  await waitFor('app shell', `!!document.querySelector('.library-screen')`)
  console.log('1. app loaded ✓')

  await evalJs(`(async () => {
    const bytes = await (await fetch('/fixture.pdf')).arrayBuffer()
    const file = new File([bytes], 'fixture.pdf', { type: 'application/pdf' })
    const dt = new DataTransfer()
    dt.items.add(file)
    const input = document.querySelector('.library-screen input[type=file]')
    input.files = dt.files
    input.dispatchEvent(new Event('change', { bubbles: true }))
    return true
  })()`)

  const title = await waitFor(
    'imported paper card',
    `document.querySelector('.paper-card .paper-title')?.textContent || ''`
  )
  console.log(`2. imported, extracted title: "${title}"`)
  if (!/Deep Learning for Robot Manipulation/i.test(title)) {
    throw new Error(`title inference failed, got: ${title}`)
  }

  await evalJs(`document.querySelector('.paper-card').click()`)
  await waitFor('reader open', `!!document.querySelector('.reader')`)
  await waitFor(
    'first page painted',
    `(() => {
      const c = document.querySelector('.pm-page-canvas')
      if (!c || c.width === 0) return false
      const ctx = c.getContext('2d')
      const size = Math.min(c.width, c.height, 400)
      const data = ctx.getImageData(0, 0, size, size).data
      let ink = 0
      for (let i = 0; i < data.length; i += 4) if (data[i] < 240) ink += 1
      return ink > 50
    })()`
  )
  console.log('3. reader open, canvas painted with ink ✓')

  const indicator = await evalJs(
    `document.querySelector('.reader-page-indicator').textContent`
  )
  if (!indicator.includes('/ 3')) throw new Error(`expected 3 pages, got: ${indicator}`)
  console.log(`4. page indicator: ${indicator} ✓`)

  const textSpans = await waitFor(
    'text layer spans',
    `document.querySelectorAll('.pm-text-layer span').length`
  )
  console.log(`5. text layer rendered (${textSpans} spans) ✓`)

  await evalJs(
    `(() => { const s = document.querySelector('.reader-scroll'); s.scrollTop = s.scrollHeight; return true })()`
  )
  await delay(1500) // debounce for reading-state save
  await evalJs(`document.querySelector('.reader-topbar .icon-button').click()`)
  await waitFor('reader closed', `!document.querySelector('.reader')`)
  await evalJs(`document.querySelector('.paper-card').click()`)
  await waitFor('reader reopened', `!!document.querySelector('.reader')`)
  const restored = await waitFor(
    'reading position restored to page 3',
    `(() => {
      const t = document.querySelector('.reader-page-indicator')?.textContent || ''
      return t.trim().startsWith('3') ? t : ''
    })()`
  )
  console.log(`6. reading position restored: ${restored.trim()} ✓`)

  await evalJs(`document.querySelector('[aria-label="본문 검색"]').click()`)
  await waitFor('search bar', `!!document.querySelector('.reader-search')`)
  await evalJs(`(() => {
    const input = document.querySelector('.reader-search input')
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'quaternion')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  })()`)
  await evalJs(`document.querySelector('.reader-search .chip-button').click()`)
  const matches = await waitFor(
    'search results',
    `document.querySelectorAll('.reader-search-item').length`
  )
  console.log(`7. in-PDF search found ${matches} matches for "quaternion" ✓`)
  if (matches < 2) throw new Error(`expected ≥2 matches, got ${matches}`)

  console.log('\nE2E SMOKE PASSED')
  cleanup()
  process.exit(0)
} catch (error) {
  console.error('\nE2E SMOKE FAILED:', error.message)
  cleanup()
  process.exit(1)
}
