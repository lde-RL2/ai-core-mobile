import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  createNotionChunk,
  createNotionPdfManifest,
  extractAndVerifyNotionChunk,
  notionChunkCount,
  notionChunkPayloadLimit,
  parseNotionPdfManifest
} from '../src/sync/notionChunks'
import { sha256Hex } from '../src/sync/format'

function samplePayload(size: number): Uint8Array {
  const bytes = new Uint8Array(size)
  for (let i = 0; i < size; i += 1) bytes[i] = (i * 31 + 7) % 256
  return bytes
}

test('chunk pack/extract round-trips and verifies checksums', async () => {
  const payload = samplePayload(5000)
  const packed = await createNotionChunk('paper-1', 'gen123', 0, payload)
  assert.equal(packed.descriptor.payloadSize, 5000)
  const restored = await extractAndVerifyNotionChunk(packed.descriptor, packed.archive)
  assert.deepEqual(Array.from(restored), Array.from(payload))
})

test('tampered archive fails verification', async () => {
  const packed = await createNotionChunk('paper-1', 'gen123', 0, samplePayload(1000))
  const tampered = Uint8Array.from(packed.archive)
  tampered[tampered.length - 5] ^= 0xff
  await assert.rejects(
    () => extractAndVerifyNotionChunk(packed.descriptor, tampered),
    /checksum mismatch/
  )
})

test('manifest round-trips through create/parse', async () => {
  const payload = samplePayload(2000)
  const packed = await createNotionChunk('paper-2', 'genabc', 0, payload)
  const manifest = createNotionPdfManifest({
    paperId: 'paper-2',
    originalFilename: 'file.pdf',
    originalSize: payload.byteLength,
    originalSha256: await sha256Hex(payload),
    chunks: [packed.descriptor],
    generation: 'genabc'
  })
  const parsed = parseNotionPdfManifest(new TextEncoder().encode(JSON.stringify(manifest)))
  assert.equal(parsed.paperId, 'paper-2')
  assert.equal(parsed.chunks.length, 1)
})

test('manifest with a gap in chunk sequence is rejected', async () => {
  const packed = await createNotionChunk('paper-3', 'g', 1, samplePayload(100))
  const manifest = createNotionPdfManifest({
    paperId: 'paper-3',
    originalFilename: 'f.pdf',
    originalSize: 100,
    originalSha256: 'x',
    chunks: [packed.descriptor]
  })
  assert.throws(
    () => parseNotionPdfManifest(new TextEncoder().encode(JSON.stringify(manifest))),
    /incomplete/
  )
})

test('chunk sizing math matches the desktop implementation', () => {
  const limit = notionChunkPayloadLimit(5 * 1024 * 1024)
  assert.equal(limit, 5 * 1024 * 1024 - 256 * 1024)
  assert.equal(notionChunkCount(limit * 2 + 1, limit), 3)
  assert.equal(notionChunkCount(0, limit), 1)
})
