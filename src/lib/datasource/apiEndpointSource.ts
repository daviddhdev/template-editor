import type { DataSourceData } from '../../types'
import type { DataSource } from './types'
import { DataSourceError } from './types'

/**
 * STUB — future extension point.
 *
 * Placeholder for reading rows from a customer's own REST endpoint instead of a
 * Google Sheet. The UI already lets the user choose "API externa" as the origin
 * so the whole flow is wired; only this transport is not implemented yet.
 *
 * To make it real later, fetch `origin`, map the JSON response to
 * { columns, rows } and return it — the rest of the app already expects exactly
 * that shape via {@link DataSource}. Expected JSON contract (suggested):
 *   { "columns": string[], "rows": Array<Record<string, string>> }
 */
export class ApiEndpointSource implements DataSource {
  readonly kind = 'api_endpoint' as const

  constructor(readonly origin: string) {}

  // eslint-disable-next-line @typescript-eslint/require-await
  async fetchData(): Promise<DataSourceData> {
    throw new DataSourceError(
      'La conexión con una API externa aún no está disponible.',
      'Por ahora usa una hoja de Google. Esta opción se activará más adelante.',
    )
  }
}
