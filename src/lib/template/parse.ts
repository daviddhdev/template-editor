import { parse, HTMLElement } from 'node-html-parser'
import type { BlockType, Template, TemplateBlock } from '../../types'
import { condTexts, decodeCond } from '../cond'
import { tagRe } from '../tagRegex'

export function detectTags(text: string): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const m of text.matchAll(tagRe())) {
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

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'table', 'ul', 'ol'])

const EDITOR_BLOCK_TAGS = new Set([...BLOCK_TAGS, 'div'])

function findContentRoot(root: HTMLElement): HTMLElement {
  const body = root.querySelector('body') ?? root
  let node: HTMLElement = body
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

function walkBlocks(contentRoot: HTMLElement, accept: Set<string>): TemplateBlock[] {
  const blocks: TemplateBlock[] = []
  let index = 0
  for (const child of contentRoot.childNodes) {
    if (!(child instanceof HTMLElement)) continue
    const rawTag = child.rawTagName?.toLowerCase()
    if (!rawTag || !accept.has(rawTag)) continue

    const outer = child.outerHTML
    const text = child.textContent.replace(/\s+/g, ' ').trim()
    // Preserve empty blocks that contain an image or an explicit line break.
    if (!text && !/<img|<br/i.test(outer)) continue

    const cond = child.getAttribute('data-cond') ? decodeCond(child.getAttribute('data-cond')!) : null
    // Count tags inside conditional data and repeat wrappers as well.
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

function extractTitle(root: HTMLElement): string {
  return root.querySelector('title')?.textContent?.trim() || 'Plantilla'
}

function extractCss(root: HTMLElement, contentRoot: HTMLElement): string {
  const sheets = root
    .querySelectorAll('style')
    .map((s) => s.textContent)
    .join('\n')
  const rootStyle = contentRoot.getAttribute('style')?.trim()
  return rootStyle ? `${sheets}\nbody{${rootStyle}}` : sheets
}

export interface RawDocument {
  title: string
  css: string
  bodyHtml: string
  bodyClass: string
}

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

export function parseTemplate(html: string, sourceUrl: string): Template {
  const root = parse(html, { comment: false })
  const contentRoot = findContentRoot(root)
  // Keep inline headers/footers in place to preserve the original layout.
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

let templateCache: {
  args: [string, string, string, string, string]
  template: Template
} | null = null

export function buildTemplateCached(
  bodyHtml: string,
  css: string,
  title: string,
  sourceUrl: string,
  bodyClass = '',
): Template {
  const args: [string, string, string, string, string] = [bodyHtml, css, title, sourceUrl, bodyClass]
  if (templateCache && templateCache.args.every((a, i) => a === args[i])) {
    return templateCache.template
  }
  const template = buildTemplate(bodyHtml, css, title, sourceUrl, bodyClass)
  templateCache = { args, template }
  return template
}
