import { describe, expect, it } from 'vitest'
import { norm } from './GenerateDialog'

// `norm` backs the document checklist search: matching is accent- and
// case-insensitive substring on the label (the group key), so finding one
// client among a batch works regardless of accents or capitalisation.
describe('norm (checklist search)', () => {
  it('lowercases and strips accents', () => {
    expect(norm('García, Ana')).toBe('garcia, ana')
    expect(norm('MARÍA')).toBe('maria')
    expect(norm('  Núñez  ')).toBe('nunez')
  })

  it('matches as a substring across accent/case differences', () => {
    const label = norm('José María PÉREZ')
    expect(label.includes(norm('maria'))).toBe(true)
    expect(label.includes(norm('PÉREZ'))).toBe(true)
    expect(label.includes(norm('lópez'))).toBe(false)
  })

  it('treats an empty query as no filter (empty string is a substring of all)', () => {
    expect(norm('Cualquier fila').includes(norm(''))).toBe(true)
  })
})
