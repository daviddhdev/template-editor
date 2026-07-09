import type { TagMapping } from '../../types'
import { escapeHtml, stripTags } from '../html'

/**
 * Match a full {{ ... }} occurrence in an HTML string, tolerating inline markup
 * between the braces. Google Docs frequently splits a run so the raw HTML looks
 * like `{{<span>nombre</span>}}`; this still captures it as one tag.
 */
const TAG_HTML_RE = /\{\{([\s\S]*?)\}\}/g

/** How a preview renders a tag that has no column mapped yet. */
export function unmappedPlaceholder(tag: string): string {
  return `<mark class="ttg-missing" title="Falta asignar un dato">[${escapeHtml(tag)}]</mark>`
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
}

/**
 * Replace every {{campo}} in an HTML fragment with the mapped column's value
 * for the given row. Values are HTML-escaped. The intervening markup inside the
 * braces is discarded, which also cleans up Google's split runs.
 */
export function substituteTags(html: string, opts: SubstituteOptions): string {
  const { mapping, row, onMissing } = opts
  return html.replace(TAG_HTML_RE, (_full, inner: string) => {
    const tag = stripTags(inner).trim()
    if (!tag) return ''
    const column = mapping[tag]
    if (!column || !(column in row)) {
      return onMissing === 'placeholder' ? unmappedPlaceholder(tag) : ''
    }
    return escapeHtml(row[column] ?? '')
  })
}
