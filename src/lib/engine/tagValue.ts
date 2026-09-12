import type { ConditionBranch, ConditionalRule, RuleBindings, TagFormats, TagMapping } from '../../types'
import { tagRe } from '../tagRegex'
import { formatTagValue } from './format'


export interface PlainSubOptions {
  mapping: TagMapping
  onMissing: 'placeholder' | 'empty'
  tagFormats?: TagFormats
}

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

export function resolveRuleText(
  rule: ConditionalRule,
  row: Record<string, string>,
  opts: PlainSubOptions,
): string {
  const chosen = chooseRuleContent(rule, row).text
  if (!chosen.trim()) return ''
  return substitutePlainTags(chosen, row, opts)
}

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
