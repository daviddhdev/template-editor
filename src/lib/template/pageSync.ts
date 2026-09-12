import { parse, HTMLElement } from 'node-html-parser'


export const PAGE_BREAK_ATTR = 'data-page-break'

const norm = (s: string) => s.replace(/\s+/g, ' ').trim()

export async function extractPageStartTexts(pdfBytes: Uint8Array): Promise<string[]> {
  // Private docs may return an HTML sign-in page instead of a PDF.
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

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol', 'div'])

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
