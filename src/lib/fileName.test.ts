import { describe, expect, it } from 'vitest'
import { batchFolderName, safeName } from './fileName'

const date = new Date(2026, 6, 11, 9, 5) // 2026-07-11 09:05 local

describe('batchFolderName', () => {
  it('combines the sanitised label with a local timestamp', () => {
    expect(batchFolderName('Contrato de alquiler', date)).toBe(
      'Contrato de alquiler 2026-07-11 09.05',
    )
  })

  it('falls back to "Documentos" when the label is blank', () => {
    expect(batchFolderName('', date)).toBe('Documentos 2026-07-11 09.05')
    expect(batchFolderName('   ', date)).toBe('Documentos 2026-07-11 09.05')
  })

  it('strips characters safeName rejects', () => {
    expect(batchFolderName('Nóminas: 2026/07', date)).toBe('Nóminas 202607 2026-07-11 09.05')
  })

  it('produces a name safeName itself accepts unchanged (no ":" in the time)', () => {
    const name = batchFolderName('Facturas', date)
    expect(safeName(name)).toBe(name)
  })
})
