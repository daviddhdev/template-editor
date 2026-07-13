import { HTMLElement, Node, TextNode, parse } from 'node-html-parser'
import type { ConditionalRule, ConditionalTextStyle, RuleBindings } from '../types'
import { escapeHtml } from './html'

const BLOCK_TAGS = new Set(['p', 'div'])
const INLINE_TAGS = new Set(['span', 'strong', 'b', 'em', 'i', 'u'])
const DROP_CONTENT_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed', 'svg', 'math'])

function styleMap(raw: string): Map<string, string> {
  const out = new Map<string, string>()
  for (const declaration of raw.split(';')) {
    const colon = declaration.indexOf(':')
    if (colon < 0) continue
    const property = declaration.slice(0, colon).trim().toLowerCase()
    const value = declaration.slice(colon + 1).trim().toLowerCase()
    if (property && value) out.set(property, value)
  }
  return out
}

function inlineStyle(el: HTMLElement): string {
  const styles = styleMap(el.getAttribute('style') ?? '')
  const declarations: string[] = []
  const tag = el.rawTagName.toLowerCase()
  const weight = styles.get('font-weight')
  if (tag === 'strong' || tag === 'b' || weight === 'bold' || Number(weight) >= 600) {
    declarations.push('font-weight:bold')
  }
  const fontStyle = styles.get('font-style')
  if (tag === 'em' || tag === 'i' || fontStyle === 'italic') {
    declarations.push('font-style:italic')
  }
  const decoration = `${styles.get('text-decoration') ?? ''} ${styles.get('text-decoration-line') ?? ''}`
  if (tag === 'u' || decoration.includes('underline')) {
    declarations.push('text-decoration:underline')
  }
  return declarations.join(';')
}

function alignmentStyle(el: HTMLElement): string {
  const align = styleMap(el.getAttribute('style') ?? '').get('text-align')
  if (!align || !['left', 'center', 'right', 'justify', 'start', 'end'].includes(align)) return ''
  return `text-align:${align}`
}

function sanitiseNode(node: Node): string {
  if (node instanceof TextNode) return escapeHtml(node.rawText)
  if (!(node instanceof HTMLElement)) return ''
  const tag = node.rawTagName.toLowerCase()
  if (DROP_CONTENT_TAGS.has(tag)) return ''
  if (tag === 'br') return '<br>'
  const children = node.childNodes.map(sanitiseNode).join('')
  if (BLOCK_TAGS.has(tag)) {
    const style = alignmentStyle(node)
    return `<p${style ? ` style="${style}"` : ''}>${children || '<br>'}</p>`
  }
  if (INLINE_TAGS.has(tag)) {
    const style = inlineStyle(node)
    return style ? `<span style="${style}">${children}</span>` : children
  }
  return children
}

/** Canonical, allow-listed fragment safe to persist and render. */
export function sanitizeRichText(html: string): string {
  const root = parse(`<div id="__rich">${html}</div>`, { comment: false }).querySelector('#__rich')!
  const lines: string[] = []
  let inline = ''
  const flushInline = () => {
    if (!inline) return
    lines.push(`<p>${inline}</p>`)
    inline = ''
  }
  for (const child of root.childNodes) {
    const rendered = sanitiseNode(child)
    const isBlock = child instanceof HTMLElement && BLOCK_TAGS.has(child.rawTagName.toLowerCase())
    if (isBlock || rendered.includes('<p')) {
      flushInline()
      if (rendered) lines.push(rendered)
    } else {
      inline += rendered
    }
  }
  flushInline()
  return lines.join('') || '<p><br></p>'
}

/** Visible text with paragraph/line boundaries restored. */
export function richTextToPlainText(html: string): string {
  const canonical = sanitizeRichText(html)
    .replace(/<p(?:\s+style="[^"]*")?><br><\/p>/gi, '<p></p>')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
  const text = parse(`<div>${canonical}</div>`, { comment: false }).textContent
  return text.replace(/\u00a0/g, ' ').replace(/\n$/, '')
}

/** Plain text -> the contenteditable representation used by CondEditor. */
export function plainTextToRichHtml(text: string): string {
  return text
    .split(/\r?\n/)
    .map((line) => `<p>${line ? escapeHtml(line) : '<br>'}</p>`)
    .join('') || '<p><br></p>'
}

export interface NormalizedRichText {
  text: string
  /** Only present when bold/italic/underline/alignment remains. */
  html?: string
}

/** Collapse a contenteditable value back to the dual persisted form. */
export function normalizeRichText(html: string): NormalizedRichText {
  const sanitized = sanitizeRichText(html)
  const formatted = /<(?:span|p)\s+style="/.test(sanitized)
  return {
    text: richTextToPlainText(sanitized),
    ...(formatted ? { html: sanitized } : {}),
  }
}

function safeCssValue(value: string | undefined, kind: 'font' | 'size' | 'line' | 'color'): string | null {
  const v = value?.trim()
  if (!v || /[;{}<>]|url\s*\(/i.test(v)) return null
  if (kind === 'size' && !/^(?:\d+(?:\.\d+)?)(?:px|pt|pc|em|rem|%)$/i.test(v)) return null
  if (kind === 'line' && !/^(?:normal|\d+(?:\.\d+)?(?:px|pt|pc|em|rem|%)?)$/i.test(v)) return null
  if (kind === 'color' && !/^(?:#[\da-f]{3,8}|rgba?\([\d.,%\s]+\)|hsla?\([\d.,%\s]+\)|[a-z]+)$/i.test(v)) return null
  return v
}

/** Validate style contexts before putting them back into an HTML attribute. */
export function sanitizeConditionalTextStyle(
  style: ConditionalTextStyle | undefined,
): ConditionalTextStyle | undefined {
  if (!style) return undefined
  const clean: ConditionalTextStyle = {}
  const fontFamily = safeCssValue(style.fontFamily, 'font')
  const fontSize = safeCssValue(style.fontSize, 'size')
  const lineHeight = safeCssValue(style.lineHeight, 'line')
  const color = safeCssValue(style.color, 'color')
  if (fontFamily) clean.fontFamily = fontFamily
  if (fontSize) clean.fontSize = fontSize
  if (lineHeight) clean.lineHeight = lineHeight
  if (color) clean.color = color
  return Object.keys(clean).length ? clean : undefined
}

export function conditionalTextStyleCss(style: ConditionalTextStyle | undefined): string {
  const clean = sanitizeConditionalTextStyle(style)
  if (!clean) return ''
  return [
    clean.fontFamily && `font-family:${clean.fontFamily}`,
    clean.fontSize && `font-size:${clean.fontSize}`,
    clean.lineHeight && `line-height:${clean.lineHeight}`,
    clean.color && `color:${clean.color}`,
  ]
    .filter(Boolean)
    .join(';')
}

export function conditionalTextStyleReact(
  style: ConditionalTextStyle | undefined,
): Record<string, string> {
  const clean = sanitizeConditionalTextStyle(style)
  return clean
    ? {
        ...(clean.fontFamily ? { fontFamily: clean.fontFamily } : {}),
        ...(clean.fontSize ? { fontSize: clean.fontSize } : {}),
        ...(clean.lineHeight ? { lineHeight: clean.lineHeight } : {}),
        ...(clean.color ? { color: clean.color } : {}),
      }
    : {}
}

function withBaseStyle(html: string, style: ConditionalTextStyle | undefined): string {
  const css = conditionalTextStyleCss(style)
  return css ? `<div style="${escapeHtml(css)}">${html}</div>` : html
}

/** Render canonical rich content as blocks or as a safe inline replacement. */
export function renderRichText(
  html: string,
  mode: 'block' | 'inline',
  style?: ConditionalTextStyle,
): string {
  const canonical = sanitizeRichText(html)
  if (mode === 'block') return withBaseStyle(canonical, style)
  const root = parse(`<div id="__rich">${canonical}</div>`, { comment: false }).querySelector('#__rich')!
  const blockCount = root.childNodes.filter(
    (node) => node instanceof HTMLElement && node.rawTagName.toLowerCase() === 'p',
  ).length
  const pieces = root.childNodes.map((node) => {
    if (!(node instanceof HTMLElement) || node.rawTagName.toLowerCase() !== 'p') return sanitiseNode(node)
    const align = alignmentStyle(node)
    const children = node.childNodes.map(sanitiseNode).join('') || '<br>'
    if (!align && blockCount === 1) return children
    const css = ['display:block', align].filter(Boolean).join(';')
    return `<span style="${css}">${children}</span>`
  })
  const css = conditionalTextStyleCss(style)
  return css
    ? `<span style="${escapeHtml(css)}">${pieces.join('')}</span>`
    : pieces.join('')
}

export function ruleHasRichFormatting(rule: ConditionalRule): boolean {
  return rule.branches.some((branch) => Boolean(branch.textHtml)) || Boolean(rule.defaultTextHtml)
}

export function bindingsHaveRichFormatting(bindings: RuleBindings | undefined): boolean {
  return Boolean(bindings && Object.values(bindings).some((binding) => ruleHasRichFormatting(binding.rule)))
}
