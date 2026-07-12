import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import { safeName, type PdfFile, type PdfResult } from './pdf'
import { FORMAT_MIME, type GoogleFormat } from './googlePdf'
import { optionalFormats, requireArray, requireRecord, requireString } from './validate'

const DOCX_MIME = FORMAT_MIME.docx
const GOOGLE_DOC_MIME = 'application/vnd.google-apps.document'

/** One tag's substitution: every literal spelling it may have in the doc. */
export interface NativeReplacement {
  tag: string
  finds: string[]
  replace: string
}

/** One output document: display name + the tag substitutions for its group. */
export interface NativeJob {
  name: string
  replacements: NativeReplacement[]
}

export interface NativeResult extends PdfResult {
  /** Tags none of whose spellings matched in some document (shown as a warning
   * — the tag would still be visible as literal text in the output). */
  unmatched: string[]
}

/**
 * Short-lived cache of the source file's bytes: the dialog now generates one
 * document per call for live progress, and re-downloading the original (~1 MB)
 * for every document would be pure waste. A batch finishes well inside the
 * TTL; edits to the source mid-batch are an accepted (rare) staleness window.
 */
const sourceCache = new Map<string, { bytes: Uint8Array; mime: string; at: number }>()
const SOURCE_TTL_MS = 5 * 60_000

/** Drop expired entries (the TTL check on read never removed anything, so
 * the cache grew without bound across a long-lived server). */
function pruneSourceCache(): void {
  const now = Date.now()
  for (const [key, entry] of sourceCache) {
    if (now - entry.at >= SOURCE_TTL_MS) sourceCache.delete(key)
  }
}

/**
 * The NATIVE generation route: instead of re-importing edited HTML (lossy —
 * flattened page headers, dropped drawings, degraded font weights), the
 * ORIGINAL Drive file is re-materialised as a Google Doc per output document
 * and its `{{tags}}` are substituted with the Docs API's replaceAllText,
 * which reaches page headers/footers too. Everything Google's converters
 * preserve (images, borders, fonts, weights, page geometry) stays intact.
 *
 * Source bytes are acquired ONCE:
 *  - office file (.docx…): raw download (`alt=media`, allowed by
 *    drive.readonly) and re-upload with conversion — the exact same import
 *    conversion `files.copy` would run, but the copy is app-created so the
 *    drive.file scope can edit/export/delete it (files.copy itself would
 *    need the full `drive` scope and force every user to re-consent);
 *  - native Google Doc: export to DOCX and re-upload with conversion (a
 *    Doc→DOCX→Doc roundtrip through Google's own converters; embedded
 *    drawings may rasterise, still far better than the HTML roundtrip).
 */
export const generateNativePdfFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    const jobs: NativeJob[] = requireArray(i.jobs, 'jobs').map((j, n) => {
      const job = requireRecord(j, `jobs[${n}]`)
      const replacements: NativeReplacement[] = requireArray(
        job.replacements,
        `jobs[${n}].replacements`,
      ).map((r, k) => {
        const rep = requireRecord(r, `jobs[${n}].replacements[${k}]`)
        return {
          tag: requireString(rep.tag, 'tag'),
          finds: requireArray(rep.finds, 'finds').map((f) => requireString(f, 'finds')),
          replace: requireString(rep.replace, 'replace'),
        }
      })
      return { name: requireString(job.name, `jobs[${n}].name`), replacements }
    })
    return {
      sourceFileId: requireString(i.sourceFileId, 'sourceFileId'),
      jobs,
      formats: optionalFormats(i.formats),
    }
  })
  .handler(async ({ data }): Promise<Result<NativeResult>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    const g = await import('./googleClient')
    const formats: GoogleFormat[] =
      data.formats && data.formats.length > 0 ? data.formats : ['pdf']

    const files: PdfFile[] = []
    const unmatched = new Set<string>()
    try {
      let token = await g.getAccessToken(user.id)
      // Cache key includes the user: two accounts can have DIFFERENT access
      // to the same file id — a shared entry would leak bytes across them.
      const cacheKey = `${user.id}:${data.sourceFileId}`
      const cached = sourceCache.get(cacheKey)
      let sourceBytes: Uint8Array
      let uploadMime: string
      if (cached && Date.now() - cached.at < SOURCE_TTL_MS) {
        sourceBytes = cached.bytes
        uploadMime = cached.mime
      } else {
        const meta = await g.getFileMeta(token, data.sourceFileId)
        const isNativeDoc = meta.mimeType === GOOGLE_DOC_MIME
        sourceBytes = isNativeDoc
          ? await g.exportFile(token, data.sourceFileId, DOCX_MIME, 'Google no pudo leer la plantilla original.')
          : await g.downloadFileBytes(token, data.sourceFileId)
        uploadMime = isNativeDoc ? DOCX_MIME : meta.mimeType
        pruneSourceCache()
        sourceCache.set(cacheKey, { bytes: sourceBytes, mime: uploadMime, at: Date.now() })
      }

      // Sequential on purpose: predictable order and comfortably inside
      // Drive/Docs per-user rate limits even for large batches.
      for (const job of data.jobs) {
        // Re-checked per job: a long batch can outlive one access token.
        token = await g.getAccessToken(user.id)
        const name = safeName(job.name)
        const copyId = await g.withRetry(() => g.uploadAsGoogleDoc(token, name, sourceBytes, uploadMime))
        try {
          const flat = job.replacements.flatMap((r) =>
            r.finds.map((find) => ({ tag: r.tag, find, replace: r.replace })),
          )
          const results = await g.withRetry(() =>
            g.replaceAllTextInDoc(token, copyId, flat.map(({ find, replace }) => ({ find, replace }))),
          )
          // A tag is unmatched only when NONE of its spellings hit (extra
          // canonical variants legitimately match nothing).
          const hits = new Map<string, number>()
          results.forEach((res, i) => {
            const tag = flat[i].tag
            hits.set(tag, (hits.get(tag) ?? 0) + res.occurrences)
          })
          for (const [tag, count] of hits) if (count === 0) unmatched.add(tag)

          for (const format of formats) {
            const bytes = await g.withRetry(() =>
              g.exportFile(
                token,
                copyId,
                FORMAT_MIME[format],
                `Google no pudo generar el ${format === 'pdf' ? 'PDF' : 'documento Word'}.`,
              ),
            )
            files.push({ name: `${name}.${format}`, base64: Buffer.from(bytes).toString('base64') })
          }
        } finally {
          void g.deleteFile(token, copyId)
        }
      }
    } catch (err) {
      if (err instanceof g.GoogleError) {
        return { ok: false, error: err.message, hint: err.hint }
      }
      return {
        ok: false,
        error: 'No se pudieron generar los documentos desde el original de Google Drive.',
        hint: 'Comprueba tu conexión a internet e inténtalo de nuevo.',
      }
    }

    return { ok: true, data: { files, unmatched: [...unmatched].sort() } }
  })
