// Native generation reuses the original Drive file. Only unique text edits in
// unchanged leaves become patches; structural or ambiguous edits use HTML.

import { HTMLElement, parse, TextNode } from 'node-html-parser'
import type { GenerationPlan, RuleBindings } from '../types'
import type { NativeFieldStyle, NativeJob, NativeReplacement } from '../server/googleNative'
import { colorToHex, FIELD_STYLE_ATTR, validFontSizePt } from './fieldAppearance'
import { formatTagValue } from './engine/format'
import { resolveBoundTag } from './engine/tagValue'
import { fingerprintCss, fingerprintHtml, hashString, normalizeBodyHtml } from './fingerprint'
import { planGroups } from './plan'
import { bindingsHaveRichFormatting } from './richText'

export interface SourceFileMeta {
  id: string
  fingerprint: string
  cssFingerprint: string
  // Preserve original spacing because replaceAllText matches literal text.
  tagLiterals: Record<string, string[]>
  // Structural signatures distinguish text edits without storing another HTML copy.
  textSegments?: NativeTextSegment[]
  fieldOccurrences?: SourceFieldOccurrence[]
}

export interface SourceFieldOccurrence {
  tag: string
  literal: string
  occurrence: number
}

export interface NativeTextSegment {
  tag: string
  structure: string
  text: string
}

export interface NativeEdit {
  find: string
  replace: string
}

export function upgradeSourceFileMeta(
  sourceFile: SourceFileMeta | null | undefined,
  editorHtml: string,
): SourceFileMeta | null {
  if (!sourceFile) return null
  if (sourceFile.textSegments && sourceFile.fieldOccurrences) return sourceFile
  // Never bless edited HTML as the original for an old recipe.
  if (fingerprintHtml(editorHtml) !== sourceFile.fingerprint) return sourceFile
  return {
    ...sourceFile,
    textSegments: sourceFile.textSegments ?? nativeTextSegments(normalizeBodyHtml(editorHtml)),
    fieldOccurrences: sourceFile.fieldOccurrences ?? sourceFieldOccurrences(editorHtml),
  }
}

const TEXT_CONTAINERS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'td', 'th'])

function structureOf(node: HTMLElement): string {
  const attrs = Object.entries(node.attributes)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, value]) => `${name}=${JSON.stringify(value)}`)
    .join(',')
  const children = node.childNodes
    .map((child) =>
      child instanceof HTMLElement
        ? structureOf(child)
        : child instanceof TextNode
          ? '#'
          : '',
    )
    .join('')
  return `<${node.rawTagName.toLowerCase()}[${attrs}]>${children}</${node.rawTagName.toLowerCase()}>`
}

/** Ordered text leaves; nested paragraph cells contribute paragraphs only. */
export function nativeTextSegments(bodyHtml: string): NativeTextSegment[] {
  const root = parse(`<div id="__native_root">${bodyHtml}</div>`, { comment: false })
  const out: NativeTextSegment[] = []
  const visit = (el: HTMLElement) => {
    const descendants = el.childNodes.filter((child): child is HTMLElement => child instanceof HTMLElement)
    const hasNestedContainer = descendants.some((child) => {
      const tag = child.rawTagName.toLowerCase()
      return TEXT_CONTAINERS.has(tag) || child.querySelector([...TEXT_CONTAINERS].join(',')) !== null
    })
    const tag = el.rawTagName.toLowerCase()
    if (TEXT_CONTAINERS.has(tag) && !hasNestedContainer) {
      // Hash signatures so large base64 image attributes are not duplicated.
      out.push({ tag, structure: hashString(structureOf(el)), text: el.textContent })
      return
    }
    for (const child of descendants) visit(child)
  }
  const content = root.querySelector('#__native_root')!
  for (const child of content.childNodes) if (child instanceof HTMLElement) visit(child)
  return out
}

function countText(haystacks: string[], needle: string): number {
  if (!needle) return 0
  let count = 0
  for (const text of haystacks) {
    let from = 0
    while (from <= text.length - needle.length) {
      const at = text.indexOf(needle, from)
      if (at < 0) break
      count++
      from = at + Math.max(1, needle.length)
    }
  }
  return count
}

function uniqueTextEdit(before: string, after: string, sourceTexts: string[]): NativeEdit | null {
  let prefix = 0
  while (prefix < before.length && prefix < after.length && before[prefix] === after[prefix]) prefix++
  let suffix = 0
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - 1 - suffix] === after[after.length - 1 - suffix]
  )
    suffix++

  const beforeEnd = before.length - suffix
  const afterEnd = after.length - suffix
  let left = prefix
  let right = beforeEnd
  // Anchor pure insertions to an adjacent original character for its style.
  if (left === right) {
    if (left > 0) left--
    else if (right < before.length) right++
    else return null
  }

  let expandLeft = true
  while (true) {
    const find = before.slice(left, right)
    if (countText(sourceTexts, find) === 1) {
      return {
        find,
        replace: `${before.slice(left, prefix)}${after.slice(prefix, afterEnd)}${before.slice(beforeEnd, right)}`,
      }
    }
    if (left === 0 && right === before.length) return null
    if ((expandLeft && left > 0) || right === before.length) left--
    else right++
    expandLeft = !expandLeft
  }
}

export function tagLiterals(bodyHtml: string): Record<string, string[]> {
  const text = parse(`<div id="__root">${bodyHtml}</div>`, { comment: false }).textContent
  const out: Record<string, string[]> = {}
  for (const m of text.matchAll(/\{\{[^{}]*\}\}/g)) {
    const name = m[0].slice(2, -2).trim()
    if (!name) continue
    const literals = (out[name] ??= [])
    if (!literals.includes(m[0])) literals.push(m[0])
  }
  return out
}

export function sourceFieldOccurrences(bodyHtml: string): SourceFieldOccurrence[] {
  const text = parse(`<div id="__root">${bodyHtml}</div>`, { comment: false }).textContent
  const counts = new Map<string, number>()
  const out: SourceFieldOccurrence[] = []
  for (const match of text.matchAll(/\{\{[^{}]*\}\}/g)) {
    const tag = match[0].slice(2, -2).trim()
    if (!tag) continue
    const occurrence = counts.get(tag) ?? 0
    counts.set(tag, occurrence + 1)
    out.push({ tag, literal: match[0], occurrence })
  }
  return out
}

interface ExtractedFieldStyles {
  html: string
  styles: NativeFieldStyle[]
}

// Reject malformed field-style wrappers so arbitrary formatting is never treated
// as a safe native patch.
export function extractNativeFieldStyles(bodyHtml: string): ExtractedFieldStyles | null {
  const root = parse(`<div id="__field_style_root">${bodyHtml}</div>`, { comment: false })
  const content = root.querySelector('#__field_style_root')!
  const wrappers = content.querySelectorAll(`[${FIELD_STYLE_ATTR}]`)
  if (wrappers.length === 0) return { html: bodyHtml, styles: [] }

  const details = new Map<HTMLElement, { tag: string; fontSizePt?: number; colorHex?: string }>()
  for (const wrapper of wrappers) {
    if (wrapper.rawTagName.toLowerCase() !== 'span') return null
    if (Object.keys(wrapper.attributes).some((name) => name !== FIELD_STYLE_ATTR && name !== 'style')) return null
    const literal = wrapper.textContent.trim()
    const tagMatch = literal.match(/^\{\{([^{}]+)\}\}$/)
    if (!tagMatch) return null
    const declarations = new Map<string, string>()
    for (const part of (wrapper.getAttribute('style') ?? '').split(';')) {
      const colon = part.indexOf(':')
      if (colon < 0) continue
      const name = part.slice(0, colon).trim().toLowerCase()
      const value = part.slice(colon + 1).trim()
      if (name && value) declarations.set(name, value)
    }
    if ([...declarations.keys()].some((name) => name !== 'font-size' && name !== 'color')) return null
    const sizeRaw = declarations.get('font-size')
    const sizeMatch = sizeRaw?.match(/^([\d.]+)pt$/i)
    const fontSizePt = sizeMatch ? Number(sizeMatch[1]) : undefined
    if (sizeRaw && (!sizeMatch || !validFontSizePt(fontSizePt!))) return null
    const colorRaw = declarations.get('color')
    const colorHex = colorRaw ? colorToHex(colorRaw) ?? undefined : undefined
    if (colorRaw && !colorHex) return null
    if (fontSizePt === undefined && colorHex === undefined) return null
    details.set(wrapper, { tag: tagMatch[1].trim(), fontSizePt, colorHex })
  }

  const counts = new Map<string, number>()
  const styles: NativeFieldStyle[] = []
  const visit = (node: HTMLElement | TextNode) => {
    if (node instanceof TextNode) {
      for (const match of node.rawText.matchAll(/\{\{([^{}]+)\}\}/g)) {
        const tag = match[1].trim()
        const occurrence = counts.get(tag) ?? 0
        counts.set(tag, occurrence + 1)
        let parent = node.parentNode
        let owner: HTMLElement | null = null
        while (parent && parent !== content) {
          if (parent instanceof HTMLElement && details.has(parent)) {
            owner = parent
            break
          }
          parent = parent.parentNode
        }
        if (owner) {
          const detail = details.get(owner)!
          if (detail.tag !== tag || owner.textContent.trim() !== match[0]) return false
          styles.push({ tag, occurrence, ...(detail.fontSizePt === undefined ? {} : { fontSizePt: detail.fontSizePt }), ...(detail.colorHex ? { colorHex: detail.colorHex } : {}) })
        }
      }
      return true
    }
    for (const child of node.childNodes) {
      if ((child instanceof HTMLElement || child instanceof TextNode) && !visit(child)) return false
    }
    return true
  }
  if (!visit(content)) return null
  if (styles.length !== wrappers.length) return null

  for (const wrapper of wrappers) wrapper.replaceWith(...wrapper.childNodes)
  return { html: content.innerHTML, styles }
}

export type NativeFallbackReason =
  | 'no_source'
  /** Inline constructs absent from the original Drive document. */
  | 'inline_blocks'
  | 'edited'
  | 'css_changed'
  | 'formatted_rule'

export function decideNativeRoute(args: {
  sourceFile: SourceFileMeta | null
  editorHtml: string
  editorCss: string
  ruleBindings?: RuleBindings
}): { eligible: true; edits: NativeEdit[]; styles?: NativeFieldStyle[] } | { eligible: false; reason: NativeFallbackReason } {
  const { sourceFile, editorHtml, editorCss, ruleBindings } = args
  if (!sourceFile) return { eligible: false, reason: 'no_source' }
  const extracted = extractNativeFieldStyles(editorHtml)
  if (!extracted) return { eligible: false, reason: 'edited' }
  const comparableHtml = extracted.html
  // Inline constructs invalidate the native route independently of fingerprints.
  if (
    comparableHtml.includes('data-cond') ||
    comparableHtml.includes('data-ttg-repeat') ||
    comparableHtml.includes('ttg-chip')
  ) {
    return { eligible: false, reason: 'inline_blocks' }
  }
  if (bindingsHaveRichFormatting(ruleBindings)) {
    return { eligible: false, reason: 'formatted_rule' }
  }
  if (fingerprintCss(editorCss) !== sourceFile.cssFingerprint) {
    return { eligible: false, reason: 'css_changed' }
  }
  if (fingerprintHtml(comparableHtml) === sourceFile.fingerprint) {
    return { eligible: true, edits: [], ...(extracted.styles.length ? { styles: extracted.styles } : {}) }
  }

  // Old recipes without a snapshot stay on the safe fallback route.
  if (!sourceFile.textSegments) return { eligible: false, reason: 'edited' }
  const current = nativeTextSegments(normalizeBodyHtml(comparableHtml))
  if (current.length !== sourceFile.textSegments.length) {
    return { eligible: false, reason: 'edited' }
  }

  const sourceTexts = sourceFile.textSegments.map((segment) => segment.text)
  const edits: NativeEdit[] = []
  for (let i = 0; i < current.length; i++) {
    const before = sourceFile.textSegments[i]
    const after = current[i]
    // replaceAllText cannot reproduce structural or formatting changes.
    if (before.tag !== after.tag || before.structure !== after.structure) {
      return { eligible: false, reason: 'edited' }
    }
    if (before.text === after.text) continue
    const edit = uniqueTextEdit(before.text, after.text, sourceTexts)
    if (!edit) return { eligible: false, reason: 'edited' }
    edits.push(edit)
  }
  return { eligible: true, edits, ...(extracted.styles.length ? { styles: extracted.styles } : {}) }
}

export function buildNativeJobs(
  plan: GenerationPlan,
  literals: Record<string, string[]>,
  edits: NativeEdit[] = [],
  styles: NativeFieldStyle[] = [],
): NativeJob[] {
  const sub = { mapping: plan.mapping, onMissing: 'empty' as const, tagFormats: plan.tagFormats }
  return planGroups(plan).map((group) => {
    const row = group.rows[0] ?? {}
    const replacements: NativeReplacement[] = plan.template.tags.map((tag) => {
      const finds = [...new Set([...(literals[tag] ?? []), `{{${tag}}}`, `{{ ${tag} }}`])]
      const bound = resolveBoundTag(tag, group.rows, plan.ruleBindings, sub)
      if (bound !== null) return { tag, finds, replace: bound }
      const column = plan.mapping[tag]
      return {
        tag,
        finds,
        replace: column ? formatTagValue(tag, row[column] ?? '', plan.tagFormats) : '',
      }
    })
    return { name: group.key, edits, ...(styles.length ? { styles } : {}), replacements }
  })
}
