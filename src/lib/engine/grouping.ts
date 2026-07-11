import type { DataSourceData, GroupConfig } from '../../types'
import { safeName } from '../fileName'

/** One output document's worth of rows, plus the key that identifies it. */
export interface RowGroup {
  /** Grouping-column value, or a row label when not grouping. */
  key: string
  rows: Record<string, string>[]
}

/**
 * Make every group key unique AFTER file-name normalisation (safeName):
 * duplicate row labels (two "García, Ana" rows in per_row mode), or distinct
 * labels that normalise to the same file name ("Cliente?" / "Cliente!"),
 * would otherwise pair with the wrong job and overwrite each other's files
 * in the zip — a document silently lost.
 */
function dedupeKeys(groups: RowGroup[]): RowGroup[] {
  const seen = new Set<string>()
  return groups.map((g) => {
    let key = g.key
    let norm = safeName(key).toLowerCase()
    // The base is clipped so the " (n)" suffix survives safeName's 80-char cut.
    for (let n = 2; seen.has(norm); n++) {
      key = `${g.key.slice(0, 60).trim()} (${n})`
      norm = safeName(key).toLowerCase()
    }
    seen.add(norm)
    return key === g.key ? g : { ...g, key }
  })
}

/**
 * Split the data into the groups that will each become one document.
 * - per_row: one group per row (key = a readable label from the first column).
 * - per_group: rows sharing the same value in `groupByColumn`, order preserved.
 * Keys are unique across the batch (see {@link dedupeKeys}).
 */
export function buildGroups(data: DataSourceData, group: GroupConfig): RowGroup[] {
  if (group.mode === 'per_row' || !group.groupByColumn) {
    const labelCol = data.columns[0]
    return dedupeKeys(
      data.rows.map((row, i) => ({
        key: (row[labelCol] ?? '').trim() || `Fila ${i + 1}`,
        rows: [row],
      })),
    )
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
  return dedupeKeys(order.map((key) => ({ key, rows: map.get(key)! })))
}
