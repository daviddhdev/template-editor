import { describe, expect, it } from 'vitest'
import { manualFields, manualData } from './manualForm'
import type { Template } from '../types'

const template: Template = {
  sourceUrl: '', title: 'T', css: '', bodyClass: '',
  blocks: [], tags: ['NOMBRE', 'CIUDAD', 'AVISO'],
}

describe('manual form helpers', () => {
  it('deduplicates mapped fields and includes rule conditions', () => {
    const fields = manualFields(template, { NOMBRE: 'cliente', CIUDAD: 'cliente' }, {
      AVISO: { perRow: false, rule: { id: 'r', label: 'r', branches: [{ id: 'b', column: 'estado', operator: 'equals', value: 'ok', text: 'sí' }] } },
    })
    expect(fields.map((f) => f.key)).toEqual(['cliente', 'estado'])
  })

  it('creates one row preserving empty fields', () => {
    expect(manualData([{ key: 'a', label: 'a', inputType: 'text', formats: [] }], {}).rows).toEqual([{ a: '' }])
  })
})
