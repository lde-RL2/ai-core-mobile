// Post-build step: fills dist/sw.js with the hashed asset list emitted by
// Vite so the service worker precaches the whole app shell at install time.
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dist = fileURLToPath(new URL('../dist', import.meta.url))

const precache = ['manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png']
for (const entry of readdirSync(join(dist, 'assets'))) {
  precache.push(`assets/${entry}`)
}

const version = createHash('sha256')
  .update(readFileSync(join(dist, 'index.html')))
  .update(precache.join('\n'))
  .digest('hex')
  .slice(0, 12)

const swPath = join(dist, 'sw.js')
const sw = readFileSync(swPath, 'utf8')
  .replace('__VERSION__', version)
  .replace('__PRECACHE__', JSON.stringify(precache, null, 2))
if (sw.includes('__VERSION__') || sw.includes('__PRECACHE__')) {
  throw new Error('sw.js placeholders were not replaced')
}
writeFileSync(swPath, sw)
console.log(`[sw] precaching ${precache.length} assets, cache version ${version}`)
