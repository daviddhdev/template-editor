import Papa from 'papaparse'
import type { DataSourceData } from '../../types'
import { uniqueName } from '../uniqueNames'
import { extractGoogleId, extractSheetGid, googleSheetCsvUrl, looksLikeAccessWall } from '../url'
import type { DataSource } from './types'
import { DataSourceError } from './types'

export class GoogleSheetSource implements DataSource {
  readonly kind = 'google_sheet' as const

  constructor(readonly origin: string) {}

  async fetchData(): Promise<DataSourceData> {
    const id = extractGoogleId(this.origin)
    if (!id) {
      throw new DataSourceError(
        'Ese enlace no parece una hoja de cálculo de Google.',
        'Copia el enlace desde el botón "Compartir" o la barra de direcciones de la hoja.',
      )
    }
    const url = googleSheetCsvUrl(id, extractSheetGid(this.origin))

    let res: Response
    try {
      res = await fetch(url, { redirect: 'follow' })
    } catch {
      throw new DataSourceError('No se pudo conectar con Google para leer la hoja.')
    }

    const body = await res.text()

    const contentType = res.headers.get('content-type') ?? ''
    if (!res.ok || contentType.includes('text/html') || looksLikeAccessWall(body)) {
      throw new DataSourceError(
        'No se puede leer esa hoja: parece que no es pública.',
        'Ábrela en Google Sheets → Compartir → "Cualquier persona con el enlace" → Lector.',
      )
    }

    const used = new Set<string>()
    const parsed = Papa.parse<Record<string, string>>(body, {
      header: true,
      skipEmptyLines: 'greedy',
      transformHeader: (h, i) => uniqueName(used, h.trim() || `Columna ${i + 1}`),
    })

    const columns = (parsed.meta.fields ?? []).filter((c) => c.length > 0)
    if (columns.length === 0) {
      throw new DataSourceError('La hoja está vacía o no tiene una fila de encabezados.')
    }

    const rows = parsed.data
      .map((raw) => {
        const row: Record<string, string> = {}
        for (const col of columns) row[col] = (raw[col] ?? '').toString()
        return row
      })
      .filter((row) => columns.some((c) => row[c].trim() !== ''))

    if (rows.length === 0) {
      throw new DataSourceError('La hoja tiene encabezados pero ninguna fila con datos.')
    }

    return { kind: this.kind, origin: this.origin, columns, rows }
  }
}
