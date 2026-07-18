/**
 * Guards for fetching a user-supplied URL server-side (the API data source).
 * Because the server makes the request, an unchecked URL is an SSRF lever. The
 * chosen policy (see the plan) is deliberately narrow so INTERNAL company APIs
 * still work: allow private hosts, but always reject non-http(s) schemes and
 * the cloud metadata endpoint — the one target that turns SSRF into credential
 * theft. Every request is also time-bounded (same pattern as inlineImages.ts).
 */

import { DataSourceError } from '../lib/datasource/types'

const FETCH_TIMEOUT_MS = 15000

/** Hosts that must never be reachable through a user-supplied URL. */
const BLOCKED_HOSTS = new Set([
  '169.254.169.254', // AWS/GCP/Azure instance metadata (IMDS)
  '[::ffff:169.254.169.254]',
  'metadata.google.internal',
  'metadata', // GCP short name
])

/** Validate and normalise a user URL; throws a friendly {@link DataSourceError}. */
export function assertFetchableUrl(raw: string, what: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new DataSourceError(
      `La dirección ${what} no es válida.`,
      'Escribe una URL completa, por ejemplo https://api.tuempresa.com/datos.',
    )
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new DataSourceError(
      `La dirección ${what} debe empezar por http:// o https://.`,
    )
  }
  if (BLOCKED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new DataSourceError('Esa dirección no está permitida.')
  }
  return url
}

/** fetch() with an abort-based timeout. Rejects with a {@link DataSourceError}
 * on timeout or connection failure so callers surface a friendly message. */
export async function fetchWithTimeout(
  url: URL,
  init: RequestInit,
  what: string,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { ...init, redirect: 'follow', signal: controller.signal })
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      throw new DataSourceError(`La conexión con ${what} tardó demasiado y se canceló.`)
    }
    throw new DataSourceError(`No se pudo conectar con ${what}.`)
  } finally {
    clearTimeout(timer)
  }
}
