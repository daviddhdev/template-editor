// User URLs are SSRF-sensitive: reject non-HTTP(S) and cloud metadata
// endpoints, while allowing private hosts used by internal APIs.

import { DataSourceError } from '../lib/datasource/types'

const FETCH_TIMEOUT_MS = 15000

const BLOCKED_HOSTS = new Set([
  '169.254.169.254', // AWS/GCP/Azure instance metadata (IMDS)
  '[::ffff:169.254.169.254]',
  'metadata.google.internal',
  'metadata', // GCP short name
])

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
