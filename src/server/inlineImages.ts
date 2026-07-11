import { parse } from 'node-html-parser'

/**
 * Replace remote `<img src="http...">` with data: URIs at import time.
 *
 * Google's HTML export references drawings (banner shapes, decorative lines…)
 * through `docs.google.com/drawings/...` URLs that are auth-bound and
 * ephemeral: they 403 in the preview iframe once the session/permissions
 * change, and Google's HTML importer drops them when the edited HTML is
 * re-uploaded. Inlining them once, server-side, makes the editor, the
 * preview, the local PDF and the HTML fallback route all self-contained.
 *
 * Best-effort by design: any per-image failure (network, non-image response,
 * over budget) keeps the original src. Never throws.
 */

/** Only these hosts ever see the OAuth token. */
function isGoogleHost(url: URL): boolean {
  const h = url.hostname
  return (
    h === 'docs.google.com' ||
    h === 'drive.google.com' ||
    h === 'googleusercontent.com' ||
    h.endsWith('.googleusercontent.com')
  )
}

const PER_IMAGE_LIMIT = 1.5 * 1024 * 1024
/** The inlined document persists to localStorage (~5 MB origin quota, shared
 * with the row data) — stop inlining once the budget is spent. */
const TOTAL_BUDGET = 3.5 * 1024 * 1024
const FETCH_TIMEOUT_MS = 8000
const CONCURRENCY = 4

async function fetchAsDataUri(src: string, token: string | null): Promise<string | null> {
  let url: URL
  try {
    url = new URL(src)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    const headers: Record<string, string> = {}
    if (token && isGoogleHost(url)) headers.authorization = `Bearer ${token}`
    const res = await fetch(url, { headers, redirect: 'follow', signal: controller.signal })
    if (!res.ok) return null
    const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim()
    if (!mime.startsWith('image/')) return null
    const bytes = Buffer.from(await res.arrayBuffer())
    if (bytes.byteLength === 0 || bytes.byteLength > PER_IMAGE_LIMIT) return null
    return `data:${mime};base64,${bytes.toString('base64')}`
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

export async function inlineRemoteImages(bodyHtml: string, token: string | null): Promise<string> {
  if (!/<img/i.test(bodyHtml)) return bodyHtml

  const root = parse(`<div id="__inline_root">${bodyHtml}</div>`, { comment: false })
  const wrapper = root.querySelector('#__inline_root')!
  const imgs = wrapper
    .querySelectorAll('img')
    .filter((el) => /^https?:\/\//i.test(el.getAttribute('src') ?? ''))
  if (imgs.length === 0) return bodyHtml

  // Fetch each distinct URL once, a few at a time.
  const srcs = [...new Set(imgs.map((el) => el.getAttribute('src')!))]
  const dataUris = new Map<string, string>()
  for (let i = 0; i < srcs.length; i += CONCURRENCY) {
    const batch = srcs.slice(i, i + CONCURRENCY)
    const results = await Promise.all(batch.map((src) => fetchAsDataUri(src, token)))
    batch.forEach((src, j) => {
      if (results[j]) dataUris.set(src, results[j]!)
    })
  }
  if (dataUris.size === 0) return bodyHtml

  let budget = TOTAL_BUDGET
  for (const el of imgs) {
    const uri = dataUris.get(el.getAttribute('src')!)
    if (!uri || uri.length > budget) continue
    budget -= uri.length
    el.setAttribute('src', uri)
  }
  return wrapper.innerHTML
}
