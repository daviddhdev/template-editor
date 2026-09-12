import type { DataSourceData, DataSourceKind } from '../../types'

export interface DataSource {
  readonly kind: DataSourceKind
  readonly origin: string
  fetchData(): Promise<DataSourceData>
}

export class DataSourceError extends Error {
  constructor(
    message: string,
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'DataSourceError'
  }
}
