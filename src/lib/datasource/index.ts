import type { ApiSourceConfig, DataSourceKind } from '../../types'
import { ApiEndpointSource } from './apiEndpointSource'
import { GoogleSheetSource } from './googleSheetSource'
import type { DataSource } from './types'

export type { DataSource } from './types'
export { DataSourceError } from './types'
export { GoogleSheetSource } from './googleSheetSource'
export { ApiEndpointSource } from './apiEndpointSource'

/**
 * Build the right {@link DataSource} for a chosen origin kind. `apiConfig` is
 * required for 'api_endpoint' (the endpoints, credentials and record/column
 * choices); `origin` alone suffices for a Google Sheet.
 */
export function createDataSource(
  kind: DataSourceKind,
  origin: string,
  apiConfig?: ApiSourceConfig,
): DataSource {
  switch (kind) {
    case 'google_sheet':
      return new GoogleSheetSource(origin)
    case 'api_endpoint':
      return new ApiEndpointSource(
        // Fall back to a bare GET on `origin` when no config was supplied.
        apiConfig ?? {
          authUrl: '',
          authBody: '',
          tokenPath: '',
          dataUrl: origin,
          recordsPath: '',
          columns: [],
        },
      )
    default: {
      // Exhaustiveness guard: adding a new kind forces handling it here.
      const _never: never = kind
      throw new Error(`Origen de datos desconocido: ${String(_never)}`)
    }
  }
}
