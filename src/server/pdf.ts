import { createServerFn } from '@tanstack/react-start'
import { safeName } from '../lib/fileName'
import { requirePdfJobs, requireRecord } from './validate'

/** One document to render: a display name and its standalone HTML. */
export interface PdfJob {
  name: string
  html: string
}

export interface PdfFile {
  name: string
  /** PDF bytes, base64-encoded for JSON transport. */
  base64: string
}

export interface PdfResult {
  files: PdfFile[]
}

export { safeName }

/**
 * Render every job to a PDF with headless Chromium (Playwright, via the
 * shared pool in browserPool.ts — imported dynamically inside the handler so
 * nothing playwright-shaped ever reaches the client bundle).
 */
export const generatePdfFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return { jobs: requirePdfJobs(i.jobs) }
  })
  .handler(async ({ data }): Promise<PdfResult> => {
    const { acquireBrowser, releaseBrowser } = await import('./browserPool')
    const browser = await acquireBrowser()
    const files: PdfFile[] = []
    try {
      const page = await browser.newPage()
      try {
        for (const job of data.jobs) {
          await page.setContent(job.html, { waitUntil: 'networkidle' })

          // The source doc expresses its page margins as padding on the body.
          // Read them, then move them to REAL page margins so they repeat on
          // every page (body padding would only pad the first & last page).
          // NOTE: passed as a string so no bundler helper (esbuild's __name)
          // leaks into the browser context. Do NOT put a `\s` regex inside
          // this string — the backslash does not survive the round-trip and
          // `/\s+/` silently becomes `/s+/`, which eats every letter "s".
          const margin = (await page.evaluate(`(() => {
            const cs = getComputedStyle(document.body);
            const val = (v) => (v && parseFloat(v) > 0 ? v : '20mm');
            return { top: val(cs.paddingTop), right: val(cs.paddingRight), bottom: val(cs.paddingBottom), left: val(cs.paddingLeft) };
          })()`)) as { top: string; right: string; bottom: string; left: string }

          // Zero the padding (now handled by the page margin) but KEEP the
          // doc's own content width (max-width) so line wrapping — and
          // therefore where the page breaks fall — stays identical to the
          // original. Centre it in the page's content box.
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
        // Close even when a render throws — leaked pages pile up in the
        // long-lived shared browser.
        await page.close().catch(() => {})
      }
    } finally {
      releaseBrowser()
    }

    // No server-side zip: the dialog sends ONE job per request for live
    // progress and bundles the final zip in the browser (downloadAll).
    return { files }
  })
