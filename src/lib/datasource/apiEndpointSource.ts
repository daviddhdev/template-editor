import type { ApiSourceConfig, DataSourceData } from '../../types'
import { assertFetchableUrl, fetchWithTimeout } from '../../server/httpGuard'
import { detectToken, extractColumns, flattenRecord, getByPath } from './apiShape'
import type { DataSource } from './types'
import { DataSourceError } from './types'

/**
 * Reads rows from a customer's own REST API (see {@link ApiSourceConfig}).
 * Runs server-side (via server/fetch.ts), which sidesteps CORS and lets the
 * SSRF/timeout guards in httpGuard.ts wrap every request. The token-exchange:
 * optional POST login → bearer token → GET the data endpoint. The response is
 * arbitrary JSON; `recordsPath` locates the list and `columns` (flattened
 * dot-paths) select the cells, producing the same shape a Google Sheet does.
 *
 * `authBody` arrives already decrypted from the server handler — this class
 * never touches encryption. The login/fetch steps are module functions so the
 * probe endpoint (server/fetch.ts) can reuse them for discovery.
 */
export class ApiEndpointSource implements DataSource {
  readonly kind = 'api_endpoint' as const
  readonly origin: string

  constructor(readonly config: ApiSourceConfig) {
    this.origin = config.dataUrl
  }

  async fetchData(): Promise<DataSourceData> {
    let token: string | null = null
    if (this.config.authUrl) {
      token = tokenFrom(this.config, await apiLoginJson(this.config))
      if (!token) {
        throw new DataSourceError(
          'No se encontró el token en la respuesta de inicio de sesión.',
          'Vuelve a «Configurar API» e indica la ruta del token.',
        )
      }
    }

    const json = await apiDataJson(this.config, token)
    const records = getByPath(json, this.config.recordsPath)
    if (!Array.isArray(records)) {
      throw new DataSourceError(
        'No se encontró una lista de registros en la respuesta de la API.',
        'Vuelve a «Configurar API» y elige dónde están los registros.',
      )
    }

    // Chosen columns, or every leaf field if the config left it open.
    const columns = [
      ...new Set(
        (this.config.columns.length ? this.config.columns : extractColumns(records)).filter(Boolean),
      ),
    ]
    if (columns.length === 0) {
      throw new DataSourceError('La respuesta de la API no tiene columnas utilizables.')
    }

    const rows = records
      .map((rec) => {
        const flat = flattenRecord(rec)
        const row: Record<string, string> = {}
        for (const c of columns) row[c] = flat[c] ?? ''
        return row
      })
      // Drop rows that are entirely empty (same rule as the sheet source).
      .filter((row) => columns.some((c) => row[c].trim() !== ''))

    if (rows.length === 0) {
      throw new DataSourceError('La API respondió pero no trajo ninguna fila con datos.')
    }

    return { kind: this.kind, origin: this.origin, columns, rows }
  }
}

/** POST the login body and return the parsed response JSON (token lives in it). */
export async function apiLoginJson(config: ApiSourceConfig): Promise<unknown> {
  const url = assertFetchableUrl(config.authUrl, 'de inicio de sesión')
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: config.authBody || '{}',
    },
    'el inicio de sesión de la API',
  )
  if (!res.ok) {
    throw new DataSourceError(
      `El inicio de sesión de la API falló (${res.status}).`,
      'Revisa la dirección de inicio de sesión y las credenciales.',
    )
  }
  return parseJson(res, 'de inicio de sesión')
}

/** GET the data endpoint (with the bearer token, if any) and parse the JSON. */
export async function apiDataJson(config: ApiSourceConfig, token: string | null): Promise<unknown> {
  const url = assertFetchableUrl(config.dataUrl, 'de la API de datos')
  const headers: Record<string, string> = { accept: 'application/json' }
  if (token) headers.authorization = `Bearer ${token}`
  const res = await fetchWithTimeout(url, { headers }, 'la API de datos')
  if (!res.ok) {
    throw new DataSourceError(
      `La API de datos respondió con un error (${res.status}).`,
      'Revisa la dirección de datos y, si hace falta, las credenciales.',
    )
  }
  return parseJson(res, 'de datos')
}

/** The token in a login response: by explicit path, else auto-detected. */
export function tokenFrom(config: ApiSourceConfig, loginJson: unknown): string | null {
  const t = config.tokenPath ? getByPath(loginJson, config.tokenPath) : detectToken(loginJson)?.value
  return typeof t === 'string' && t.length > 0 ? t : null
}

async function parseJson(res: Response, what: string): Promise<unknown> {
  const text = await res.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new DataSourceError(`La respuesta ${what} de la API no es JSON válido.`)
  }
}
