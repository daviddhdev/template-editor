import type { TagMapping } from '../../types'

/**
 * Pure helpers for the AI mapping suggestion (server/aiMapping.ts). Kept out
 * of the server function so prompt building and response validation are
 * unit-testable without HTTP. The heuristic fallback lives in
 * suggestMapping.ts and does not depend on any of this.
 */

/** Privacy decision: at most this many rows ever leave the app… */
export const MAX_SAMPLE_ROWS = 5
/** …and every cell value is truncated to this many characters. */
export const MAX_SAMPLE_CHARS = 60

export function truncateSample(value: string): string {
  return value.length > MAX_SAMPLE_CHARS ? value.slice(0, MAX_SAMPLE_CHARS) + '…' : value
}

/**
 * First rows reduced to the known columns with truncated values — the ONLY
 * cell data that is sent to the AI provider. Empty cells are dropped (no
 * signal, fewer tokens).
 */
export function sampleRowsForMapping(
  rows: readonly Record<string, string>[] | undefined,
  columns: readonly string[],
): Record<string, string>[] {
  if (!rows || rows.length === 0) return []
  return rows.slice(0, MAX_SAMPLE_ROWS).map((row) => {
    const out: Record<string, string> = {}
    for (const col of columns) {
      const v = row[col]
      if (typeof v === 'string' && v !== '') out[col] = truncateSample(v)
    }
    return out
  })
}

/**
 * Chat messages for the mapping request. The user content is JSON so the
 * model never confuses field names with instructions.
 */
export function buildMappingMessages(
  tags: readonly string[],
  columns: readonly string[],
  sampleRows: readonly Record<string, string>[],
): { system: string; user: string } {
  const system = [
    'You match template fields to spreadsheet columns for a document generator.',
    'Both names are usually in Spanish; match by meaning, not just spelling',
    '(accents, abbreviations and synonyms count as matches).',
    'Sample rows show real cell values (truncated) to help you disambiguate.',
    'Map a field to a column ONLY when you are confident it is the right one;',
    'when in doubt, use null. A wrong guess ends up in a generated document,',
    'which is worse than leaving the field unmapped.',
    'Reply with a JSON object: one key per field, value = column name or null.',
  ].join(' ')
  const user = JSON.stringify(
    { fields: [...new Set(tags)], columns: [...columns], sample_rows: [...sampleRows] },
    null,
    1,
  )
  return { system, user }
}

/**
 * Strict JSON schema for the response: one required key per (unique) tag,
 * each either one of the known columns or null.
 */
export function mappingSchema(
  tags: readonly string[],
  columns: readonly string[],
): Record<string, unknown> {
  const uniq = [...new Set(tags)]
  const properties: Record<string, unknown> = {}
  for (const tag of uniq) {
    properties[tag] = { anyOf: [{ type: 'string', enum: [...columns] }, { type: 'null' }] }
  }
  return { type: 'object', properties, required: uniq, additionalProperties: false }
}

/**
 * Parse and sanitize the model's reply. Never trusts the schema enforcement:
 * unknown columns become null, keys outside `tags` are dropped, missing tags
 * come back as null. Throws (Spanish, user-visible) on non-JSON content.
 */
export function parseMappingContent(
  content: string,
  tags: readonly string[],
  columns: readonly string[],
): TagMapping {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('La IA devolvió una respuesta que no es JSON.')
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('La IA devolvió un JSON con forma inesperada.')
  }
  const record = parsed as Record<string, unknown>
  const known = new Set(columns)
  const mapping: TagMapping = {}
  for (const tag of new Set(tags)) {
    const v = record[tag]
    mapping[tag] = typeof v === 'string' && known.has(v) ? v : null
  }
  return mapping
}
