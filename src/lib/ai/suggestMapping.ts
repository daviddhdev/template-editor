import type { TagMapping } from '../../types'

/**
 * Heuristic field mapping — the FALLBACK for «Sugerir automáticamente».
 *
 * Matches a template field to a data column by comparing their normalised
 * names (accents/spacing/case ignored). The primary path is the AI call in
 * server/aiMapping.ts (suggestMappingFn); the UI falls back to this when the
 * AI is unconfigured or fails, so it must stay pure, synchronous and free.
 */
function normalise(s: string): string {
  // eslint-disable-next-line no-misleading-character-class
  const COMBINING_MARKS = /[̀-ͯ]/g
  return s
    .normalize('NFD')
    .replace(COMBINING_MARKS, '') // strip accents
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
}

export function suggestMapping(
  tags: string[],
  columns: string[],
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  _sampleRows?: Record<string, string>[],
): TagMapping {
  const normCols = columns.map((c) => ({ col: c, norm: normalise(c) }))
  const mapping: TagMapping = {}

  for (const tag of tags) {
    const nt = normalise(tag)
    // 1) exact normalised match, 2) one contains the other.
    const exact = normCols.find((c) => c.norm === nt)
    const partial =
      exact ??
      normCols.find((c) => c.norm.includes(nt) || nt.includes(c.norm))
    mapping[tag] = partial ? partial.col : null
  }
  return mapping
}
