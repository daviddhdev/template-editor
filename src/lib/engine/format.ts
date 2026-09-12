import type { FormatId, TagFormats } from '../../types'


export const FIELD_FORMATS: { id: FormatId; label: string; example: string }[] = [
  { id: 'fecha_larga', label: 'Fecha larga', example: '12 de julio de 2026' },
  { id: 'fecha_corta', label: 'Fecha corta', example: '12/07/2026' },
  { id: 'moneda', label: 'Moneda', example: '1.200,00 €' },
  { id: 'importe_letra', label: 'Importe en letra', example: 'mil doscientos euros (1.200 €)' },
  { id: 'importe_letra_mayus', label: 'IMPORTE EN LETRA', example: 'MIL DOSCIENTOS EUROS (1.200 €)' },
  { id: 'mayusculas', label: 'MAYÚSCULAS', example: 'ACME SL' },
  { id: 'titulo', label: 'Tipo Título', example: 'Juan Pérez de la Cruz' },
]

export function formatInputKind(format: FormatId): 'date' | 'number' | 'text' {
  switch (format) {
    case 'fecha_larga':
    case 'fecha_corta':
      return 'date'
    case 'moneda':
    case 'importe_letra':
    case 'importe_letra_mayus':
      return 'number'
    default:
      return 'text'
  }
}


export interface ParsedDate {
  day: number
  month: number // 1-12
  year: number
}

const ISO_RE = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T\s].*)?$/
const DMY_RE = /^(\d{1,2})[/\-.](\d{1,2})[/\-.](\d{2}|\d{4})$/

function daysInMonth(month: number, year: number): number {
  return new Date(year, month, 0).getDate()
}

export function parseEsDate(raw: string): ParsedDate | null {
  const s = raw.trim()
  let day: number, month: number, year: number
  const iso = ISO_RE.exec(s)
  if (iso) {
    year = Number(iso[1])
    month = Number(iso[2])
    day = Number(iso[3])
  } else {
    const dmy = DMY_RE.exec(s)
    if (!dmy) return null
    day = Number(dmy[1])
    month = Number(dmy[2])
    year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])
  }
  if (month < 1 || month > 12 || day < 1 || day > daysInMonth(month, year)) return null
  return { day, month, year }
}

export function parseEsNumber(raw: string): number | null {
  // With both separators, the last is decimal; a lone 3-digit dot group is thousands.
  let s = raw.replace(/[€\s  ]/g, '')
  if (!s) return null
  let sign = 1
  if (s.startsWith('-')) {
    sign = -1
    s = s.slice(1)
  }
  const lastComma = s.lastIndexOf(',')
  const lastDot = s.lastIndexOf('.')
  if (lastComma !== -1 && lastDot !== -1) {
    const decimal = lastComma > lastDot ? ',' : '.'
    const grouping = decimal === ',' ? '.' : ','
    s = s.split(grouping).join('').replace(decimal, ',')
    if (s.indexOf(',') !== s.lastIndexOf(',')) return null // two decimal marks
    s = s.replace(',', '.')
  } else if (lastComma !== -1) {
    if (lastComma !== s.indexOf(',')) return null // several commas: ambiguous
    s = s.replace(',', '.')
  } else if (lastDot !== -1) {
    const dots = s.split('.')
    if (dots.length > 2 || (dots[0] !== '' && dots[0] !== '0' && dots[1]?.length === 3)) {
      if (dots.slice(1).some((g) => g.length !== 3) || dots[0] === '') return null
      s = dots.join('')
    }
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null
  return sign * Number(s)
}


export function formatEsNumber(value: number, decimals: number): string {
  const negative = value < 0
  const fixed = Math.abs(value).toFixed(decimals)
  const [int, frac] = fixed.split('.')
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, '.')
  return `${negative ? '-' : ''}${grouped}${frac ? `,${frac}` : ''}`
}

const UNITS = [
  '', 'un', 'dos', 'tres', 'cuatro', 'cinco', 'seis', 'siete', 'ocho', 'nueve',
  'diez', 'once', 'doce', 'trece', 'catorce', 'quince', 'dieciséis', 'diecisiete',
  'dieciocho', 'diecinueve', 'veinte', 'veintiún', 'veintidós', 'veintitrés',
  'veinticuatro', 'veinticinco', 'veintiséis', 'veintisiete', 'veintiocho', 'veintinueve',
]
const TENS = ['', '', '', 'treinta', 'cuarenta', 'cincuenta', 'sesenta', 'setenta', 'ochenta', 'noventa']
const HUNDREDS = [
  '', 'ciento', 'doscientos', 'trescientos', 'cuatrocientos', 'quinientos',
  'seiscientos', 'setecientos', 'ochocientos', 'novecientos',
]

function threeDigits(n: number): string {
  if (n === 100) return 'cien'
  const parts: string[] = []
  if (n >= 100) parts.push(HUNDREDS[Math.floor(n / 100)])
  const rest = n % 100
  if (rest >= 30) {
    const unit = rest % 10
    parts.push(unit ? `${TENS[Math.floor(rest / 10)]} y ${UNITS[unit]}` : TENS[Math.floor(rest / 10)])
  } else if (rest > 0) {
    parts.push(UNITS[rest])
  }
  return parts.join(' ')
}

export function numberToWordsEs(n: number): string {
  if (!Number.isInteger(n) || n < 0 || n >= 1e12) return String(n)
  if (n === 0) return 'cero'
  const millions = Math.floor(n / 1_000_000)
  const thousands = Math.floor((n % 1_000_000) / 1000)
  const rest = n % 1000
  const parts: string[] = []
  if (millions === 1) parts.push('un millón')
  else if (millions > 0) parts.push(`${numberToWordsEs(millions)} millones`)
  if (thousands === 1) parts.push('mil')
  else if (thousands > 0) parts.push(`${threeDigits(thousands)} mil`)
  if (rest > 0) parts.push(threeDigits(rest))
  return parts.join(' ')
}

export function amountInWordsEs(value: number): string {
  const negative = value < 0
  const cents = Math.round(Math.abs(value) * 100)
  const euros = Math.floor(cents / 100)
  const cts = cents % 100
  const de = euros >= 1_000_000 && euros % 1_000_000 === 0 ? ' de' : ''
  let words = `${numberToWordsEs(euros)}${de} ${euros === 1 ? 'euro' : 'euros'}`
  if (cts > 0) words += ` con ${numberToWordsEs(cts)} ${cts === 1 ? 'céntimo' : 'céntimos'}`
  const figure = cts === 0 ? formatEsNumber(euros, 0) : formatEsNumber(cents / 100, 2)
  return `${negative ? 'menos ' : ''}${words} (${negative ? '-' : ''}${figure} €)`
}

const MONTHS = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
]

const TITLE_PARTICLES = new Set(['de', 'del', 'la', 'las', 'los', 'y', 'e'])

export function titleCaseEs(raw: string): string {
  let first = true
  return raw.toLocaleLowerCase('es-ES').replace(/\S+/g, (word) => {
    const keep = !first && TITLE_PARTICLES.has(word)
    first = false
    if (keep) return word
    return word.charAt(0).toLocaleUpperCase('es-ES') + word.slice(1)
  })
}


export function formatValue(format: FormatId, raw: string): string {
  if (!raw.trim()) return raw
  switch (format) {
    case 'mayusculas':
      return raw.toLocaleUpperCase('es-ES')
    case 'titulo':
      return titleCaseEs(raw.trim())
    case 'fecha_larga': {
      const d = parseEsDate(raw)
      return d ? `${d.day} de ${MONTHS[d.month - 1]} de ${d.year}` : raw
    }
    case 'fecha_corta': {
      const d = parseEsDate(raw)
      if (!d) return raw
      const pad = (n: number) => String(n).padStart(2, '0')
      return `${pad(d.day)}/${pad(d.month)}/${d.year}`
    }
    case 'moneda': {
      const n = parseEsNumber(raw)
      return n === null ? raw : `${formatEsNumber(n, 2)} €`
    }
    case 'importe_letra': {
      const n = parseEsNumber(raw)
      return n === null ? raw : amountInWordsEs(n)
    }
    case 'importe_letra_mayus': {
      const n = parseEsNumber(raw)
      return n === null ? raw : amountInWordsEs(n).toLocaleUpperCase('es-ES')
    }
  }
}

export function formatTagValue(tag: string, raw: string, tagFormats?: TagFormats): string {
  const format = tagFormats?.[tag]
  return format ? formatValue(format, raw) : raw
}

export function cellParsesFor(format: FormatId, raw: string): boolean {
  if (!raw.trim()) return true
  switch (formatInputKind(format)) {
    case 'date':
      return parseEsDate(raw) !== null
    case 'number':
      return parseEsNumber(raw) !== null
    default:
      return true
  }
}
