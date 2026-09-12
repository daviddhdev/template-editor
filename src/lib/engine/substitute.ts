import type { RuleBindings, TagFormats, TagMapping } from '../../types'
import { escapeHtml, stripTags } from '../html'
import { renderRichText } from '../richText'
import { tagHtmlRe } from '../tagRegex'
import { formatTagValue } from './format'
import { chooseRuleContent, substitutePlainTags } from './tagValue'

export function unmappedPlaceholder(tag: string): string {
  return `<mark class="ttg-missing" title="Falta asignar un dato">[${escapeHtml(tag)}]</mark>`
}

function valueToInlineHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>')
}

function resolveBoundTagHtml(
  tag: string,
  rows: Record<string, string>[],
  bindings: RuleBindings,
  opts: Pick<SubstituteOptions, 'mapping' | 'onMissing' | 'tagFormats'>,
): string | null {
  const binding = bindings[tag]
  if (!binding) return null
  const selectedRows = binding.perRow ? rows : [rows[0] ?? {}]
  return selectedRows
    .map((row) => {
      const chosen = chooseRuleContent(binding.rule, row)
      if (!chosen.text.trim()) return ''
      if (chosen.html) {
        const rich = renderRichText(chosen.html, 'inline', binding.rule.textStyle)
        return substituteTags(rich, { ...opts, row })
      }
      return valueToInlineHtml(substitutePlainTags(chosen.text, row, opts))
    })
    .filter((piece) => piece.replace(/<[^>]*>/g, '').trim())
    .join('<br><br>')
}

export interface SubstituteOptions {
  mapping: TagMapping
  row: Record<string, string>
  onMissing: 'placeholder' | 'empty'
  ruleBindings?: RuleBindings
  groupRows?: Record<string, string>[]
  tagFormats?: TagFormats
}

export function substituteTags(html: string, opts: SubstituteOptions): string {
  const { mapping, row, onMissing } = opts
  return html.replace(tagHtmlRe(), (_full, inner: string) => {
    const tag = stripTags(inner).trim()
    if (!tag) return ''
    if (opts.ruleBindings) {
      const bound = resolveBoundTagHtml(tag, opts.groupRows ?? [row], opts.ruleBindings, {
        mapping,
        onMissing,
        tagFormats: opts.tagFormats,
      })
      if (bound !== null) return bound
    }
    const column = mapping[tag]
    if (!column || !(column in row)) {
      return onMissing === 'placeholder' ? unmappedPlaceholder(tag) : ''
    }
    return valueToInlineHtml(formatTagValue(tag, row[column] ?? '', opts.tagFormats))
  })
}
