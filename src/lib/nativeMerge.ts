/**
 * Client-side half of the NATIVE generation route: instead of rebuilding the
 * document from edited HTML (lossy — Google's HTML importer flattens page
 * headers, drops drawings and degrades font weights), the original Drive file
 * is re-materialised as a Google Doc and the `{{tags}}` are substituted with
 * the Docs API's replaceAllText, which reaches headers and footers too.
 *
 * That route is only correct while the document has NOT been edited in the
 * app: `decideNativeRoute` compares fingerprints taken at import time against
 * the current editor state and falls back (with a reason for the UI) on any
 * divergence — never a wrong document, at worst the old HTML route.
 */

import { parse } from 'node-html-parser'
import type { GenerationPlan } from '../types'
import type { NativeJob, NativeReplacement } from '../server/googleNative'
import { resolveBoundTag } from './engine/tagValue'
import { fingerprintCss, fingerprintHtml } from './fingerprint'
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
  /** Document text edited in the app. */
  | 'edited'
  /** CSS changed (ruler margins) — the native output would not reflect it. */
  | 'css_changed'

export function decideNativeRoute(args: {
  sourceFile: SourceFileMeta | null
  editorHtml: string
  editorCss: string
}): { eligible: true } | { eligible: false; reason: NativeFallbackReason } {
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
  if (fingerprintHtml(editorHtml) !== sourceFile.fingerprint) {
    return { eligible: false, reason: 'edited' }
  }
  return { eligible: true }
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
): NativeJob[] {
  const sub = { mapping: plan.mapping, onMissing: 'empty' as const }
  return planGroups(plan).map((group) => {
    // Non-repeatable content uses the group's first row (resolveGroupBody
    // semantics); anchored perRow rules consume the whole group.
    const row = group.rows[0] ?? {}
    const replacements: NativeReplacement[] = plan.template.tags.map((tag) => {
      const finds = [...new Set([...(literals[tag] ?? []), `{{${tag}}}`, `{{ ${tag} }}`])]
      const bound = resolveBoundTag(tag, group.rows, plan.ruleBindings, sub)
      if (bound !== null) return { tag, finds, replace: bound }
      const column = plan.mapping[tag]
      return { tag, finds, replace: column ? (row[column] ?? '') : '' }
    })
    return { name: group.key, replacements }
  })
}
