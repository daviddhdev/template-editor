import type { TagMapping } from '../../types'

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
    const exact = normCols.find((c) => c.norm === nt)
    const partial =
      exact ??
      normCols.find((c) => c.norm.includes(nt) || nt.includes(c.norm))
    mapping[tag] = partial ? partial.col : null
  }
  return mapping
}
