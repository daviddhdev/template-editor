import { describe, expect, it } from 'vitest'
import { substituteTags } from './substitute'
import type { ConditionalRule } from '../../types'

const rule: ConditionalRule = {
  id: 'r',
  label: 'x',
  branches: [],
  defaultText: 'Línea de {{NOMBRE}}',
}

describe('substituteTags with rule bindings', () => {
  const base = {
    mapping: { NOMBRE: 'Nombre' },
    onMissing: 'empty' as const,
    ruleBindings: { SECCION: { rule, perRow: true } },
  }
  const rows = [{ Nombre: 'Ana' }, { Nombre: 'Luis' }]

  it('resolves a rule-bound tag over the group, <br> for line breaks', () => {
    const out = substituteTags('<td>{{SECCION}}</td>', { ...base, row: rows[0], groupRows: rows })
    expect(out).toBe('<td>Línea de Ana<br><br>Línea de Luis</td>')
  })

  it('escapes rule output as text', () => {
    const evil = { ...rule, defaultText: '<b>{{NOMBRE}}</b>' }
    const out = substituteTags('<p>{{S}}</p>', {
      mapping: { NOMBRE: 'Nombre' },
      onMissing: 'empty',
      ruleBindings: { S: { rule: evil, perRow: false } },
      row: rows[0],
      groupRows: rows,
    })
    expect(out).toBe('<p>&lt;b&gt;Ana&lt;/b&gt;</p>')
  })

  it('column tags keep working alongside', () => {
    const out = substituteTags('<p>{{NOMBRE}}</p>', { ...base, row: rows[1], groupRows: rows })
    expect(out).toBe('<p>Luis</p>')
  })

  it('keeps line breaks inside COLUMN values visible', () => {
    const out = substituteTags('<p>{{NOMBRE}}</p>', {
      mapping: { NOMBRE: 'Nombre' },
      onMissing: 'empty',
      row: { Nombre: 'Calle 1\n2ºC' },
    })
    expect(out).toBe('<p>Calle 1<br>2ºC</p>')
  })

  it('tolerates inline markup inside the braces (Google split runs)', () => {
    const out = substituteTags('<p>{{<span>NOMBRE</span>}}</p>', {
      mapping: { NOMBRE: 'Nombre' },
      onMissing: 'empty',
      row: { Nombre: 'Ana' },
    })
    expect(out).toBe('<p>Ana</p>')
  })

  it('a stray {{ does not swallow the markup up to the next real tag', () => {
    const out = substituteTags('<p>abre {{ llaves</p><p>{{NOMBRE}}</p>', {
      mapping: { NOMBRE: 'Nombre' },
      onMissing: 'empty',
      row: { Nombre: 'Ana' },
    })
    expect(out).toBe('<p>abre {{ llaves</p><p>Ana</p>')
  })
})
