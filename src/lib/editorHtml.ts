/**
 * Browser-only helpers that bridge two representations of the template body:
 *
 *  - STORAGE form  — plain HTML where a field is the literal text `{{campo}}`.
 *                    This is what `buildTemplate` consumes downstream.
 *  - DISPLAY form  — the same HTML but each `{{campo}}` wrapped in a
 *                    non-editable "chip" span so it reads as a single, tidy
 *                    token inside the contenteditable editor.
 *
 * `decorateFields` goes storage -> display, `undecorateFields` goes back.
 */

import type { ConditionalRule } from '../types'
import { condSummaryHtml, encodeCond } from './cond'

const FIELD_RE = /\{\{\s*([^{}]+?)\s*\}\}/g

/** Create the non-editable chip element inserted into the editor. */
export function makeFieldChip(name: string, doc: Document = document): HTMLSpanElement {
  const span = doc.createElement('span')
  span.className = 'ttg-chip'
  span.setAttribute('contenteditable', 'false')
  span.dataset.field = name
  span.textContent = `{{${name}}}`
  return span
}

function decoratedFragment(text: string): DocumentFragment {
  const frag = document.createDocumentFragment()
  let last = 0
  let m: RegExpExecArray | null
  FIELD_RE.lastIndex = 0
  while ((m = FIELD_RE.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index))
    frag.append(makeFieldChip(m[1].trim()))
    last = m.index + m[0].length
  }
  if (last < text.length) frag.append(text.slice(last))
  return frag
}

/** Wrap every literal `{{campo}}` in the HTML into a display chip. */
export function decorateFields(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const targets: Text[] = []
  let node: Node | null
  while ((node = walker.nextNode())) {
    const t = node as Text
    if (t.parentElement?.classList.contains('ttg-chip')) continue
    // Text inside an inline conditional is its human summary — never chips.
    if (t.parentElement?.closest('.ttg-cond')) continue
    if (FIELD_RE.test(t.data)) targets.push(t)
  }
  for (const t of targets) t.replaceWith(decoratedFragment(t.data))
  return root.innerHTML
}

/** Turn display chips back into literal `{{campo}}` text. */
export function undecorateFields(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  root.querySelectorAll('.ttg-chip').forEach((el) => {
    const name = (el as HTMLElement).dataset.field ?? el.textContent?.replace(/[{}]/g, '').trim() ?? ''
    el.replaceWith(document.createTextNode(`{{${name}}}`))
  })
  return root.innerHTML
}

/**
 * Confine a document's CSS to a scope selector so it styles the editor preview
 * without leaking to the rest of the app. Google Docs exports bare `body`,
 * `p`, `table`… rules that would otherwise restyle the whole page. `@media` /
 * `@import` / `@font-face` are dropped (not needed for the editing view).
 */
export function scopeCss(css: string, scope: string): string {
  const cleaned = css
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@[a-z-]+[^{;]*\{[\s\S]*?\}\s*\}/gi, '') // @media { ... }
    .replace(/@[^;{}]+;/g, '') // @import ...;
  return cleaned.replace(/([^{}]+)\{([^{}]*)\}/g, (_full, sel: string, decls: string) => {
    const scoped = sel
      .split(',')
      .map((s) => {
        const t = s.trim()
        if (!t) return ''
        if (t === 'body' || t === 'html' || t === ':root') return scope
        return `${scope} ${t}`
      })
      .filter(Boolean)
      .join(', ')
    return scoped ? `${scoped}{${decls}}` : ''
  })
}

/** Base defaults (only matter for a blank doc; the source CSS overrides them). */
const EDITOR_BASE_CSS = `body{font-family:Arial,Helvetica,sans-serif;color:#111;}`

/** Editor-only chrome: a grey canvas, a page shadow, and the field chip. */
const EDITOR_CHROME_CSS = `
  html{background:#eceae7;}
  body{margin:24px auto !important;outline:none;box-shadow:0 2px 8px rgba(15,15,15,.06),0 9px 24px rgba(15,15,15,.1);}
  .ttg-chip{display:inline;background:rgba(0,117,222,.1);color:#0075de;border-radius:4px;padding:1px 6px;margin:0 1px;font-weight:500;white-space:nowrap;cursor:pointer;}
  /* Field whose name matches no data column yet: needs a click to bind. */
  .ttg-chip.ttg-unbound{background:rgba(221,91,0,.08);color:#793400;outline:1px dashed #dd5b00;}
  /* Section repeated once per row of the group. */
  [data-ttg-repeat="true"]{position:relative;border-left:3px solid #2a9d99;padding-left:8px !important;background:rgba(42,157,153,.06);}
  [data-ttg-repeat="true"]::before{content:'se repite por cada fila';position:absolute;top:-9px;left:8px;background:#e3f1f0;color:#1d6f6c;font:600 9px Inter,Arial,sans-serif;letter-spacing:.4px;text-transform:uppercase;padding:1px 6px;border-radius:6px;}
  /* Inline conditional block: shows a readable summary, click to edit. */
  .ttg-cond{display:block;margin:8px 0;padding:8px 12px;border:1px solid rgba(221,91,0,.45);border-radius:8px;background:rgba(221,91,0,.05);color:#793400;font:500 12px/1.6 Inter,Arial,sans-serif;cursor:pointer;}
  .ttg-cond::before{content:'texto condicional — clic para editar';display:block;margin-bottom:2px;color:#dd5b00;font:600 9px Inter,Arial,sans-serif;letter-spacing:.4px;text-transform:uppercase;}
  .ttg-cond .ttg-cond-line{display:block;}
`

/**
 * Full HTML for the editor iframe: the source document's CSS untouched (fonts,
 * page margins, justification…) plus non-editable field chips and a little
 * editing chrome. `spellcheck="false"` removes the browser's word underlines
 * that would otherwise clutter a legal document.
 */
export function buildEditorDocument(css: string, bodyClass: string, decoratedBody: string): string {
  const cls = bodyClass ? ` class="${bodyClass}"` : ''
  return `<!doctype html><html><head><meta charset="utf-8">
<style>${EDITOR_BASE_CSS}</style>
<style>${css}</style>
<style>${EDITOR_CHROME_CSS}</style>
</head><body${cls} contenteditable="true" spellcheck="false">${decoratedBody}</body></html>`
}

/** Field names currently present in a piece of HTML/text, in order. */
export function fieldsIn(html: string): string[] {
  const out: string[] = []
  let m: RegExpExecArray | null
  FIELD_RE.lastIndex = 0
  while ((m = FIELD_RE.exec(html))) out.push(m[1].trim())
  return out
}

/** Create (or refresh) the inline-conditional block element for the editor. */
export function applyCondToElement(el: HTMLElement, rule: ConditionalRule): void {
  el.className = 'ttg-cond'
  el.setAttribute('contenteditable', 'false')
  el.setAttribute('data-cond', encodeCond(rule))
  el.innerHTML = condSummaryHtml(rule)
}

export function makeCondElement(rule: ConditionalRule, doc: Document = document): HTMLElement {
  const el = doc.createElement('div')
  applyCondToElement(el, rule)
  return el
}
