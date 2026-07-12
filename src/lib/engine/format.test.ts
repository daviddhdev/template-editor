import { describe, expect, it } from 'vitest'
import {
  amountInWordsEs,
  cellParsesFor,
  formatEsNumber,
  formatTagValue,
  formatValue,
  numberToWordsEs,
  parseEsDate,
  parseEsNumber,
  titleCaseEs,
} from './format'

describe('parseEsDate', () => {
  it('acepta día/mes/año con y sin ceros', () => {
    expect(parseEsDate('12/07/2026')).toEqual({ day: 12, month: 7, year: 2026 })
    expect(parseEsDate('1-2-26')).toEqual({ day: 1, month: 2, year: 2026 })
    expect(parseEsDate('31.12.2025')).toEqual({ day: 31, month: 12, year: 2025 })
  })
  it('acepta ISO (con o sin hora)', () => {
    expect(parseEsDate('2026-07-12')).toEqual({ day: 12, month: 7, year: 2026 })
    expect(parseEsDate('2026-07-12T10:30:00')).toEqual({ day: 12, month: 7, year: 2026 })
  })
  it('rechaza fechas imposibles y texto', () => {
    expect(parseEsDate('31/02/2026')).toBeNull()
    expect(parseEsDate('12/13/2026')).toBeNull()
    expect(parseEsDate('pendiente')).toBeNull()
    expect(parseEsDate('12 de enero')).toBeNull()
  })
})

describe('parseEsNumber', () => {
  it('formato español', () => {
    expect(parseEsNumber('1.200,50')).toBe(1200.5)
    expect(parseEsNumber('1200,5')).toBe(1200.5)
    expect(parseEsNumber('1.200')).toBe(1200)
    expect(parseEsNumber('1.200.300')).toBe(1200300)
  })
  it('formato con punto decimal', () => {
    expect(parseEsNumber('1200.50')).toBe(1200.5)
    expect(parseEsNumber('0.500')).toBe(0.5)
    expect(parseEsNumber('1,200.50')).toBe(1200.5)
  })
  it('ignora € y espacios; conserva el signo', () => {
    expect(parseEsNumber('1.200,50 €')).toBe(1200.5)
    expect(parseEsNumber('€ 1 200')).toBe(1200)
    expect(parseEsNumber('-350,25')).toBe(-350.25)
  })
  it('rechaza texto y formas ambiguas', () => {
    expect(parseEsNumber('pendiente')).toBeNull()
    expect(parseEsNumber('1,2,3')).toBeNull()
    expect(parseEsNumber('12.34.56')).toBeNull()
    expect(parseEsNumber('')).toBeNull()
  })
})

describe('formatEsNumber', () => {
  it('agrupa con punto desde 4 cifras y decimales con coma', () => {
    expect(formatEsNumber(1200, 2)).toBe('1.200,00')
    expect(formatEsNumber(950, 2)).toBe('950,00')
    expect(formatEsNumber(1234567.5, 2)).toBe('1.234.567,50')
    expect(formatEsNumber(1200, 0)).toBe('1.200')
    expect(formatEsNumber(-1200.5, 2)).toBe('-1.200,50')
  })
})

describe('numberToWordsEs', () => {
  it('casos gramaticales', () => {
    expect(numberToWordsEs(0)).toBe('cero')
    expect(numberToWordsEs(1)).toBe('un')
    expect(numberToWordsEs(16)).toBe('dieciséis')
    expect(numberToWordsEs(21)).toBe('veintiún')
    expect(numberToWordsEs(31)).toBe('treinta y un')
    expect(numberToWordsEs(100)).toBe('cien')
    expect(numberToWordsEs(101)).toBe('ciento un')
    expect(numberToWordsEs(555)).toBe('quinientos cincuenta y cinco')
    expect(numberToWordsEs(1000)).toBe('mil')
    expect(numberToWordsEs(1200)).toBe('mil doscientos')
    expect(numberToWordsEs(21000)).toBe('veintiún mil')
    expect(numberToWordsEs(100000)).toBe('cien mil')
    expect(numberToWordsEs(1000000)).toBe('un millón')
    expect(numberToWordsEs(1200000)).toBe('un millón doscientos mil')
    expect(numberToWordsEs(2000000)).toBe('dos millones')
  })
})

describe('amountInWordsEs', () => {
  it('entero: sin céntimos y cifra sin decimales', () => {
    expect(amountInWordsEs(1200)).toBe('mil doscientos euros (1.200 €)')
    expect(amountInWordsEs(1)).toBe('un euro (1 €)')
  })
  it('con decimales: céntimos en letra y cifra con 2 decimales', () => {
    expect(amountInWordsEs(1200.5)).toBe(
      'mil doscientos euros con cincuenta céntimos (1.200,50 €)',
    )
    expect(amountInWordsEs(0.01)).toBe('cero euros con un céntimo (0,01 €)')
  })
  it('millones exactos llevan «de»', () => {
    expect(amountInWordsEs(2000000)).toBe('dos millones de euros (2.000.000 €)')
    expect(amountInWordsEs(1200000)).toBe('un millón doscientos mil euros (1.200.000 €)')
  })
})

describe('titleCaseEs', () => {
  it('capitaliza salvo partículas; la primera palabra siempre', () => {
    expect(titleCaseEs('juan pérez de la cruz')).toBe('Juan Pérez de la Cruz')
    expect(titleCaseEs('DEL RÍO Y ASOCIADOS')).toBe('Del Río y Asociados')
  })
})

describe('formatValue', () => {
  it('fecha larga y corta', () => {
    expect(formatValue('fecha_larga', '12/07/2026')).toBe('12 de julio de 2026')
    expect(formatValue('fecha_larga', '2026-01-05')).toBe('5 de enero de 2026')
    expect(formatValue('fecha_corta', '2026-07-12')).toBe('12/07/2026')
    expect(formatValue('fecha_corta', '1/2/26')).toBe('01/02/2026')
  })
  it('moneda siempre con 2 decimales', () => {
    expect(formatValue('moneda', '1200')).toBe('1.200,00 €')
    expect(formatValue('moneda', '1.200,5')).toBe('1.200,50 €')
  })
  it('importe en letra, también en MAYÚSCULAS', () => {
    expect(formatValue('importe_letra', '1200')).toBe('mil doscientos euros (1.200 €)')
    expect(formatValue('importe_letra_mayus', '1200')).toBe('MIL DOSCIENTOS EUROS (1.200 €)')
  })
  it('mayúsculas y título', () => {
    expect(formatValue('mayusculas', 'acme sl')).toBe('ACME SL')
    expect(formatValue('titulo', 'juan pérez')).toBe('Juan Pérez')
  })
  it('celda que no parsea pasa TAL CUAL; vacía queda vacía', () => {
    expect(formatValue('fecha_larga', 'pendiente')).toBe('pendiente')
    expect(formatValue('importe_letra', 'n/a')).toBe('n/a')
    expect(formatValue('moneda', '')).toBe('')
    expect(formatValue('importe_letra', '  ')).toBe('  ')
  })
})

describe('formatTagValue', () => {
  it('aplica el formato del tag; sin entrada devuelve el crudo', () => {
    const tf = { FECHA: 'fecha_larga' as const }
    expect(formatTagValue('FECHA', '12/07/2026', tf)).toBe('12 de julio de 2026')
    expect(formatTagValue('OTRO', '12/07/2026', tf)).toBe('12/07/2026')
    expect(formatTagValue('FECHA', '12/07/2026', undefined)).toBe('12/07/2026')
  })
})

describe('cellParsesFor', () => {
  it('fecha/número según el formato; texto y vacío siempre valen', () => {
    expect(cellParsesFor('fecha_larga', '12/07/2026')).toBe(true)
    expect(cellParsesFor('fecha_larga', 'pendiente')).toBe(false)
    expect(cellParsesFor('importe_letra', '1.200,50')).toBe(true)
    expect(cellParsesFor('moneda', 'n/a')).toBe(false)
    expect(cellParsesFor('mayusculas', 'lo que sea')).toBe(true)
    expect(cellParsesFor('moneda', '')).toBe(true)
  })
})
