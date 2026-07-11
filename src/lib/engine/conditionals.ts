import type { ConditionalRule } from '../../types'
import { escapeHtml } from '../html'
import { substituteTags, type SubstituteOptions } from './substitute'
import { branchMatches } from './tagValue'

export { branchMatches }

/**
 * Resolve a conditional rule for a row into final HTML.
 * Picks the first matching branch (else the default text), turns the chosen
 * plain text into HTML, then substitutes any {{tags}} inside it.
 * Returns '' when nothing matches and there is no default.
 *
 * Each text line becomes a bare `<p>` (blank lines a `<p><br></p>`): with no
 * class of its own the paragraph picks up the document's base `p{}` rule, so
 * the conditional's text renders in the document's font instead of the
 * browser default a classless `<div>` used to get.
 */
export function resolveConditional(
  rule: ConditionalRule,
  row: Record<string, string>,
  sub: Omit<SubstituteOptions, 'row'>,
): string {
  const match = rule.branches.find((br) => branchMatches(br, row))
  const chosen = match ? match.text : (rule.defaultText ?? '')
  if (!chosen.trim()) return ''
  const html = chosen
    .split(/\r?\n/)
    .map((line) => (line.trim() ? `<p>${escapeHtml(line)}</p>` : '<p><br></p>'))
    .join('')
  return substituteTags(html, { ...sub, row })
}
