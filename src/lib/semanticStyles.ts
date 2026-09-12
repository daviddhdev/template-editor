import { parse } from 'node-html-parser'

// Google preserves semantic emphasis tags more reliably than CSS-only styles.

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
