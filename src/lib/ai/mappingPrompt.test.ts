import { describe, expect, it } from 'vitest'
import {
  MAX_SAMPLE_CHARS,
  MAX_SAMPLE_ROWS,
  buildMappingMessages,
  mappingSchema,
  parseMappingContent,
  sampleRowsForMapping,
  truncateSample,
} from './mappingPrompt'

describe('sampleRowsForMapping', () => {
  const columns = ['Nombre', 'NIF']

  it('caps rows, keeps only known columns, drops empty cells', () => {
    const rows = Array.from({ length: 10 }, (_, i) => ({
      Nombre: `Persona ${i}`,
      NIF: i === 0 ? '' : `0000000${i}A`,
      Secreta: 'no debe salir',
    }))
    const out = sampleRowsForMapping(rows, columns)
    expect(out).toHaveLength(MAX_SAMPLE_ROWS)
    expect(out[0]).toEqual({ Nombre: 'Persona 0' }) // empty NIF dropped
    expect(out[1]).toEqual({ Nombre: 'Persona 1', NIF: '00000001A' })
    for (const row of out) expect(row).not.toHaveProperty('Secreta')
  })

  it('truncates long values', () => {
    const long = 'x'.repeat(MAX_SAMPLE_CHARS + 40)
    const out = sampleRowsForMapping([{ Nombre: long, NIF: '1A' }], columns)
    expect(out[0].Nombre).toBe('x'.repeat(MAX_SAMPLE_CHARS) + '…')
    expect(out[0].Nombre.length).toBe(MAX_SAMPLE_CHARS + 1)
  })

  it('handles missing rows', () => {
    expect(sampleRowsForMapping(undefined, columns)).toEqual([])
    expect(sampleRowsForMapping([], columns)).toEqual([])
  })
})

describe('truncateSample', () => {
  it('leaves short values untouched', () => {
    expect(truncateSample('corto')).toBe('corto')
  })
})

describe('buildMappingMessages', () => {
  it('embeds fields, columns and samples as JSON in the user message', () => {
    const { system, user } = buildMappingMessages(
      ['cliente', 'cliente'],
      ['Nombre'],
      [{ Nombre: 'Ana' }],
    )
    expect(system).toContain('null')
    const parsed = JSON.parse(user)
    expect(parsed.fields).toEqual(['cliente']) // deduped
    expect(parsed.columns).toEqual(['Nombre'])
    expect(parsed.sample_rows).toEqual([{ Nombre: 'Ana' }])
  })
})

describe('mappingSchema', () => {
  it('requires every unique tag and forbids extras', () => {
    const schema = mappingSchema(['a', 'b', 'a'], ['Col1', 'Col2']) as {
      properties: Record<string, unknown>
      required: string[]
      additionalProperties: boolean
    }
    expect(Object.keys(schema.properties)).toEqual(['a', 'b'])
    expect(schema.required).toEqual(['a', 'b'])
    expect(schema.additionalProperties).toBe(false)
    expect(schema.properties.a).toEqual({
      anyOf: [{ type: 'string', enum: ['Col1', 'Col2'] }, { type: 'null' }],
    })
  })
})

describe('parseMappingContent', () => {
  const tags = ['cliente', 'fecha']
  const columns = ['Nombre', 'Fecha firma']

  it('accepts a valid mapping', () => {
    const out = parseMappingContent(
      JSON.stringify({ cliente: 'Nombre', fecha: 'Fecha firma' }),
      tags,
      columns,
    )
    expect(out).toEqual({ cliente: 'Nombre', fecha: 'Fecha firma' })
  })

  it('nulls unknown columns and preserves explicit nulls', () => {
    const out = parseMappingContent(
      JSON.stringify({ cliente: 'Inventada', fecha: null }),
      tags,
      columns,
    )
    expect(out).toEqual({ cliente: null, fecha: null })
  })

  it('drops extra keys and nulls missing tags', () => {
    const out = parseMappingContent(JSON.stringify({ otra: 'Nombre' }), tags, columns)
    expect(out).toEqual({ cliente: null, fecha: null })
    expect(out).not.toHaveProperty('otra')
  })

  it('throws on non-JSON or non-object content', () => {
    expect(() => parseMappingContent('no json', tags, columns)).toThrow(/no es JSON/)
    expect(() => parseMappingContent('[1,2]', tags, columns)).toThrow(/inesperada/)
    expect(() => parseMappingContent('null', tags, columns)).toThrow(/inesperada/)
  })
})
