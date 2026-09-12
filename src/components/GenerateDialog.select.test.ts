import { describe, expect, it } from 'vitest'
import { norm } from './GenerateDialog'

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
