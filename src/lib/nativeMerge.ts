/**
 * Client-side half of the NATIVE generation route: instead of rebuilding the
 * document from edited HTML (lossy — Google's HTML importer flattens page
 * headers, drops drawings and degrades font weights), the original Drive file
 * is re-materialised as a Google Doc and the `{{tags}}` are substituted with
 * the Docs API's replaceAllText, which reaches headers and footers too.
 *
 * `decideNativeRoute` compares the imported snapshot with the editor state.
 * Unique text edits inside an unchanged paragraph/cell become native text
 * patches; structural, formatting and margin changes fall back to HTML. The
 * conservative rule is: never silently omit an edit to gain fidelity.
 */

import { HTMLElement, parse, TextNode } from 'node-html-parser'
import type { GenerationPlan } from '../types'
import type { NativeJob, NativeReplacement } from '../server/googleNative'
import { formatTagValue } from './engine/format'
import { resolveBoundTag } from './engine/tagValue'
import { fingerprintCss, fingerprintHtml, hashString, normalizeBodyHtml } from './fingerprint'
import { planGroups } from './plan'

/** What `loadRawDocument` captures about the imported Drive file. */
export interface SourceFileMeta {
  /** Drive file id of the ORIGINAL template document. */
  id: string
  /** fingerprintHtml() of the body exactly as imported. */
  fingerprint: string
  /** fingerprintCss() of the CSS exactly as imported. */
  cssFingerprint: string
  /**
   * Exact `{{ ... }}` literals present in the imported document's text, keyed
   * by trimmed tag name. Captured BEFORE the editor canonicalises whitespace
   * (`{{ TAG }}` → `{{TAG}}`): replaceAllText matches literal document text,
   * so the find-strings must carry the original spacing (NBSP included).
   */
  tagLiterals: Record<string, string[]>
  /**
   * Text-bearing leaves of the imported HTML (paragraphs, headings, list
   * items and table cells). They let us distinguish a safe text edit from a
   * structural/formatting edit without storing a second copy of the HTML.
   * Absent on recipes saved before native editable output was introduced.
   */
  textSegments?: NativeTextSegment[]
}

export interface NativeTextSegment {
  /** Element name, kept separately for readable diagnostics/tests. */
  tag: string
  /** Hash of the element/attribute tree with text nodes replaced by #. */
  structure: string
  /** Exact decoded text exported by Google for this leaf. */
  text: string
}

/** A safe edit applied to the temporary native Google Doc before mail merge. */
export interface NativeEdit {
  find: string
  replace: string
}

/** Add the editable snapshot to an older source record when it is still safe. */
export function upgradeSourceFileMeta(
  sourceFile: SourceFileMeta | null | undefined,
  editorHtml: string,
): SourceFileMeta | null {
  if (!sourceFile) return null
  if (sourceFile.textSegments) return sourceFile
  // Never bless the current HTML as "original" after an edit: old recipes
  // without a snapshot must still fall back unless their fingerprint matches.
  if (fingerprintHtml(editorHtml) !== sourceFile.fingerprint) return sourceFile
  return {
    ...sourceFile,
    textSegments: nativeTextSegments(normalizeBodyHtml(editorHtml)),
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

/**
 * Ordered editable text leaves. A table cell containing paragraphs contributes
 * those paragraphs, not the cell as well; a plain cell contributes itself.
 */
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
      // Hash instead of persisting the raw signature: image src attributes can
      // contain hundreds of KB of base64 and must not be duplicated in drafts.
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

/** Minimal changed slice, expanded only until its source text is unique. */
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
  // Pure insertion has an empty search. Anchor it to an adjacent original
  // character; the inserted text then inherits that character's style.
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
    // Add nearby context until unique, alternating left/right where possible.
    if (left === 0 && right === before.length) return null
    if ((expandLeft && left > 0) || right === before.length) left--
    else right++
    expandLeft = !expandLeft
  }
}

/** Exact tag literals in the HTML's text, keyed by trimmed tag name. */
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

export type NativeFallbackReason =
  /** Blank document or template without an imported Drive file behind it. */
  | 'no_source'
  /** Inline blocks inserted in the flow (conditional / repeatable section /
   * field chips) — content the original Drive doc does not have. The anchored
   * alternative (bind a {{tag}} to a rule) keeps the native route. */
  | 'inline_blocks'
  /** Edit cannot be represented as an unambiguous native text patch. */
  | 'edited'
  /** CSS changed (ruler margins) — the native output would not reflect it. */
  | 'css_changed'

export function decideNativeRoute(args: {
  sourceFile: SourceFileMeta | null
  editorHtml: string
  editorCss: string
}): { eligible: true; edits: NativeEdit[] } | { eligible: false; reason: NativeFallbackReason } {
  const { sourceFile, editorHtml, editorCss } = args
  if (!sourceFile) return { eligible: false, reason: 'no_source' }
  // In-app inline constructs make the route wrong regardless of what the
  // fingerprint says (independent of serialisation quirks) — and they get
  // their own reason so the UI can point at the anchored alternative.
  if (
    editorHtml.includes('data-cond') ||
    editorHtml.includes('data-ttg-repeat') ||
    editorHtml.includes('ttg-chip')
  ) {
    return { eligible: false, reason: 'inline_blocks' }
  }
  if (fingerprintCss(editorCss) !== sourceFile.cssFingerprint) {
    return { eligible: false, reason: 'css_changed' }
  }
  if (fingerprintHtml(editorHtml) === sourceFile.fingerprint) return { eligible: true, edits: [] }

  // Old saved recipes have no source snapshot. Staying conservative avoids
  // silently exporting the original while ignoring an edit.
  if (!sourceFile.textSegments) return { eligible: false, reason: 'edited' }
  const current = nativeTextSegments(normalizeBodyHtml(editorHtml))
  if (current.length !== sourceFile.textSegments.length) {
    return { eligible: false, reason: 'edited' }
  }

  const sourceTexts = sourceFile.textSegments.map((segment) => segment.text)
  const edits: NativeEdit[] = []
  for (let i = 0; i < current.length; i++) {
    const before = sourceFile.textSegments[i]
    const after = current[i]
    // A changed element/attribute tree means formatting or structure changed;
    // replaceAllText cannot reproduce it faithfully.
    if (before.tag !== after.tag || before.structure !== after.structure) {
      return { eligible: false, reason: 'edited' }
    }
    if (before.text === after.text) continue
    const edit = uniqueTextEdit(before.text, after.text, sourceTexts)
    if (!edit) return { eligible: false, reason: 'edited' }
    edits.push(edit)
  }
  return { eligible: true, edits }
}

/**
 * One NativeJob per output document (same grouping and naming as the HTML
 * route): every template tag becomes one replacement carrying all its known
 * literal spellings plus the canonical variants as safety nets — an extra
 * variant that matches nothing costs nothing.
 *
 * A rule-bound tag substitutes to its rule's resolved text (perRow rules join
 * one piece per group row); Docs turns the '\n' into paragraph breaks.
 */
export function buildNativeJobs(
  plan: GenerationPlan,
  literals: Record<string, string[]>,
  edits: NativeEdit[] = [],
): NativeJob[] {
  const sub = { mapping: plan.mapping, onMissing: 'empty' as const, tagFormats: plan.tagFormats }
  return planGroups(plan).map((group) => {
    // Non-repeatable content uses the group's first row (resolveGroupBody
    // semantics); anchored perRow rules consume the whole group.
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
    return { name: group.key, edits, replacements }
  })
}
