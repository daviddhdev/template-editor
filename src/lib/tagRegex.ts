
// Fresh global regexes avoid leaking lastIndex between callers.
export function tagRe(): RegExp {
  return /\{\{\s*([^{}]+?)\s*\}\}/g
}

export function tagHtmlRe(): RegExp {
  // A nested {{ must not consume the next real tag across split runs.
  return /\{\{((?:(?!\{\{)[\s\S])*?)\}\}/g
}
