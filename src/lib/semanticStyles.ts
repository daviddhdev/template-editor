import { parse } from 'node-html-parser'

/**
 * Reinforce inline CSS emphasis with semantic tags for Google's HTML
 * importer. The editor (execCommand with styleWithCSS) emits styles like
 * `<span style="font-weight: bold">…</span>`; Google Docs' HTML→Doc
 * conversion is documented (see googleNative.ts) to degrade font weights
 * carried as CSS, while it reliably honours <b>/<i>/<u>/<s>. Wrapping the
 * styled element's content keeps the CSS (harmless elsewhere) and gives the
 * importer a signal it understands.
 *
 * Only used on the HTML uploaded to Google — the local preview/PDF render
 * the CSS correctly and never need this.
 */

const BOLD_RE = /font-weight\s*:\s*(bold|bolder|[6-9]00)\b/i
const ITALIC_RE = /font-style\s*:\s*italic\b/i
const UNDERLINE_RE = /text-decoration(?:-line)?\s*:\s*[^;]*\bunderline\b/i
const STRIKE_RE = /text-decoration(?:-line)?\s*:\s*[^;]*\bline-through\b/i

export function emphasizeInlineStyles(html: string): string {
  if (!/style\s*=/i.test(html)) return html
  const root = parse(`<div id="__root">${html}</div>`, { comment: false })
  for (const el of root.querySelectorAll('[style]')) {
    const style = el.getAttribute('style') ?? ''
    const inner = el.innerHTML
    if (!inner.trim()) continue
    let wrapped = inner
    if (STRIKE_RE.test(style)) wrapped = `<s>${wrapped}</s>`
    if (UNDERLINE_RE.test(style)) wrapped = `<u>${wrapped}</u>`
    if (ITALIC_RE.test(style)) wrapped = `<i>${wrapped}</i>`
    if (BOLD_RE.test(style)) wrapped = `<b>${wrapped}</b>`
    if (wrapped !== inner) el.set_content(wrapped)
  }
  return root.querySelector('#__root')!.innerHTML
}
