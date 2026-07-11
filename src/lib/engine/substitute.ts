import type { RuleBindings, TagMapping } from '../../types'
import { escapeHtml, stripTags } from '../html'
import { tagHtmlRe } from '../tagRegex'
import { resolveBoundTag } from './tagValue'

/** How a preview renders a tag that has no column mapped yet. */
export function unmappedPlaceholder(tag: string): string {
  return `<mark class="ttg-missing" title="Falta asignar un dato">[${escapeHtml(tag)}]</mark>`
}

/** A substituted value as inline HTML: escaped, line breaks kept visible. */
function valueToInlineHtml(value: string): string {
  return escapeHtml(value).replace(/\n/g, '<br>')
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
      const bound = resolveBoundTag(tag, opts.groupRows ?? [row], opts.ruleBindings, {
        mapping,
        onMissing,
      })
      if (bound !== null) return valueToInlineHtml(bound)
    }
    const column = mapping[tag]
    if (!column || !(column in row)) {
      return onMissing === 'placeholder' ? unmappedPlaceholder(tag) : ''
    }
    return valueToInlineHtml(row[column] ?? '')
  })
}
