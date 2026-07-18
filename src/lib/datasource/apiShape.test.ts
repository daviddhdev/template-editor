import { describe, expect, it } from 'vitest'
import { detectToken, extractColumns, findRecordArrays, flattenRecord, getByPath } from './apiShape'

describe('getByPath', () => {
  it('returns the value at a dot-path and undefined off-path', () => {
    const json = { data: { results: [1, 2] } }
    expect(getByPath(json, 'data.results')).toEqual([1, 2])
    expect(getByPath(json, 'data.missing')).toBeUndefined()
    expect(getByPath(json, 'nope.deep')).toBeUndefined()
  })
  it('empty path returns the value itself (root array)', () => {
    const arr = [{ a: 1 }]
    expect(getByPath(arr, '')).toBe(arr)
  })
})

describe('detectToken', () => {
  it('finds a top-level known key', () => {
    expect(detectToken({ access_token: 'abc', foo: 1 })).toEqual({ value: 'abc', path: 'access_token' })
  })
  it('finds a nested token and reports its path', () => {
    expect(detectToken({ data: { token: 'xyz' } })).toEqual({ value: 'xyz', path: 'data.token' })
  })
  it('prefers the shallowest known key (breadth-first)', () => {
    const r = detectToken({ token: 'top', data: { access_token: 'deep' } })
    expect(r).toEqual({ value: 'top', path: 'token' })
  })
  it('returns null when no known key holds a non-empty string', () => {
    expect(detectToken({ weirdKey: 'v', access_token: '' })).toBeNull()
    expect(detectToken({ access_token: 123 })).toBeNull()
    expect(detectToken(null)).toBeNull()
  })
})

describe('findRecordArrays', () => {
  it('reports a root array of objects at path ""', () => {
    expect(findRecordArrays([{ a: 1 }, { a: 2 }])).toEqual([{ path: '', count: 2 }])
  })
  it('finds nested record arrays, outermost first', () => {
    const json = { page: 1, data: { results: [{ id: 1 }], other: [{ x: 1 }, { x: 2 }] } }
    expect(findRecordArrays(json)).toEqual([
      { path: 'data.results', count: 1 },
      { path: 'data.other', count: 2 },
    ])
  })
  it('ignores empty arrays and arrays of scalars', () => {
    expect(findRecordArrays({ tags: ['a', 'b'], empty: [], rows: [{ id: 1 }] })).toEqual([
      { path: 'rows', count: 1 },
    ])
  })
})

describe('flattenRecord', () => {
  it('flattens nested objects to dot-paths and coerces scalars', () => {
    expect(flattenRecord({ id: 7, active: true, customer: { name: 'Ana', city: 'Cádiz' } })).toEqual({
      id: '7',
      active: 'true',
      'customer.name': 'Ana',
      'customer.city': 'Cádiz',
    })
  })
  it('skips null/undefined leaves and arrays (not offered as columns)', () => {
    expect(flattenRecord({ a: null, b: undefined, lines: [1, 2], rows: [{ id: 1 }] })).toEqual({})
  })
  it('a field that is null in one place and object in another gives only dot-paths', () => {
    expect(flattenRecord({ salesperson: null })).toEqual({})
    expect(flattenRecord({ salesperson: { full_name: 'Ana', phone: null } })).toEqual({
      'salesperson.full_name': 'Ana',
    })
  })
  it('non-object records yield no columns', () => {
    expect(flattenRecord('hello')).toEqual({})
    expect(flattenRecord(42)).toEqual({})
  })
})

describe('extractColumns', () => {
  it('unions leaf keys across records in first-seen order', () => {
    const records = [
      { id: 1, name: 'A' },
      { id: 2, name: 'B', extra: { deep: 9 } },
    ]
    expect(extractColumns(records)).toEqual(['id', 'name', 'extra.deep'])
  })
})
