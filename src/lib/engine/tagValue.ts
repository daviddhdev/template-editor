import type { ConditionBranch, ConditionalRule, RuleBindings, TagFormats, TagMapping } from '../../types'
import { tagRe } from '../tagRegex'
import { formatTagValue } from './format'

/**
 * PLAIN-TEXT tag resolution, shared by all three generation routes.
 *
 * A rule-bound tag (see {@link RuleBindings}) always keeps a plain-text form
 * whose {{tags}} resolve to COLUMN values only (no rule-in-rule nesting).
 * Everything here returns that form for the native route; the HTML route may
 * use the optional sanitised rich sidecar through substitute.ts.
 */

export interface PlainSubOptions {
  mapping: TagMapping
  /** 'placeholder' → visible `[tag]` marker (previews); 'empty' → nothing. */
  onMissing: 'placeholder' | 'empty'
  /** Per-tag display formats applied to column values (lib/engine/format). */
  tagFormats?: TagFormats
}

/** Replace every {{tag}} in PLAIN text with its column value for the row. */
export function substitutePlainTags(
  text: string,
  row: Record<string, string>,
  opts: PlainSubOptions,
): string {
  return text.replace(tagRe(), (_full, inner: string) => {
    const tag = inner.trim()
    if (!tag) return ''
    const column = opts.mapping[tag]
    if (!column || !(column in row)) {
      return opts.onMissing === 'placeholder' ? `[${tag}]` : ''
    }
    return formatTagValue(tag, row[column] ?? '', opts.tagFormats)
  })
}

/** Evaluate a single branch's condition against a row. */
export function branchMatches(branch: ConditionBranch, row: Record<string, string>): boolean {
  const cell = (row[branch.column] ?? '').trim()
  const target = branch.value.trim()
  // Comparisons are case-insensitive — friendlier for non-technical users.
  const a = cell.toLowerCase()
  const b = target.toLowerCase()
  switch (branch.operator) {
    case 'equals':
      return a === b
    case 'not_equals':
      return a !== b
    case 'contains':
      return a.includes(b)
    default:
      return false
  }
}

/**
 * Resolve a rule for one row into plain text: first matching branch's text
 * (else the default), with its {{tags}} substituted from the row.
 * '' when nothing matches and there is no default.
 */
export function resolveRuleText(
  rule: ConditionalRule,
  row: Record<string, string>,
  opts: PlainSubOptions,
): string {
  const chosen = chooseRuleContent(rule, row).text
  if (!chosen.trim()) return ''
  return substitutePlainTags(chosen, row, opts)
}

/** Selected plain/rich pair for a row; shared by HTML and native resolution. */
export function chooseRuleContent(
  rule: ConditionalRule,
  row: Record<string, string>,
): { text: string; html?: string } {
  const match = rule.branches.find((br) => branchMatches(br, row))
  return match
    ? { text: match.text, ...(match.textHtml ? { html: match.textHtml } : {}) }
    : {
        text: rule.defaultText ?? '',
        ...(rule.defaultTextHtml ? { html: rule.defaultTextHtml } : {}),
      }
}

/**
 * The substituted value of a RULE-BOUND tag, or null when the tag has no rule
 * binding (callers then fall back to the column mapping).
 * perRow rules render once per row and join with a blank line — a repeatable
 * section anchored at one {{tag}}.
 */
export function resolveBoundTag(
  tag: string,
  rows: Record<string, string>[],
  bindings: RuleBindings,
  opts: PlainSubOptions,
): string | null {
  const binding = bindings[tag]
  if (!binding) return null
  if (binding.perRow) {
    return rows
      .map((row) => resolveRuleText(binding.rule, row, opts))
      .filter((t) => t.trim())
      .join('\n\n')
  }
  return resolveRuleText(binding.rule, rows[0] ?? {}, opts)
}
