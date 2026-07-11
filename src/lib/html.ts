/** Tiny HTML string utilities shared by the parser and the resolution engine. */

/** Escape a plain string so it is safe to inject as HTML text content. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/** Remove every HTML tag from a fragment, returning its visible text. */
export function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '')
}
