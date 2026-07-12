import { describe, expect, it } from 'vitest'
import { countDocs, toGenerationDocs } from './generationLog'

describe('toGenerationDocs', () => {
  it('maps dialog statuses to audit statuses', () => {
    expect(
      toGenerationDocs([
        { name: 'a', status: 'done' },
        { name: 'b', status: 'error' },
        { name: 'c', status: 'pending' },
        { name: 'd', status: 'running' },
      ]).map((d) => d.status),
    ).toEqual(['ok', 'error', 'pending', 'pending'])
  })

  it('keeps viaHtml only when set', () => {
    const [a, b] = toGenerationDocs([
      { name: 'a', status: 'done', viaHtml: true },
      { name: 'b', status: 'done' },
    ])
    expect(a.viaHtml).toBe(true)
    expect('viaHtml' in b).toBe(false)
  })

  it('records finished uploads only (uploading in-flight is dropped)', () => {
    const [a, b, c] = toGenerationDocs([
      { name: 'a', status: 'done', upload: { status: 'done' } },
      { name: 'b', status: 'done', upload: { status: 'error' } },
      { name: 'c', status: 'done', upload: { status: 'uploading' } },
    ])
    expect(a.uploaded).toBe('done')
    expect(b.uploaded).toBe('error')
    expect('uploaded' in c).toBe(false)
  })
})

describe('countDocs', () => {
  it('tallies by status', () => {
    expect(
      countDocs([
        { name: 'a', status: 'ok' },
        { name: 'b', status: 'ok' },
        { name: 'c', status: 'error' },
        { name: 'd', status: 'pending' },
      ]),
    ).toEqual({ ok: 2, error: 1, pending: 1 })
  })

  it('handles empty input', () => {
    expect(countDocs([])).toEqual({ ok: 0, error: 0, pending: 0 })
  })
})
