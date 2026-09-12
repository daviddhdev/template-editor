import type { DataSourceData, GroupConfig } from '../../types'
import { safeName } from '../fileName'

export interface RowGroup {
  key: string
  rows: Record<string, string>[]
}

function dedupeKeys(groups: RowGroup[]): RowGroup[] {
  const seen = new Set<string>()
  return groups.map((g) => {
    let key = g.key
    let norm = safeName(key).toLowerCase()
    for (let n = 2; seen.has(norm); n++) {
      key = `${g.key.slice(0, 60).trim()} (${n})`
      norm = safeName(key).toLowerCase()
    }
    seen.add(norm)
    return key === g.key ? g : { ...g, key }
  })
}

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
