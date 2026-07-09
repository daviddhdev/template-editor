import { parse, HTMLElement } from 'node-html-parser'

/**
 * Page-break synchronisation with the source document's OWN pagination.
 *
 * Google Docs lays text out with its own engine (Kix); Chromium's print
 * engine breaks pages slightly differently, and the drift accumulates over a
 * long document. But Google also exposes the doc's exact pagination for free:
 * the public PDF export. We read where each of its pages STARTS and, when a
 * page starts exactly at a block boundary, we mark that block with a
 * `data-page-break` attribute. A print CSS rule (`break-before: page`) then
 * forces our PDF to break at the same points — the drift resets at every
 * marker instead of accumulating.
 *
 * Pages that start mid-paragraph (the original splits a paragraph across two
 * pages) are left alone: forcing those would split justified text unnaturally,
 * and the surrounding sync points keep the drift within a line or two.
 *
 * The attribute travels INSIDE the editable HTML through the whole pipeline
 * (editor -> template -> resolve -> PDF), so no extra model state is needed,
 * and the editor lets the user toggle the same attribute manually.
 */

/** Attribute marking "this block starts a new page in the original". */
export const PAGE_BREAK_ATTR = 'data-page-break'

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

/**
 * Extract the text each page STARTS with (pages 2..N) from a PDF's bytes.
 * Server-only (pdfjs is imported dynamically so it never reaches the client
 * bundle). Returns [] when the bytes are not a readable PDF.
 */
export async function extractPageStartTexts(pdfBytes: Uint8Array): Promise<string[]> {
  // Quick magic check: private docs return an HTML sign-in page, not a PDF.
  const head = String.fromCharCode(...pdfBytes.slice(0, 5))
  if (head !== '%PDF-') return []
  try {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs')
    const doc = await getDocument({ data: pdfBytes }).promise
    const starts: string[] = []
    for (let i = 2; i <= doc.numPages; i++) {
      const page = await doc.getPage(i)
      const tc = await page.getTextContent()
      const text = norm(
        (tc.items as { str?: string }[]).map((it) => it.str ?? '').join(' '),
      )
      if (text) starts.push(text.slice(0, 80))
    }
    await doc.cleanup()
    return starts
  } catch {
    return []
  }
}

/** Block-level tags considered when matching page starts. */
const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol', 'div'])

/**
 * Mark the blocks of `bodyHtml` where the original document starts a new page.
 * Matching is ordered (a later page never matches an earlier block), which
 * keeps repeated lines (e.g. a bulletin footer, one per page with a different
 * page number) from colliding.
 *
 * Returns the annotated HTML plus how many page starts found their block.
 */
export function annotatePageBreaks(
  bodyHtml: string,
  pageStartTexts: string[],
): { html: string; marked: number } {
  if (pageStartTexts.length === 0) return { html: bodyHtml, marked: 0 }

  const root = parse(`<div id="__root">${bodyHtml}</div>`, { comment: false })
  const contentRoot = root.querySelector('#__root')!
  const blocks = contentRoot.childNodes.filter(
    (c): c is HTMLElement =>
      c instanceof HTMLElement && BLOCK_TAGS.has(c.rawTagName?.toLowerCase()),
  )
  const blockTexts = blocks.map((b) => norm(b.textContent))

  let cursor = 0
  let marked = 0
  for (const start of pageStartTexts) {
    const prefix = start.slice(0, 40)
    for (let i = cursor; i < blocks.length; i++) {
      const bt = blockTexts[i]
      if (!bt) continue
      // Long block: its text starts with the page-start prefix.
      // Short block (e.g. a heading): the page start begins with the block.
      const hit = bt.startsWith(prefix) || (bt.length >= 15 && start.startsWith(bt))
      if (hit) {
        blocks[i].setAttribute(PAGE_BREAK_ATTR, 'true')
        cursor = i + 1
        marked++
        break
      }
    }
  }

  return { html: contentRoot.innerHTML, marked }
}
