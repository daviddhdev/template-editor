import type { ApiSourceConfig, DataSourceKind } from '../../types'
import { ApiEndpointSource } from './apiEndpointSource'
import { GoogleSheetSource } from './googleSheetSource'
import type { DataSource } from './types'

export type { DataSource } from './types'
export { DataSourceError } from './types'
export { GoogleSheetSource } from './googleSheetSource'
export { ApiEndpointSource } from './apiEndpointSource'

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
        apiConfig ?? {
          authUrl: '',
          authBody: '',
          tokenPath: '',
          dataUrl: origin,
          recordsPath: '',
          columns: [],
        },
      )
    case 'manual_form':
      throw new Error('El formulario manual no se carga desde una URL.')
    default: {
      const _never: never = kind
      throw new Error(`Origen de datos desconocido: ${String(_never)}`)
    }
  }
}
