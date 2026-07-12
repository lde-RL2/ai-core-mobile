/**
 * AI-Core Mobile — Notion CORS proxy (Cloudflare Worker, free plan).
 *
 * The Notion API and its S3 file URLs don't send CORS headers, so browsers
 * (including the installed PWA on iPhone/iPad) can't call them directly.
 * This stateless worker forwards requests and adds CORS headers. Your Notion
 * token only passes through inside the Authorization header of each request;
 * nothing is stored.
 *
 * Deploy (once):
 *   npm i -g wrangler        # or: npx wrangler ...
 *   npx wrangler deploy workers/notion-proxy.js --name aicore-notion-proxy \
 *     --compatibility-date 2026-07-01
 *
 * Then paste the printed URL (https://aicore-notion-proxy.<you>.workers.dev)
 * into AI-Core Mobile → 설정 → 동기화 → Notion 프록시 URL.
 */

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type, Notion-Version',
  'Access-Control-Max-Age': '86400'
}

const FILE_HOST_ALLOWLIST = [
  /(^|\.)amazonaws\.com$/,
  /(^|\.)notion\.so$/,
  /(^|\.)notion\.site$/,
  /(^|\.)notion-static\.com$/,
  /(^|\.)notionusercontent\.com$/
]

function withCors(response) {
  const headers = new Headers(response.headers)
  for (const [key, value] of Object.entries(CORS_HEADERS)) headers.set(key, value)
  return new Response(response.body, { status: response.status, headers })
}

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS })
    }
    const url = new URL(request.url)

    if (url.pathname.startsWith('/notion/')) {
      const target =
        'https://api.notion.com/v1' + url.pathname.slice('/notion'.length) + url.search
      const headers = new Headers()
      for (const name of ['authorization', 'content-type', 'notion-version']) {
        const value = request.headers.get(name)
        if (value) headers.set(name, value)
      }
      const response = await fetch(target, {
        method: request.method,
        headers,
        body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body
      })
      return withCors(response)
    }

    if (url.pathname === '/file') {
      const target = url.searchParams.get('url')
      if (!target) return new Response('missing url', { status: 400, headers: CORS_HEADERS })
      let parsed
      try {
        parsed = new URL(target)
      } catch {
        return new Response('bad url', { status: 400, headers: CORS_HEADERS })
      }
      if (
        parsed.protocol !== 'https:' ||
        !FILE_HOST_ALLOWLIST.some((pattern) => pattern.test(parsed.hostname))
      ) {
        return new Response('host not allowed', { status: 403, headers: CORS_HEADERS })
      }
      const response = await fetch(target)
      return withCors(response)
    }

    return new Response('AI-Core Notion proxy', { status: 200, headers: CORS_HEADERS })
  }
}
