import type { TagMapping } from '../../types'

/**
 * EXTENSION POINT — automatic field mapping.
 *
 * Today this is a dummy heuristic: it matches a template field to a data column
 * by comparing their normalised names (accents/spacing/case ignored). It exists
 * so the UI can offer a "Sugerir automáticamente" button now.
 *
 * Later, replace the body with a real AI call (e.g. send the tag names + column
 * names + a few sample rows to a Claude model and ask for the best mapping).
 * Keep this exact signature so the UI keeps working unchanged:
 *
 *   export async function suggestMapping(tags, columns, sampleRows?): Promise<TagMapping>
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
