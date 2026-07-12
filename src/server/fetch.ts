import { createServerFn } from '@tanstack/react-start'
import type { DataSourceData, DataSourceKind } from '../types'
import { createDataSource, DataSourceError } from '../lib/datasource'
import { extractDocument, type RawDocument } from '../lib/template/parse'
import { annotatePageBreaks, extractPageStartTexts } from '../lib/template/pageSync'
import { inlineRemoteImages } from './inlineImages'
import {
  extractGoogleId,
  extractSheetGid,
  googleDocExportUrl,
  googleDocPdfExportUrl,
  looksLikeAccessWall,
} from '../lib/url'
import { requireOneOf, requireRecord, requireString } from './validate'

/** Discriminated result so the UI can show friendly errors without try/catch.
 * `code: 'AUTH'` = no session (or expired); the client redirects to /login. */
export type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; hint?: string; code?: 'AUTH' }

type FetchError = { ok: false; error: string; hint?: string }

/** Friendly error from a thrown GoogleError-ish (message + optional hint). */
function errorFrom(err: unknown, fallback: string): FetchError {
  const e = err as { message?: string; hint?: string }
  return { ok: false, error: e?.message || fallback, hint: e?.hint }
}

const RECONNECT_FOR_READ: FetchError = {
  ok: false,
  error: 'Tu conexión de Google es anterior al permiso de lectura.',
  hint: 'Desconecta y vuelve a conectar tu cuenta de Google para poder leer documentos privados.',
}

/**
 * Read a Google Doc and return its editable content (title, CSS, body HTML)
 * so it can be loaded into the in-app editor. Runs on the server, which also
 * sidesteps the browser's CORS restrictions on Google's export endpoints.
 *
 * With a Google account connected (and the read permission granted) the doc is
 * read through the Drive API, so PRIVATE documents the account can see work
 * too. Otherwise — or if the account cannot access it — it falls back to the
 * public export endpoints ("anyone with the link").
 */
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

    // --- Authenticated read (Drive API) when the user's connection allows ---
    let authError: FetchError | null = null
    const g = await import('./googleClient')
    const status = await g.getStatusForUser(user.id)
    if (status.connected) {
      if (!status.canRead) {
        authError = RECONNECT_FOR_READ
      } else {
        try {
          const token = await g.getAccessToken(user.id)
          // The PDF export carries Google's exact pagination, used to sync the
          // LOCAL fallback engine's page breaks (see pageSync.ts). Optional —
          // like the file name (the API's HTML export carries no <title>).
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
          // Last mutation before storing: make the document self-contained
          // (Google's drawing/image URLs are auth-bound and ephemeral).
          doc.bodyHtml = await inlineRemoteImages(doc.bodyHtml, token)
          return { ok: true, data: doc }
        } catch (err) {
          // Remember why and fall back to the public export: the doc may be
          // public even if this account cannot see it.
          authError = errorFrom(err, 'No se pudo leer el documento con tu cuenta de Google.')
        }
      }
    }

    // --- Public export fallback ---------------------------------------------
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
      // A private doc returns a sign-in page. (Real exports are text/html too,
      // so we only treat it as a wall when the body clearly asks to sign in.)
      // With a connected account that also failed, ITS error explains more.
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

    // Sync page breaks with the original document's own pagination.
    if (pdfBytes) {
      const starts = await extractPageStartTexts(pdfBytes)
      if (starts.length > 0) {
        doc.bodyHtml = annotatePageBreaks(doc.bodyHtml, starts).html
      }
    }

    // Public exports usually serve their images without auth, but a connected
    // account that can read helps with restricted drawings.
    const inlineToken =
      status.connected && status.canRead ? await g.getAccessToken(user.id).catch(() => null) : null
    doc.bodyHtml = await inlineRemoteImages(doc.bodyHtml, inlineToken)

    return { ok: true, data: doc }
  })

/**
 * Read a data source. Google Sheets: through the Sheets API when an account
 * with read permission is connected (private sheets work, and the link's tab
 * `gid` is honoured), falling back to the public CSV export otherwise.
 */
export const fetchDataFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return {
      kind: requireOneOf<DataSourceKind>(i.kind, ['google_sheet', 'api_endpoint'], 'kind'),
      origin: requireString(i.origin, 'origin'),
    }
  })
  .handler(async ({ data }): Promise<Result<DataSourceData>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    let authError: FetchError | null = null

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
      const source = createDataSource(data.kind, data.origin)
      const result = await source.fetchData()
      return { ok: true, data: result }
    } catch (err) {
      // The public path failed too; with a connected account, its error is the
      // actionable one (access, permission, empty sheet…).
      if (authError) return authError
      if (err instanceof DataSourceError) {
        return { ok: false, error: err.message, hint: err.hint }
      }
      return { ok: false, error: 'No se pudieron leer los datos. Revisa el enlace e inténtalo de nuevo.' }
    }
  })

/** One spreadsheet tab, for the tab picker. */
export interface SheetTab {
  gid: string
  title: string
}

/**
 * List a spreadsheet's tabs so the UI can show WHICH tab feeds the data and
 * let the user switch (a Share-button link carries no gid, so it silently
 * meant "first tab"). Best-effort: an empty list just hides the picker.
 * Connected: Sheets API. Public: parsed from the sheet's htmlview page.
 */
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
        // e.g. account cannot access this sheet — try the public page below.
      }
    }

    try {
      const res = await fetch(`https://docs.google.com/spreadsheets/d/${id}/htmlview`, {
        redirect: 'follow',
      })
      if (!res.ok) return { ok: true, data: [] }
      const html = await res.text()
      // htmlview builds its tab menu from embedded JS:
      //   items.push({name: "Facturas", pageUrl: "…", gid: "1822115617", …})
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

/** Undo the JS string escapes Google uses in the embedded tab names. */
function decodeJsString(s: string): string {
  return s
    .replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\x([0-9a-fA-F]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/\\(["'\\/])/g, '$1')
}
