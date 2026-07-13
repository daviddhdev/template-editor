import type { ConditionalRule } from '../../types'
import { escapeHtml } from '../html'
import { conditionalTextStyleCss, renderRichText } from '../richText'
import { substituteTags, type SubstituteOptions } from './substitute'
import { branchMatches, chooseRuleContent } from './tagValue'

export { branchMatches }

/**
 * Resolve a conditional rule for a row into final HTML.
 * Picks the first matching branch (else the default text), renders its
 * sanitised rich sidecar when present (plain text otherwise), then substitutes
 * any {{tags}} inside it.
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
  const chosen = chooseRuleContent(rule, row)
  if (!chosen.text.trim()) return ''
  if (chosen.html) {
    return substituteTags(renderRichText(chosen.html, 'block', rule.textStyle), { ...sub, row })
  }
  const baseCss = conditionalTextStyleCss(rule.textStyle)
  const styleAttr = baseCss ? ` style="${escapeHtml(baseCss)}"` : ''
  const html = chosen.text
    .split(/\r?\n/)
    .map((line) =>
      line.trim() ? `<p${styleAttr}>${escapeHtml(line)}</p>` : `<p${styleAttr}><br></p>`,
    )
    .join('')
  return substituteTags(html, { ...sub, row })
}
