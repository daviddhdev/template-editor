import type { GenerationPlan, GroupConfig, RuleBindings, TagMapping, Template } from '../types'
import { condTexts } from './cond'
import { detectTags } from './template/parse'
import { buildGroups, type RowGroup } from './engine/grouping'
import { resolveGroupDocument } from './engine/resolve'

/**
 * The mapping actually used to substitute fields: explicit bindings first,
 * then identity — a field whose name IS a data column is bound to it without
 * any extra step (this is what makes dragging a column into the document a
 * single-gesture insert+bind). Identity also matches a column's suffix after
 * its last '$' (sheets in the wild prefix headers like "IAI$NOMBRE…" while the
 * doc says {{NOMBRE…}}), skipping ambiguous suffixes shared by several columns.
 */
export function effectiveMapping(
  tags: string[],
  columns: string[],
  explicit: TagMapping,
): TagMapping {
  const cols = new Set(columns)
  const bySuffix = new Map<string, string | null>()
  for (const col of columns) {
    if (!col.includes('$')) continue
    const suffix = col.slice(col.lastIndexOf('$') + 1).trim()
    if (!suffix) continue
    // null marks an ambiguous suffix (two columns claim it) — no auto-bind.
    bySuffix.set(suffix, bySuffix.has(suffix) ? null : col)
  }
  const out: TagMapping = {}
  for (const tag of tags) {
    // A stale explicit binding (its column vanished after switching sheet
    // tabs) must not LOOK bound: ignore it while the current data lacks the
    // column, but keep it in the store — switching back revives it. With no
    // data loaded there is nothing to validate against, so trust it.
    const chosen = explicit[tag]
    const valid = chosen && (columns.length === 0 || cols.has(chosen)) ? chosen : undefined
    out[tag] = valid ?? (cols.has(tag) ? tag : (bySuffix.get(tag) ?? null))
  }
  return out
}

/**
 * Columns the workspace references (explicit bindings, per-group column,
 * rule-branch conditions) that do NOT exist in the current data — the
 * tell-tale of a sheet-tab switch. Order = first reference; empty when no
 * data is loaded (nothing to validate against).
 */
export function missingBoundColumns(
  explicit: TagMapping,
  group: GroupConfig,
  ruleBindings: RuleBindings,
  columns: string[],
): string[] {
  if (columns.length === 0) return []
  const cols = new Set(columns)
  const seen = new Set<string>()
  const out: string[] = []
  const add = (c: string | null | undefined) => {
    if (c && !cols.has(c) && !seen.has(c)) {
      seen.add(c)
      out.push(c)
    }
  }
  for (const c of Object.values(explicit)) add(c)
  if (group.mode === 'per_group') add(group.groupByColumn)
  for (const { rule } of Object.values(ruleBindings)) for (const b of rule.branches) add(b.column)
  return out
}

/** Tags referenced INSIDE rule-binding texts (they bind to columns only). */
export function ruleInnerTags(ruleBindings: RuleBindings): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const { rule } of Object.values(ruleBindings))
    for (const tag of detectTags(condTexts(rule)))
      if (!seen.has(tag)) {
        seen.add(tag)
        out.push(tag)
      }
  return out
}

/** Every tag that needs a binding: the document's own plus rule-text ones. */
export function allPlanTags(template: Template | null, ruleBindings: RuleBindings): string[] {
  const docTags = template?.tags ?? []
  const inner = ruleInnerTags(ruleBindings).filter((t) => !docTags.includes(t))
  return [...docTags, ...inner]
}

/** Fields that still resolve to nothing (no column, no rule binding). */
export function unmappedTags(
  template: Template | null,
  columns: string[],
  explicit: TagMapping,
  ruleBindings: RuleBindings = {},
): string[] {
  if (!template) return []
  const tags = allPlanTags(template, ruleBindings)
  const eff = effectiveMapping(tags, columns, explicit)
  return tags.filter((t) => !eff[t] && !ruleBindings[t])
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
