import { parse, HTMLElement } from 'node-html-parser'
import type { BlockType, Template, TemplateBlock } from '../../types'
import { condTexts, decodeCond } from '../cond'

/**
 * The tag syntax used in templates: {{ campo }}. We tolerate whitespace and,
 * during substitution, inline markup between the braces (Google Docs likes to
 * split a run into several <span>s). Detection works on plain text where the
 * runs are already concatenated.
 */
const TAG_TEXT_RE = /\{\{\s*([^{}]+?)\s*\}\}/g

/** Unique tag names found in a plain-text string, in first-seen order. */
export function detectTags(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(TAG_TEXT_RE)) {
    const name = m[1].trim()
    if (name && !seen.has(name)) {
      seen.add(name)
      out.push(name)
    }
  }
  return out
}

function blockType(tag: string): BlockType {
  const t = tag.toLowerCase()
  if (t === 'table') return 'table'
  if (/^h[1-6]$/.test(t)) return 'heading'
  if (t === 'ul' || t === 'ol') return 'list'
  if (t === 'p' || t === 'div') return 'paragraph'
  return 'other'
}

/** Elements treated as top-level document blocks when reading a Google export. */
const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol'])

/** Same, plus <div>, for content authored in our in-app editor. */
const EDITOR_BLOCK_TAGS = new Set([...BLOCK_TAGS, 'div'])

/** Find the element that actually holds the content blocks. */
function findContentRoot(root: HTMLElement): HTMLElement {
  const body = root.querySelector('body') ?? root
  let node: HTMLElement = body
  // Google wraps everything in nested <div>s; descend through single wrappers.
  for (let i = 0; i < 5; i++) {
    const elementChildren = node.childNodes.filter(
      (c): c is HTMLElement => c instanceof HTMLElement,
    )
    const hasBlocks = elementChildren.some((c) => BLOCK_TAGS.has(c.rawTagName?.toLowerCase()))
    if (hasBlocks) return node
    const onlyDiv = elementChildren.length === 1 && elementChildren[0].rawTagName?.toLowerCase() === 'div'
    if (onlyDiv) node = elementChildren[0]
    else return node
  }
  return node
}

/** Walk a content root's direct children into ordered template blocks. */
function walkBlocks(contentRoot: HTMLElement, accept: Set<string>): TemplateBlock[] {
  const blocks: TemplateBlock[] = []
  let index = 0
  for (const child of contentRoot.childNodes) {
    if (!(child instanceof HTMLElement)) continue
    const rawTag = child.rawTagName?.toLowerCase()
    if (!rawTag || !accept.has(rawTag)) continue

    const outer = child.outerHTML
    const text = child.textContent.replace(/\s+/g, ' ').trim()
    // A block with no text and no image is skipped (empty spacer paragraphs).
    if (!text && !/<img/i.test(outer)) continue

    const cond = child.getAttribute('data-cond') ? decodeCond(child.getAttribute('data-cond')!) : null
    // Inline conditionals may hide {{campos}} inside their branch texts (the
    // rule JSON), and a repeat wrapper may hold nested conditionals — count
    // those tags too so the binding checks see them.
    const nestedCondTexts = child
      .querySelectorAll('[data-cond]')
      .map((el) => {
        const rule = decodeCond(el.getAttribute('data-cond') ?? '')
        return rule ? condTexts(rule) : ''
      })
      .join('\n')
    const tagSource = cond ? condTexts(cond) : `${child.textContent}\n${nestedCondTexts}`

    blocks.push({
      id: `block-${index++}`,
      type: blockType(rawTag),
      html: outer,
      text,
      tags: detectTags(tagSource),
      repeat: child.getAttribute('data-ttg-repeat') === 'true',
      cond,
    })
  }
  return blocks
}

/** The document title (Google export puts the doc name in <title>). */
function extractTitle(root: HTMLElement): string {
  return root.querySelector('title')?.textContent?.trim() || 'Plantilla'
}

/**
 * Concatenated <style> CSS, kept so previews/PDF match the original doc.
 *
 * The Drive API's HTML export (used for private docs) carries NO <style> at
 * all: every element is styled inline, and the page geometry (background,
 * max-width, page margins as padding) is an inline style on the <body>. That
 * body style would otherwise be lost — bodyHtml is the body's innerHTML — so
 * it is preserved here as a `body { … }` rule. Public exports have a real
 * stylesheet and no body style attribute, so this adds nothing for them.
 */
function extractCss(root: HTMLElement, contentRoot: HTMLElement): string {
  const sheets = root
    .querySelectorAll('style')
    .map((s) => s.textContent)
    .join('\n')
  const rootStyle = contentRoot.getAttribute('style')?.trim()
  return rootStyle ? `${sheets}\nbody{${rootStyle}}` : sheets
}

/** The raw content (css + editable body HTML + page class) fed into the editor. */
export interface RawDocument {
  title: string
  css: string
  bodyHtml: string
  /** Class of the content root, carrying the page geometry (see Template.bodyClass). */
  bodyClass: string
}

/**
 * Pull the editable content out of a full HTML export, without turning it into
 * blocks yet. Used to load a Google Doc into the editor where the user can then
 * insert fields.
 */
export function extractDocument(html: string): RawDocument {
  const root = parse(html, { comment: false })
  const contentRoot = findContentRoot(root)
  return {
    title: extractTitle(root),
    css: extractCss(root, contentRoot),
    bodyHtml: contentRoot.innerHTML,
    bodyClass: contentRoot.getAttribute('class') ?? '',
  }
}

/**
 * Parse a full Google Doc HTML export into our Template model.
 * Pure: give it the HTML string, get back blocks + detected tags + the doc CSS.
 */
export function parseTemplate(html: string, sourceUrl: string): Template {
  const root = parse(html, { comment: false })
  const contentRoot = findContentRoot(root)
  // NOTE: any running header/footer lines the source doc repeats inline (e.g.
  // a bulletin's "Boletín Oficial…" line once per page) are kept in the flow
  // ON PURPOSE: that is exactly how the original document renders them, with
  // their own classes (size, alignment, spacing). Extracting them into real
  // page-margin headers/footers was tried and looked LESS like the original.
  const blocks = walkBlocks(contentRoot, BLOCK_TAGS)
  return {
    sourceUrl,
    title: extractTitle(root),
    css: extractCss(root, contentRoot),
    bodyClass: contentRoot.getAttribute('class') ?? '',
    blocks,
    tags: uniqueTags(blocks),
  }
}

/** Unique tag names across all blocks (incl. inline conditionals), in order. */
function uniqueTags(blocks: TemplateBlock[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const b of blocks)
    for (const t of b.tags)
      if (!seen.has(t)) {
        seen.add(t)
        out.push(t)
      }
  return out
}

/**
 * Build a Template from body HTML edited in the in-app editor (plus the CSS and
 * page class kept from the source doc). Accepts <div> blocks since
 * contenteditable emits them. The rest of the pipeline is identical whether the
 * fields were typed in Google Docs or inserted here.
 */
export function buildTemplate(
  bodyHtml: string,
  css: string,
  title: string,
  sourceUrl: string,
  bodyClass = '',
): Template {
  const root = parse(`<div id="__root">${bodyHtml}</div>`, { comment: false })
  const contentRoot = root.querySelector('#__root')!
  const blocks = walkBlocks(contentRoot, EDITOR_BLOCK_TAGS)
  return { sourceUrl, title, css, bodyClass, blocks, tags: uniqueTags(blocks) }
}
