import { createServerFn } from '@tanstack/react-start'

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
  /** All files zipped together, base64-encoded (present when >1 file). */
  zipBase64: string | null
}

/** Make a file-system-safe base name. */
export function safeName(name: string): string {
  const cleaned = name.replace(/[^\p{L}\p{N} _.-]/gu, '').trim()
  return (cleaned || 'documento').slice(0, 80)
}


/**
 * Render every job to a PDF with headless Chromium (Playwright), then bundle
 * them into a zip when there is more than one.
 *
 * Playwright and jszip are imported dynamically so they never end up in the
 * client bundle — this handler only ever runs on the server.
 */
export const generatePdfFn = createServerFn({ method: 'POST' })
  .validator((input: { jobs: PdfJob[] }) => input)
  .handler(async ({ data }): Promise<PdfResult> => {
    const { chromium } = await import('playwright')

    const browser = await chromium.launch()
    const files: PdfFile[] = []
    try {
      const page = await browser.newPage()
      for (const job of data.jobs) {
        await page.setContent(job.html, { waitUntil: 'networkidle' })

        // Read (as a string, so no bundler helper like esbuild's __name leaks
        // into the browser):
        //  - the page margins, which the source doc expresses as body padding;
        //  - the running header/footer lines + their real styling, from the
        //    off-screen measurers injected by buildDocumentHtml.
        // The source doc expresses its page margins as padding on the body.
        // Read them, then move them to REAL page margins so they repeat on
        // every page (body padding would only pad the first & last page).
        // NOTE: passed as a string so no bundler helper (esbuild's __name)
        // leaks into the browser context. Do NOT put a `\s` regex inside this
        // string — the backslash does not survive the round-trip and `/\s+/`
        // silently becomes `/s+/`, which eats every letter "s".
        const margin = (await page.evaluate(`(() => {
          const cs = getComputedStyle(document.body);
          const val = (v) => (v && parseFloat(v) > 0 ? v : '20mm');
          return { top: val(cs.paddingTop), right: val(cs.paddingRight), bottom: val(cs.paddingBottom), left: val(cs.paddingLeft) };
        })()`)) as { top: string; right: string; bottom: string; left: string }

        // Zero the padding (now handled by the page margin) but KEEP the doc's
        // own content width (max-width) so line wrapping — and therefore where
        // the page breaks fall — stays identical to the original. Centre it in
        // the page's content box.
        await page.addStyleTag({
          content: 'html{margin:0 !important;padding:0 !important;}body{margin:0 auto !important;padding:0 !important;}',
        })

        const pdf = await page.pdf({
          format: 'A4',
          printBackground: true,
          margin,
        })
        files.push({ name: `${safeName(job.name)}.pdf`, base64: Buffer.from(pdf).toString('base64') })
      }
      await page.close()
    } finally {
      await browser.close()
    }

    let zipBase64: string | null = null
    if (files.length > 1) {
      const JSZip = (await import('jszip')).default
      const zip = new JSZip()
      for (const f of files) zip.file(f.name, f.base64, { base64: true })
      const buf = await zip.generateAsync({ type: 'nodebuffer' })
      zipBase64 = buf.toString('base64')
    }

    return { files, zipBase64 }
  })
