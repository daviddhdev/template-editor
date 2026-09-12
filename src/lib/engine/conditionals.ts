import type { ConditionalRule } from '../../types'
import { escapeHtml } from '../html'
import { conditionalTextStyleCss, renderRichText } from '../richText'
import { substituteTags, type SubstituteOptions } from './substitute'
import { branchMatches, chooseRuleContent } from './tagValue'

export { branchMatches }

/** Resolve a rule, preserving rich text and document paragraph styling. */
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
