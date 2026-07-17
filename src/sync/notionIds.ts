// Ported from the desktop app (src/main/services/notionIds.ts) so the mobile
// app accepts the same input: a pasted Notion page URL or a bare 32-character
// page ID. Notion's REST paths need a dashed UUID; passing a raw URL yields a
// 400 "Invalid request URL".
export function normalizeNotionPageId(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) throw new Error('Notion 부모 페이지 ID를 입력하세요.')
  const compactMatches = trimmed.match(/[0-9a-f]{32}/gi)
  const uuidMatches = trimmed.match(
    /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi
  )
  const candidate = compactMatches?.at(-1) ?? uuidMatches?.at(-1) ?? trimmed
  const raw = candidate.replace(/-/g, '')
  if (!/^[0-9a-f]{32}$/i.test(raw)) {
    throw new Error('Notion 부모 페이지는 페이지 URL 또는 32자리 페이지 ID여야 합니다.')
  }
  return raw.replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5').toLowerCase()
}
