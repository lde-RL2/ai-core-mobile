// Generates the PWA icon set from public/icons/icon-512.png using headless
// Chrome as a canvas renderer (no native image tooling required).
//   icon-192.png            - standard launcher icon
//   icon-512.png            - standard launcher icon (source, rewritten)
//   icon-maskable-512.png   - 80% safe-zone version on solid background
//   apple-touch-icon.png    - 180x180 on solid background (iOS dislikes alpha)
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { setTimeout as delay } from 'node:timers/promises'

const root = fileURLToPath(new URL('..', import.meta.url))
const iconsDir = join(root, 'public/icons')
const CDP_PORT = 9378

const sourceB64 = readFileSync(join(iconsDir, 'icon-512.png')).toString('base64')

const profileDir = mkdtempSync(join(tmpdir(), 'aicore-icons-'))
const chrome = spawn(
  'google-chrome',
  [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profileDir}`,
    'about:blank'
  ],
  { stdio: 'ignore' }
)

async function getWsUrl() {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)
      const page = (await res.json()).find((t) => t.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      /* not up yet */
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
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result)
    )
    ws.send(JSON.stringify({ id, method, params }))
  })
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

  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      const img = new Image()
      img.src = 'data:image/png;base64,${sourceB64}'
      await img.decode()

      // Sample the icon's own background colour for the solid variants.
      const probe = document.createElement('canvas')
      probe.width = probe.height = 512
      const probeCtx = probe.getContext('2d')
      probeCtx.drawImage(img, 0, 0)
      const px = probeCtx.getImageData(256, 24, 1, 1).data
      const bg = 'rgb(' + px[0] + ',' + px[1] + ',' + px[2] + ')'

      function draw(size, { background = null, scale = 1 } = {}) {
        const canvas = document.createElement('canvas')
        canvas.width = canvas.height = size
        const ctx = canvas.getContext('2d')
        if (background) {
          ctx.fillStyle = background
          ctx.fillRect(0, 0, size, size)
        }
        const drawn = size * scale
        const offset = (size - drawn) / 2
        ctx.imageSmoothingQuality = 'high'
        ctx.drawImage(img, offset, offset, drawn, drawn)
        return canvas.toDataURL('image/png')
      }

      return {
        bg,
        'icon-192.png': draw(192),
        'icon-512.png': draw(512),
        'icon-maskable-512.png': draw(512, { background: bg, scale: 0.8 }),
        'apple-touch-icon.png': draw(180, { background: bg, scale: 1 })
      }
    })()`,
    awaitPromise: true,
    returnByValue: true
  })
  if (result.exceptionDetails) {
    throw new Error(JSON.stringify(result.exceptionDetails))
  }

  const { bg, ...files } = result.result.value
  console.log('sampled background colour:', bg)
  for (const [name, dataUrl] of Object.entries(files)) {
    const bytes = Buffer.from(dataUrl.split(',')[1], 'base64')
    writeFileSync(join(iconsDir, name), bytes)
    console.log(`wrote ${name} (${bytes.length} bytes)`)
  }
} finally {
  chrome.kill('SIGKILL')
  rmSync(profileDir, { recursive: true, force: true })
}
