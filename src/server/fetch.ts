import { createServerFn } from '@tanstack/react-start'
import type { ApiSourceConfig, DataSourceData, DataSourceKind } from '../types'
import { createDataSource, DataSourceError } from '../lib/datasource'
import { apiDataJson, apiLoginJson, tokenFrom } from '../lib/datasource/apiEndpointSource'
import { extractColumns, findRecordArrays, getByPath } from '../lib/datasource/apiShape'
import { extractDocument, type RawDocument } from '../lib/template/parse'
import { annotatePageBreaks, extractPageStartTexts } from '../lib/template/pageSync'
import { repairFloatingHeaders } from '../lib/template/repairFloatingHeaders'
import { inlineRemoteImages } from './inlineImages'
import {
  extractGoogleId,
  extractSheetGid,
  googleDocExportUrl,
  googleDocPdfExportUrl,
  looksLikeAccessWall,
} from '../lib/url'
import {
  optionalApiConfig,
  requireOneOf,
  requireRecord,
  requireString,
  requireUuid,
  ValidationError,
} from './validate'

export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; hint?: string; code?: 'AUTH'; fallbackHtml?: boolean }

type FetchError = { ok: false; error: string; hint?: string }

function errorFrom(err: unknown, fallback: string): FetchError {
  const e = err as { message?: string; hint?: string }
  return { ok: false, error: e?.message || fallback, hint: e?.hint }
}

const RECONNECT_FOR_READ: FetchError = {
  ok: false,
  error: 'Tu conexión de Google es anterior al permiso de lectura.',
  hint: 'Desconecta y vuelve a conectar tu cuenta de Google para poder leer documentos privados.',
}

export const fetchDocumentFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return { url: requireString(i.url, 'url') }
  })
  .handler(async ({ data }): Promise<Result<RawDocument>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    const id = extractGoogleId(data.url)
    if (!id) {
      return {
        ok: false,
        error: 'Ese enlace no parece un documento de Google.',
        hint: 'Copia el enlace desde el botón "Compartir" o la barra de direcciones del documento.',
      }
    }

    let authError: FetchError | null = null
    const g = await import('./googleClient')
    const status = await g.getStatusForUser(user.id)
    if (status.connected) {
      if (!status.canRead) {
        authError = RECONNECT_FOR_READ
      } else {
        try {
          const token = await g.getAccessToken(user.id)
          // The PDF supplies page starts for the local fallback; title is separate.
          const [htmlBytes, pdfBytes, name] = await Promise.all([
            g.exportFile(token, id, 'text/html', 'Google no pudo leer el documento.'),
            g.exportFile(token, id, 'application/pdf').catch(() => null),
            g.fileName(token, id),
          ])
          const doc = extractDocument(new TextDecoder('utf-8').decode(htmlBytes))
          if (name) doc.title = name
          if (!doc.bodyHtml.trim()) {
            return { ok: false, error: 'El documento se leyó pero está vacío.' }
          }
          if (pdfBytes) {
            const starts = await extractPageStartTexts(pdfBytes)
            if (starts.length > 0) doc.bodyHtml = annotatePageBreaks(doc.bodyHtml, starts).html
          }
          doc.bodyHtml = await inlineRemoteImages(doc.bodyHtml, token)
          const repaired = repairFloatingHeaders(doc)
          doc.bodyHtml = repaired.bodyHtml
          doc.css = repaired.css
          return { ok: true, data: doc }
        } catch (err) {
          authError = errorFrom(err, 'No se pudo leer el documento con tu cuenta de Google.')
        }
      }
    }

    const publicHint = status.connected
      ? 'Compártelo con tu cuenta conectada o ábrelo en Google Docs → Compartir → "Cualquier persona con el enlace".'
      : 'Ábrelo en Google Docs → Compartir → "Cualquier persona con el enlace", o conecta arriba la cuenta de Google que tiene acceso.'

    let html: string
    let contentType = ''
    let pdfBytes: Uint8Array | null = null
    try {
      const [res, pdfRes] = await Promise.all([
        fetch(googleDocExportUrl(id), { redirect: 'follow' }),
        fetch(googleDocPdfExportUrl(id), { redirect: 'follow' }).catch(() => null),
      ])
      contentType = res.headers.get('content-type') ?? ''
      html = await res.text()
      if (!res.ok) {
        return (
          authError ?? {
            ok: false,
            error: 'No se pudo leer el documento: puede que no sea público.',
            hint: publicHint,
          }
        )
      }
      if (pdfRes?.ok) pdfBytes = new Uint8Array(await pdfRes.arrayBuffer())
    } catch {
      return { ok: false, error: 'No se pudo conectar con Google para leer el documento.' }
    }

    if (looksLikeAccessWall(html) && !contentType.includes('text/html; charset')) {
      return (
        authError ?? {
          ok: false,
          error: 'No se puede leer ese documento: no es público.',
          hint: publicHint,
        }
      )
    }

    const doc = extractDocument(html)
    if (!doc.bodyHtml.trim()) {
      return { ok: false, error: 'El documento se leyó pero está vacío.' }
    }

    if (pdfBytes) {
      const starts = await extractPageStartTexts(pdfBytes)
      if (starts.length > 0) {
        doc.bodyHtml = annotatePageBreaks(doc.bodyHtml, starts).html
      }
    }

    const inlineToken =
      status.connected && status.canRead ? await g.getAccessToken(user.id).catch(() => null) : null
    doc.bodyHtml = await inlineRemoteImages(doc.bodyHtml, inlineToken)
    const repaired = repairFloatingHeaders(doc)
    doc.bodyHtml = repaired.bodyHtml
    doc.css = repaired.css

    return { ok: true, data: doc }
  })

export const fetchDataFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return {
      kind: requireOneOf<DataSourceKind>(i.kind, ['google_sheet', 'api_endpoint'], 'kind'),
      origin: requireString(i.origin, 'origin'),
      apiConfig: optionalApiConfig(i.apiConfig),
      recipeId: i.recipeId === undefined ? undefined : requireUuid(i.recipeId, 'recipeId'),
    }
  })
  .handler(async ({ data }): Promise<Result<DataSourceData>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    let authError: FetchError | null = null

    const apiConfig =
      data.kind === 'api_endpoint'
        ? await resolveApiCredentials(user.id, data.apiConfig, data.recipeId)
        : undefined

    if (data.kind === 'google_sheet') {
      const id = extractGoogleId(data.origin)
      if (id) {
        const g = await import('./googleClient')
        const status = await g.getStatusForUser(user.id)
        if (status.connected) {
          if (!status.canRead) {
            authError = RECONNECT_FOR_READ
          } else {
            try {
              const token = await g.getAccessToken(user.id)
              const { columns, rows } = await g.readSheetTable(
                token,
                id,
                extractSheetGid(data.origin),
              )
              return {
                ok: true,
                data: { kind: 'google_sheet', origin: data.origin, columns, rows },
              }
            } catch (err) {
              authError = errorFrom(err, 'No se pudo leer la hoja con tu cuenta de Google.')
            }
          }
        }
      }
    }

    try {
      const source = createDataSource(data.kind, data.origin, apiConfig)
      const result = await source.fetchData()
      return { ok: true, data: result }
    } catch (err) {
      if (authError) return authError
      if (err instanceof DataSourceError) {
        return { ok: false, error: err.message, hint: err.hint }
      }
      return { ok: false, error: 'No se pudieron leer los datos. Revisa el enlace e inténtalo de nuevo.' }
    }
  })

async function resolveApiCredentials(
  userId: string,
  apiConfig: ApiSourceConfig | undefined,
  recipeId: string | undefined,
): Promise<ApiSourceConfig | undefined> {
  if (!apiConfig || apiConfig.authBody || !apiConfig.authUrl || !recipeId) return apiConfig
  const { getSql } = await import('./db')
  const { storedAuthBodyEnc } = await import('./recipesDb')
  const { decryptSecret } = await import('./crypto')
  const enc = await storedAuthBodyEnc(await getSql(), recipeId, userId)
  return enc ? { ...apiConfig, authBody: decryptSecret(enc) } : apiConfig
}

export interface ApiProbeResult {
  tokenFound: boolean
  recordArrays: { path: string; count: number; columns: string[] }[]
}

const PROBE_SAMPLE = 20

export const probeApiSourceFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    const apiConfig = optionalApiConfig(i.apiConfig)
    if (!apiConfig) throw new ValidationError('Petición inválida: falta «apiConfig».')
    return {
      apiConfig,
      recipeId: i.recipeId === undefined ? undefined : requireUuid(i.recipeId, 'recipeId'),
    }
  })
  .handler(async ({ data }): Promise<Result<ApiProbeResult>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    const config = (await resolveApiCredentials(user.id, data.apiConfig, data.recipeId)) ?? data.apiConfig

    try {
      let token: string | null = null
      if (config.authUrl) {
        token = tokenFrom(config, await apiLoginJson(config))
        if (!token) return { ok: true, data: { tokenFound: false, recordArrays: [] } }
      }
      const json = await apiDataJson(config, token)
      const recordArrays = findRecordArrays(json).map((a) => {
        const arr = getByPath(json, a.path)
        const columns = Array.isArray(arr) ? extractColumns(arr.slice(0, PROBE_SAMPLE)) : []
        return { path: a.path, count: a.count, columns }
      })
      return { ok: true, data: { tokenFound: true, recordArrays } }
    } catch (err) {
      if (err instanceof DataSourceError) return { ok: false, error: err.message, hint: err.hint }
      return { ok: false, error: 'No se pudo probar la API. Revisa las direcciones e inténtalo de nuevo.' }
    }
  })

export interface SheetTab {
  gid: string
  title: string
}

export const listSheetTabsFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return { origin: requireString(i.origin, 'origin') }
  })
  .handler(async ({ data }): Promise<Result<SheetTab[]>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    const id = extractGoogleId(data.origin)
    if (!id) return { ok: true, data: [] }

    const g = await import('./googleClient')
    const status = await g.getStatusForUser(user.id)
    if (status.connected && status.canRead) {
      try {
        const token = await g.getAccessToken(user.id)
        return { ok: true, data: await g.listSheetTabs(token, id) }
      } catch {
      }
    }

    try {
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`, {
        redirect: 'follow',
      })
      if (!res.ok) return { ok: true, data: [] }
      const html = await res.text()
      const tabs: SheetTab[] = []
      for (const m of html.matchAll(
        /items\.push\(\{name: "((?:[^"\\]|\\.)*)",[^}]*?gid: "(-?\d+)"/g,
      )) {
        tabs.push({ gid: m[2], title: decodeJsString(m[1]) })
      }
      return { ok: true, data: tabs }
    } catch {
      return { ok: true, data: [] }
    }
  })

function decodeJsString(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(["'\\/])/g, '$1')
}
