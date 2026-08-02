import type { Recipe, TagMapping, TagFormats, Template, RuleBindings, DataSourceData, GenerationPlan } from '../types'
import { allPlanTags, effectiveMapping, formatParseIssues } from './plan'
import { detectTags } from './template/parse'
import { condTexts } from './cond'

export interface ManualField {
  key: string
  label: string
  inputType: 'text' | 'date' | 'number'
  formats: string[]
}

/** The unique data keys needed to resolve a saved template manually. */
export function manualFields(
  template: Template,
  mapping: TagMapping,
  rules: RuleBindings,
  formats: TagFormats = {},
): ManualField[] {
  const keys: string[] = []
  const uses = new Map<string, string[]>()
  const add = (key: string, tag?: string) => {
    const k = key.trim()
    if (!k) return
    if (!keys.includes(k)) keys.push(k)
    if (tag && formats[tag]) uses.set(k, [...(uses.get(k) ?? []), formats[tag]])
  }

  for (const tag of allPlanTags(template, rules)) {
    // A tag anchored to a rule is resolved by the rule itself; its inner tags
    // are visited below and become inputs through their column bindings.
    if (rules[tag]) continue
    add(mapping[tag] ?? tag, tag)
  }
  for (const { rule } of Object.values(rules)) {
    for (const tag of detectTags(condTexts(rule))) add(mapping[tag] ?? tag, tag)
    for (const branch of rule.branches) add(branch.column)
  }

  return keys.map((key) => {
    const fs = [...new Set(uses.get(key) ?? [])]
    const date = fs.length > 0 && fs.every((f) => f === 'fecha_larga' || f === 'fecha_corta')
    const number = fs.length > 0 && fs.every((f) => f === 'moneda' || f === 'importe_letra' || f === 'importe_letra_mayus')
    return { key, label: key, inputType: date ? 'date' : number ? 'number' : 'text', formats: fs }
  })
}

export function manualData(fields: ManualField[], values: Record<string, string>): DataSourceData {
  const columns = fields.map((f) => f.key)
  const row: Record<string, string> = {}
  for (const key of columns) row[key] = values[key] ?? ''
  return { kind: 'manual_form', origin: 'manual', columns, rows: [row] }
}

export function manualPlan(
  recipe: Recipe,
  template: Template,
  values: Record<string, string>,
): { plan: GenerationPlan; fields: ManualField[]; missing: string[]; formatIssues: ReturnType<typeof formatParseIssues> } {
  const fields = manualFields(template, recipe.mapping, recipe.ruleBindings ?? {}, recipe.tagFormats ?? {})
  const data = manualData(fields, values)
  const tags = allPlanTags(template, recipe.ruleBindings ?? {})
  const mapping = effectiveMapping(tags, data.columns, recipe.mapping)
  const missing = tags.filter((tag) => !mapping[tag] && !(recipe.ruleBindings ?? {})[tag])
  const formatIssues = formatParseIssues(recipe.tagFormats ?? {}, recipe.mapping, data.columns, data.rows)
  return {
    fields,
    missing,
    formatIssues,
    plan: {
      template,
      data,
      mapping,
      ruleBindings: recipe.ruleBindings ?? {},
      tagFormats: recipe.tagFormats ?? {},
      group: { mode: 'per_row', groupByColumn: null },
    },
  }
}
