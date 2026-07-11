/**
 * The single source of the `{{ campo }}` tag syntax. Callers get a FRESH
 * RegExp per call: these are global (`g`) regexes, and a shared instance's
 * `lastIndex` would leak state between unrelated iterations.
 */

/** Tag in PLAIN text (whitespace tolerated, no `{` `}` inside). Group 1 = name. */
export function tagRe(): RegExp {
  return /\{\{\s*([^{}]+?)\s*\}\}/g
}

/**
 * Tag in an HTML string, tolerating inline markup between the braces (Google
 * Docs splits runs: `{{<span>nombre</span>}}`). The interior refuses another
 * `{{` so a stray hand-typed `{{` cannot swallow the next real tag together
 * with the markup in between. Group 1 = inner HTML.
 */
export function tagHtmlRe(): RegExp {
  return /\{\{((?:(?!\{\{)[\s\S])*?)\}\}/g
}
