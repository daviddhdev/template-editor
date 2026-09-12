import { createServerFn } from '@tanstack/react-start'
import { safeName } from '../lib/fileName'
import type { Result } from './fetch'
import { requirePdfJobs, requireRecord } from './validate'

export interface PdfJob {
  name: string
  html: string
}

export interface PdfFile {
  name: string
  base64: string
}

export interface PdfResult {
  files: PdfFile[]
}

export { safeName }

// Load Playwright dynamically through the shared browser pool so it stays out
// of the client bundle.
export const generatePdfFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return { jobs: requirePdfJobs(i.jobs) }
  })
  .handler(async ({ data }): Promise<Result<PdfResult>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    const { acquireBrowser, releaseBrowser } = await import('./browserPool')
    const browser = await acquireBrowser()
    const files: PdfFile[] = []
    try {
      const page = await browser.newPage()
      try {
        for (const job of data.jobs) {
          await page.setContent(job.html, { waitUntil: 'networkidle' })

          // Body padding becomes page margins; keep the browser callback as a
          // string so bundler helpers do not enter the page context.
          const margin = (await page.evaluate(`(() => {
            const cs = getComputedStyle(document.body);
            const val = (v) => (v && parseFloat(v) > 0 ? v : '20mm');
            return { top: val(cs.paddingTop), right: val(cs.paddingRight), bottom: val(cs.paddingBottom), left: val(cs.paddingLeft) };
          })()`)) as { top: string; right: string; bottom: string; left: string }

          // Keep max-width so moving padding to page margins does not change wrapping.
          await page.addStyleTag({
            content: 'html{margin:0 !important;padding:0 !important;}body{margin:0 auto !important;padding:0 !important;}',
          })

          const pdf = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin,
          })
          files.push({
            name: `${safeName(job.name)}.pdf`,
            base64: Buffer.from(pdf).toString('base64'),
          })
        }
      } finally {
        await page.close().catch(() => {})
      }
    } finally {
      releaseBrowser()
    }

    return { ok: true, data: { files } }
  })
