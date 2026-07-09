import type { DataSourceData, GroupConfig } from '../../types'

/** One output document's worth of rows, plus the key that identifies it. */
export interface RowGroup {
  /** Grouping-column value, or a row label when not grouping. */
  key: string
  rows: Record<string, string>[]
}

/**
 * Split the data into the groups that will each become one document.
 * - per_row: one group per row (key = a readable label from the first column).
 * - per_group: rows sharing the same value in `groupByColumn`, order preserved.
 */
export function buildGroups(data: DataSourceData, group: GroupConfig): RowGroup[] {
  if (group.mode === 'per_row' || !group.groupByColumn) {
    const labelCol = data.columns[0]
    return data.rows.map((row, i) => ({
      key: (row[labelCol] ?? '').trim() || `Fila ${i + 1}`,
      rows: [row],
    }))
  }

  const col = group.groupByColumn
  const order: string[] = []
  const map = new Map<string, Record<string, string>[]>()
  for (const row of data.rows) {
    const key = (row[col] ?? '').trim() || '(sin valor)'
    if (!map.has(key)) {
      map.set(key, [])
      order.push(key)
    }
    map.get(key)!.push(row)
  }
  return order.map((key) => ({ key, rows: map.get(key)! }))
}
