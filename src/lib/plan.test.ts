import { describe, expect, it } from 'vitest'
import { effectiveMapping, unmappedTags } from './plan'
import type { Template } from '../types'

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
