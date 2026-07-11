import { describe, expect, it } from 'vitest'
import { buildGroups } from './grouping'
import { uniqueName } from '../uniqueNames'
import type { DataSourceData } from '../../types'

const data = (rows: Record<string, string>[]): DataSourceData => ({
  kind: 'google_sheet',
  origin: 'x',
  columns: Object.keys(rows[0] ?? { A: '' }),
  rows,
})

describe('buildGroups key uniqueness', () => {
  it('disambiguates duplicate row labels in per_row mode', () => {
    const groups = buildGroups(
      data([{ A: 'García, Ana' }, { A: 'García, Ana' }, { A: 'García, Ana' }]),
      { mode: 'per_row', groupByColumn: null },
    )
    expect(groups.map((g) => g.key)).toEqual(['García, Ana', 'García, Ana (2)', 'García, Ana (3)'])
    // Each group still carries ITS row, not the first one's.
    expect(groups.map((g) => g.rows.length)).toEqual([1, 1, 1])
  })

  it('disambiguates labels that normalise to the same FILE name', () => {
    const groups = buildGroups(data([{ A: 'Cliente?' }, { A: 'Cliente!' }]), {
      mode: 'per_row',
      groupByColumn: null,
    })
    expect(groups[0].key).toBe('Cliente?')
    expect(groups[1].key).toBe('Cliente! (2)')
  })

  it('leaves already-unique per_group keys untouched', () => {
    const groups = buildGroups(
      data([
        { A: 'x', G: 'Uno' },
        { A: 'y', G: 'Dos' },
        { A: 'z', G: 'Uno' },
      ]),
      { mode: 'per_group', groupByColumn: 'G' },
    )
    expect(groups.map((g) => g.key)).toEqual(['Uno', 'Dos'])
    expect(groups[0].rows).toHaveLength(2)
  })
})

describe('uniqueName', () => {
  it('suffixes duplicates with (n)', () => {
    const used = new Set<string>()
    expect(uniqueName(used, 'Nombre')).toBe('Nombre')
    expect(uniqueName(used, 'Nombre')).toBe('Nombre (2)')
    expect(uniqueName(used, 'Nombre')).toBe('Nombre (3)')
    expect(uniqueName(used, 'Otro')).toBe('Otro')
  })

  it('skips over a real column that already uses the suffixed name', () => {
    const used = new Set<string>(['Nombre', 'Nombre (2)'])
    expect(uniqueName(used, 'Nombre')).toBe('Nombre (3)')
  })
})
