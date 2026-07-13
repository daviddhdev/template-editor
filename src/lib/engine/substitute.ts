import type { RuleBindings, TagFormats, TagMapping } from '../../types'
import { escapeHtml, stripTags } from '../html'
import { renderRichText } from '../richText'
import { tagHtmlRe } from '../tagRegex'
import { formatTagValue } from './format'
import { chooseRuleContent, substitutePlainTags } from './tagValue'

/** How a preview renders a tag that has no column mapped yet. */
export function unmappedPlaceholder(tag: string): string {
  return `<mark class="ttg-missing" title="Falta asignar un dato">[${escapeHtml(tag)}]</mark>`
}

/** A substituted value as inline HTML: escaped, line breaks kept visible. */
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
        // Rule text may reference columns, but rules never nest into rules.
        return substituteTags(rich, { ...opts, row })
      }
      return valueToInlineHtml(substitutePlainTags(chosen.text, row, opts))
    })
    .filter((piece) => piece.replace(/<[^>]*>/g, '').trim())
    .join('<br><br>')
}

export interface SubstituteOptions {
  /** tag -> column name. */
  mapping: TagMapping
  /** The row supplying values. */
  row: Record<string, string>
  /**
   * How to render a tag whose column is not mapped (or missing in the row).
   * 'placeholder' → visible marker (previews); 'empty' → nothing (final output).
   */
  onMissing: 'placeholder' | 'empty'
  /** Tags bound to rules instead of columns (anchored conditionals/repeats). */
  ruleBindings?: RuleBindings
  /** All rows of the current group — what a perRow rule binding repeats over. */
  groupRows?: Record<string, string>[]
  /** Per-tag display formats applied to column values (lib/engine/format). */
  tagFormats?: TagFormats
}

/**
 * Replace every {{campo}} in an HTML fragment with the mapped column's value
 * for the given row. Values are HTML-escaped. The intervening markup inside the
 * braces is discarded, which also cleans up Google's split runs.
 */
export function substituteTags(html: string, opts: SubstituteOptions): string {
  const { mapping, row, onMissing } = opts
  return html.replace(tagHtmlRe(), (_full, inner: string) => {
    const tag = stripTags(inner).trim()
    if (!tag) return ''
    // Rule-bound tags (anchored conditionals/repeats) resolve to the rule's
    // text; multiline pieces keep their line breaks in the HTML output.
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
