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
import { escapeHtml } from './html'
import { tagRe } from './tagRegex'

// Module-local instance (this file resets lastIndex around every use).
const FIELD_RE = tagRe()

/** Create the non-editable chip element inserted into the editor. */
export function makeFieldChip(name: string, doc: Document = document): HTMLSpanElement {
  const span = doc.createElement('span')
  span.className = 'ttg-chip'
  span.setAttribute('contenteditable', 'false')
  span.dataset.field = name
  span.textContent = `{{${name}}}`
  return span
}

/**
 * Caret anchor placed after every chip in DISPLAY form: with the chip being
 * contenteditable=false, a chip at the end of a block leaves the caret no
 * text position to its right — you could not type after it. Stripped back
 * out by undecorateFields, so the STORAGE form (and the fingerprints built
 * from it) never contains it.
 *
 * NOTE: the string below and the two regexes contain the INVISIBLE character
 * U+200B (zero width space) — do not "clean it up".
 */
export const CARET_ANCHOR = '​'
const ZWSP_ONLY_RE = /^​*$/
const ZWSP_RE = /​/g

/** True for a text node that is only caret anchors (safe to skip/remove). */
export function isAnchorText(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && ZWSP_ONLY_RE.test((node as Text).data)
}

function decoratedFragment(text: string, doc: Document = document): DocumentFragment {
  const frag = doc.createDocumentFragment()
  let last = 0
  let m: RegExpExecArray | null
  FIELD_RE.lastIndex = 0
  while ((m = FIELD_RE.exec(text))) {
    if (m.index > last) frag.append(text.slice(last, m.index))
    frag.append(makeFieldChip(m[1].trim(), doc))
    frag.append(doc.createTextNode(CARET_ANCHOR))
    last = m.index + m[0].length
  }
  if (last < text.length) frag.append(text.slice(last))
  return frag
}

/**
 * Turn a LIVE text node's complete `{{campo}}` occurrences into chips, in
 * place (used while typing — decorateFields only runs when the document is
 * (re)written). Returns the replacement's last node so the caller can
 * re-anchor the caret, or null when the node has no complete field.
 */
export function decorateTextNodeLive(t: Text, doc: Document): Node | null {
  FIELD_RE.lastIndex = 0
  if (!FIELD_RE.test(t.data)) return null
  const frag = decoratedFragment(t.data, doc)
  const last = frag.lastChild
  t.replaceWith(frag)
  return last
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
    FIELD_RE.lastIndex = 0 // global regex: a stale lastIndex would skip fields
    if (FIELD_RE.test(t.data)) targets.push(t)
  }
  for (const t of targets) t.replaceWith(decoratedFragment(t.data))
  return root.innerHTML
}

/** Turn display chips back into literal `{{campo}}` text (and strip the
 * caret anchors, so STORAGE form — and fingerprints — never see them). */
export function undecorateFields(html: string): string {
  const root = document.createElement('div')
  root.innerHTML = html
  root.querySelectorAll('.ttg-chip').forEach((el) => {
    const name = (el as HTMLElement).dataset.field ?? el.textContent?.replace(/[{}]/g, '').trim() ?? ''
    const literal = `{{${name}}}`
    const textIntact = el.textContent?.replace(ZWSP_RE, '') === literal
    // Formatting can land on a chip two ways (see execFormat), and BOTH must
    // survive the trip to storage:
    //  - wrapping style spans INSIDE it (selection wider than the chip):
    //    unwrap them — `<span style="font-weight:700">{{campo}}</span>`
    //    round-trips (the walker re-chips the text inside the span) and the
    //    engine tolerates markup inside {{…}} (tagHtmlRe);
    //  - mutating the chip's OWN style attribute (selection exactly the
    //    chip — Chromium restyles the matching span instead of wrapping):
    //    re-home that style onto a plain span, or it dies with the chip.
    const ownStyle = el.getAttribute('style')?.trim() ?? ''
    const inner: (Node | string)[] =
      el.querySelector('*') && textIntact
        ? Array.from(el.childNodes)
        : [document.createTextNode(literal)]
    if (ownStyle && textIntact) {
      const span = document.createElement('span')
      span.setAttribute('style', ownStyle)
      span.append(...inner)
      el.replaceWith(span)
    } else {
      el.replaceWith(...inner)
    }
  })
  // Strip the caret anchors added by decoratedFragment.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  const texts: Text[] = []
  let n: Node | null
  while ((n = walker.nextNode())) {
    if ((n as Text).data.includes(CARET_ANCHOR)) texts.push(n as Text)
  }
  for (const t of texts) {
    const cleaned = t.data.replace(ZWSP_RE, '')
    const parent = t.parentElement
    if (cleaned) t.data = cleaned
    else t.remove()
    // Styling next to a chip can leave the anchor wrapped in a span of its
    // own; removing the anchor would leave that empty span behind in storage.
    let p = parent
    while (p && p !== root && p.childNodes.length === 0 && p.tagName === 'SPAN') {
      const up = p.parentElement
      p.remove()
      p = up
    }
  }
  return root.innerHTML
}

/** Base defaults (only matter for a blank doc; the source CSS overrides them). */
const EDITOR_BASE_CSS = `body{font-family:Arial,Helvetica,sans-serif;color:#111;}`

/** Editor-only chrome: a grey canvas, a page shadow, and the field chip. */
const EDITOR_CHROME_CSS = `
  html{background:#eceae7;}
  body{margin:24px auto !important;outline:none;box-shadow:0 2px 8px rgba(15,15,15,.06),0 9px 24px rgba(15,15,15,.1);}
  /* No font-weight of its own: the chip must INHERIT bold/italic applied to
     the text around it, or formatting a selection with a field would show
     everything bold except the field. */
  .ttg-chip{display:inline;background:rgba(0,117,222,.1);color:#0075de;border-radius:4px;padding:1px 6px;margin:0 1px;white-space:nowrap;cursor:pointer;}
  /* Field whose name matches no data column yet: needs a click to bind. */
  .ttg-chip.ttg-unbound{background:rgba(221,91,0,.08);color:#793400;outline:1px dashed #dd5b00;}
  /* Field bound to a rule (anchored conditional / repeatable section). */
  .ttg-chip.ttg-rulebound{background:rgba(42,157,153,.12);color:#1d6f6c;outline:1px solid rgba(42,157,153,.5);}
  /* Section repeated once per row of the group. The label sits IN FLOW (same
     pattern as .ttg-cond::before): an absolutely-positioned pill overflowed
     narrow sections and overlapped the first content line.
     toggleRepeat always marks a WRAPPER <div> (full width, no inherited
     paragraph geometry), but documents saved before that marked the block
     element itself — the ::before resets below (text-indent, text-align,
     margin-left) keep the label in place inside those too, where the
     paragraph's own negative text-indent pushed it out of the box. */
  [data-ttg-repeat="true"]{border-left:3px solid #2a9d99;padding:6px 8px 8px !important;background:rgba(42,157,153,.06);border-radius:0 6px 6px 0;}
  [data-ttg-repeat="true"]::before{content:'se repite por cada fila';display:block;margin:0 0 4px;color:#1d6f6c;font:600 9px Inter,Arial,sans-serif;letter-spacing:.4px;text-transform:uppercase;text-indent:0;text-align:left;margin-left:0;}
  /* Inline conditional block: shows a readable summary, click to edit. */
  .ttg-cond{display:block;margin:8px 0;padding:8px 12px;border:1px solid rgba(221,91,0,.45);border-radius:8px;background:rgba(221,91,0,.05);color:#793400;font:500 12px/1.6 Inter,Arial,sans-serif;cursor:pointer;}
  .ttg-cond::before{content:'texto condicional — clic para editar';display:block;margin-bottom:2px;color:#dd5b00;font:600 9px Inter,Arial,sans-serif;letter-spacing:.4px;text-transform:uppercase;}
  .ttg-cond .ttg-cond-line{display:block;}
  /* Insertion caret shown while dragging a column over the document. */
  .ttg-drop-caret{position:absolute;width:2px;border-radius:1px;background:#0075de;pointer-events:none;display:none;z-index:9999;}
`

/**
 * Full HTML for the editor iframe: the source document's CSS untouched (fonts,
 * page margins, justification…) plus non-editable field chips and a little
 * editing chrome. `spellcheck="false"` removes the browser's word underlines
 * that would otherwise clutter a legal document.
 */
export function buildEditorDocument(css: string, bodyClass: string, decoratedBody: string): string {
  // Escaped: a quote inside the class attribute would break out of it.
  const cls = bodyClass ? ` class="${escapeHtml(bodyClass)}"` : ''
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
