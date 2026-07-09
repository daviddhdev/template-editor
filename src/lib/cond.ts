import type { ConditionBranch, ConditionalRule } from '../types'
import { escapeHtml } from './html'

/**
 * An inline conditional lives INSIDE the document HTML as
 * `<div class="ttg-cond" data-cond="..." contenteditable="false">resumen</div>`.
 * The rule JSON is URI-encoded in the attribute so quotes/entities can never
 * break the markup (in the browser DOM or in node-html-parser).
 */

export function encodeCond(rule: ConditionalRule): string {
  return encodeURIComponent(JSON.stringify(rule))
}

export function decodeCond(attr: string): ConditionalRule | null {
  try {
    const rule = JSON.parse(decodeURIComponent(attr)) as ConditionalRule
    return rule && Array.isArray(rule.branches) ? rule : null
  } catch {
    return null
  }
}

const OPERATOR_LABEL: Record<ConditionBranch['operator'], string> = {
  equals: 'es',
  not_equals: 'no es',
  contains: 'contiene',
}

function clip(text: string, max = 60): string {
  const t = text.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/** Human-readable summary lines shown inside the editor block. */
export function condSummaryHtml(rule: ConditionalRule): string {
  const lines = rule.branches.map(
    (br, i) =>
      `<span class="ttg-cond-line">${i === 0 ? 'Si' : 'O si'} <strong>${escapeHtml(br.column || '¿dato?')}</strong> ${OPERATOR_LABEL[br.operator]} «${escapeHtml(br.value)}» → ${escapeHtml(clip(br.text) || '(sin texto)')}</span>`,
  )
  if (rule.defaultText?.trim()) {
    lines.push(`<span class="ttg-cond-line">Si no → ${escapeHtml(clip(rule.defaultText))}</span>`)
  }
  return lines.join('')
}

/** Branch texts + default text, concatenated — used to detect {{campos}}. */
export function condTexts(rule: ConditionalRule): string {
  return [...rule.branches.map((b) => b.text), rule.defaultText ?? ''].join('\n')
}
