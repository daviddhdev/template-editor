import { describe, expect, it } from 'vitest'
import { effectiveMapping, formatParseIssues, missingBoundColumns, unmappedTags } from './plan'
import type { Template } from '../types'

describe('formatParseIssues', () => {
  const rows = [
    { FECHA: '12/07/2026', TOTAL: '1.200,50' },
    { FECHA: 'pendiente', TOTAL: 'n/a' },
    { FECHA: '', TOTAL: '900' },
  ]
  const columns = ['FECHA', 'TOTAL']

  it('cuenta las celdas no parseables (las vacías no cuentan)', () => {
    const issues = formatParseIssues(
      { FECHA: 'fecha_larga', TOTAL: 'importe_letra' },
      {},
      columns,
      rows,
    )
    expect(issues).toEqual([
      { column: 'FECHA', format: 'fecha_larga', kind: 'date', bad: 1, example: 'pendiente' },
      { column: 'TOTAL', format: 'importe_letra', kind: 'number', bad: 1, example: 'n/a' },
    ])
  })

  it('sin problemas cuando todo parsea o el formato es de texto', () => {
    expect(formatParseIssues({ FECHA: 'mayusculas' }, {}, columns, rows)).toEqual([])
    expect(
      formatParseIssues({ TOTAL: 'moneda' }, {}, columns, [{ TOTAL: '5' }, { TOTAL: '' }]),
    ).toEqual([])
  })

  it('usa el mapeo efectivo (vínculo explícito) y deduplica columna+formato', () => {
    const issues = formatParseIssues(
      { IMPORTE: 'moneda', CUANTIA: 'moneda' },
      { IMPORTE: 'TOTAL', CUANTIA: 'TOTAL' },
      columns,
      rows,
    )
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ column: 'TOTAL', format: 'moneda', bad: 1 })
  })

  it('ignora tags con formato cuyo vínculo no resuelve a columna', () => {
    expect(formatParseIssues({ SUELTO: 'fecha_larga' }, {}, columns, rows)).toEqual([])
  })
})

describe('effectiveMapping', () => {
  it('binds by identity when the tag IS a column', () => {
    expect(effectiveMapping(['NOMBRE'], ['NOMBRE', 'NIF'], {})).toEqual({ NOMBRE: 'NOMBRE' })
  })

  it('an explicit binding wins over identity', () => {
    expect(effectiveMapping(['NOMBRE'], ['NOMBRE', 'ALIAS'], { NOMBRE: 'ALIAS' })).toEqual({
      NOMBRE: 'ALIAS',
    })
  })

  it('matches a column suffix after its last $ (prefixed sheet headers)', () => {
    expect(effectiveMapping(['NOMBRE'], ['IAI$NOMBRE'], {})).toEqual({ NOMBRE: 'IAI$NOMBRE' })
  })

  it('an ambiguous suffix (two columns claim it) does not auto-bind', () => {
    expect(effectiveMapping(['X'], ['A$X', 'B$X'], {})).toEqual({ X: null })
  })

  it('unknown tags map to null', () => {
    expect(effectiveMapping(['OTRO'], ['NOMBRE'], {})).toEqual({ OTRO: null })
  })

  // Sheet-tab switch: explicit bindings to columns absent from the CURRENT
  // data must not look bound (they'd silently substitute empty at generate).
  it('ignores a stale explicit binding whose column is gone', () => {
    expect(effectiveMapping(['X'], ['NOMBRE'], { X: 'VIEJA' })).toEqual({ X: null })
  })

  it('a stale explicit binding falls back to the identity match', () => {
    expect(effectiveMapping(['NOMBRE'], ['NOMBRE'], { NOMBRE: 'VIEJA' })).toEqual({
      NOMBRE: 'NOMBRE',
    })
  })

  it('trusts explicit bindings while no data is loaded (nothing to validate)', () => {
    expect(effectiveMapping(['X'], [], { X: 'VIEJA' })).toEqual({ X: 'VIEJA' })
  })

  it('a stale binding revives when its column returns', () => {
    const explicit = { X: 'VIEJA' }
    expect(effectiveMapping(['X'], ['OTRA'], explicit)).toEqual({ X: null })
    expect(effectiveMapping(['X'], ['VIEJA'], explicit)).toEqual({ X: 'VIEJA' })
  })
})

describe('missingBoundColumns', () => {
  const rule = (column: string) => ({
    rule: {
      id: 'r',
      label: 'x',
      branches: [{ id: 'b', column, operator: 'equals' as const, value: '1', text: 't' }],
    },
    perRow: false,
  })

  it('collects missing columns from bindings, grouping and rules, deduped', () => {
    expect(
      missingBoundColumns(
        { A: 'FALTA', B: 'NOMBRE', C: 'FALTA' },
        { mode: 'per_group', groupByColumn: 'GRUPO_VIEJO' },
        { R: rule('COND_VIEJA') },
        ['NOMBRE'],
      ),
    ).toEqual(['FALTA', 'GRUPO_VIEJO', 'COND_VIEJA'])
  })

  it('ignores groupByColumn in per_row mode and null bindings', () => {
    expect(
      missingBoundColumns(
        { A: null },
        { mode: 'per_row', groupByColumn: 'GRUPO_VIEJO' },
        {},
        ['NOMBRE'],
      ),
    ).toEqual([])
  })

  it('returns nothing when no data is loaded', () => {
    expect(
      missingBoundColumns({ A: 'FALTA' }, { mode: 'per_row', groupByColumn: null }, {}, []),
    ).toEqual([])
  })
})

describe('unmappedTags', () => {
  const template = (tags: string[]): Template => ({
    sourceUrl: 'x',
    title: 't',
    css: '',
    bodyClass: '',
    blocks: [],
    tags,
  })

  it('reports tags with no column and no rule', () => {
    expect(unmappedTags(template(['A', 'B']), ['A'], {})).toEqual(['B'])
  })

  it('a rule-bound tag is not unmapped', () => {
    const rule = { id: 'r', label: 'x', branches: [] }
    expect(unmappedTags(template(['A', 'B']), ['A'], {}, { B: { rule, perRow: false } })).toEqual([])
  })

  it('tags used INSIDE rule texts need a binding too', () => {
    const rule = {
      id: 'r',
      label: 'x',
      branches: [{ id: 'b', column: 'A', operator: 'equals' as const, value: '1', text: 'Hola {{INTERNO}}' }],
    }
    expect(unmappedTags(template(['A', 'B']), ['A'], {}, { B: { rule, perRow: false } })).toEqual([
      'INTERNO',
    ])
  })
})
