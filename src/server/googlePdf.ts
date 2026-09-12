import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import { safeName, type PdfFile, type PdfResult } from './pdf'
import { optionalFormats, requirePdfJobs, requireRecord } from './validate'

export type GoogleFormat = 'pdf' | 'docx'

export const FORMAT_MIME: Record<GoogleFormat, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

export const generateGooglePdfFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return { jobs: requirePdfJobs(i.jobs), formats: optionalFormats(i.formats) }
  })
  .handler(async ({ data }): Promise<Result<PdfResult>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    const g = await import('./googleClient')
    const formats: GoogleFormat[] =
      data.formats && data.formats.length > 0 ? data.formats : ['pdf']

    const files: PdfFile[] = []
    try {
      for (const job of data.jobs) {
        const { emphasizeInlineStyles } = await import('../lib/semanticStyles')
        // Chromium markers would double page breaks; Google paginates natively.
        const html = emphasizeInlineStyles(job.html.replace(/\sdata-page-break="true"/g, ''))

        const token = await g.getAccessToken(user.id)
        const name = safeName(job.name)
        const fileId = await g.uploadHtmlAsDoc(token, name, html)
        try {
          for (const format of formats) {
            // Refresh the token per job; a long batch can outlive one token.
            const bytes = await g.exportFile(
              token,
              fileId,
              FORMAT_MIME[format],
              `Google no pudo generar el ${format === 'pdf' ? 'PDF' : 'documento Word'}.`,
            )
            files.push({
              name: `${name}.${format}`,
              base64: Buffer.from(bytes).toString('base64'),
            })
          }
        } finally {
          void g.deleteFile(token, fileId)
        }
      }
    } catch (err) {
      if (err instanceof g.GoogleError) {
        return { ok: false, error: err.message, hint: err.hint }
      }
      return {
        ok: false,
        error: 'No se pudieron generar los PDF con Google.',
        hint: 'Comprueba tu conexión a internet e inténtalo de nuevo.',
      }
    }

    return { ok: true, data: { files } }
  })
