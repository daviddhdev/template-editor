import type { ConditionBranch, ConditionalRule } from '../../types'
import { plainTextToHtml } from '../html'
import { substituteTags, type SubstituteOptions } from './substitute'

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
 * Resolve a conditional rule for a row into final HTML.
 * Picks the first matching branch (else the default text), turns the chosen
 * plain text into HTML, then substitutes any {{tags}} inside it.
 * Returns '' when nothing matches and there is no default.
 */
export function resolveConditional(
  rule: ConditionalRule,
  row: Record<string, string>,
  sub: Omit<SubstituteOptions, 'row'>,
): string {
  const match = rule.branches.find((br) => branchMatches(br, row))
  const chosen = match ? match.text : (rule.defaultText ?? '')
  if (!chosen.trim()) return ''
  const html = `<div class="ttg-conditional">${plainTextToHtml(chosen)}</div>`
  return substituteTags(html, { ...sub, row })
}
