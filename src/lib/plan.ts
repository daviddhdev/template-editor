import type { GenerationPlan, TagMapping, Template } from '../types'
import { buildGroups, type RowGroup } from './engine/grouping'
import { resolveGroupDocument } from './engine/resolve'

/**
 * The mapping actually used to substitute fields: explicit bindings first,
 * then identity — a field whose name IS a data column is bound to it without
 * any extra step (this is what makes dragging a column into the document a
 * single-gesture insert+bind).
 */
export function effectiveMapping(
  tags: string[],
  columns: string[],
  explicit: TagMapping,
): TagMapping {
  const cols = new Set(columns)
  const out: TagMapping = {}
  for (const tag of tags) {
    out[tag] = explicit[tag] ?? (cols.has(tag) ? tag : null)
  }
  return out
}

/** Fields present in the template that still resolve to no column. */
export function unmappedTags(
  template: Template | null,
  columns: string[],
  explicit: TagMapping,
): string[] {
  if (!template) return []
  const eff = effectiveMapping(template.tags, columns, explicit)
  return template.tags.filter((t) => !eff[t])
}

/** All groups (each becomes one output document) for the current plan. */
export function planGroups(plan: GenerationPlan): RowGroup[] {
  return buildGroups(plan.data, plan.group)
}

/**
 * Resolve every group to a standalone HTML document.
 * `onMissing` controls unmapped fields: 'placeholder' for previews (visible
 * marker), 'empty' for the final output.
 */
export function renderDocuments(
  plan: GenerationPlan,
  onMissing: 'placeholder' | 'empty',
): { key: string; rowCount: number; html: string }[] {
  return planGroups(plan).map((group) => ({
    key: group.key,
    rowCount: group.rows.length,
    html: resolveGroupDocument(plan, group, onMissing),
  }))
}
