import type { DataSourceData, DataSourceKind } from '../../types'

/**
 * A source of tabular data. Everything the app consumes comes through this
 * interface, so swapping the transport later (OAuth Sheets API, a real REST
 * endpoint, a database) is a matter of adding another implementation — no
 * changes to the wizard or the generation engine.
 */
export interface DataSource {
  readonly kind: DataSourceKind
  /** The link or endpoint this source reads from (for display / re-fetch). */
  readonly origin: string
  /** Read the data. Throws {@link DataSourceError} on any user-facing failure. */
  fetchData(): Promise<DataSourceData>
}

/** A failure with a message safe (and friendly) to show a non-technical user. */
export class DataSourceError extends Error {
  constructor(
    message: string,
    /** Optional hint shown under the error, e.g. how to make a sheet public. */
    readonly hint?: string,
  ) {
    super(message)
    this.name = 'DataSourceError'
  }
}
