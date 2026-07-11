/**
 * Domain model for the visual document generator.
 *
 * Language note: the UI must speak in NON-technical terms (the components
 * carry the friendly Spanish wording). Internally we still use precise names
 * (tag, block, mapping).
 */

/** A single structural block extracted from the template document. */
export type BlockType = 'paragraph' | 'heading' | 'table' | 'list' | 'other'

export interface TemplateBlock {
  /** Stable id (index-based), informational only. */
  id: string
  type: BlockType
  /** Outer HTML of the block, preserving the document's original formatting. */
  html: string
  /** Plain-text version, used for previews and tag detection. */
  text: string
  /** Names of the `{{tags}}` found inside this block. */
  tags: string[]
  /**
   * True when the user marked this block "repeat once per row of the group"
   * (data-ttg-repeat attribute set in the editor). A multi-block repeatable
   * section is a `<div data-ttg-repeat>` wrapper — one block whose html holds
   * the wrapped blocks.
   */
  repeat: boolean
  /**
   * Present when this block IS an inline conditional (`.ttg-cond` element with
   * the rule JSON in its data-cond attribute). The block renders as the rule's
   * resolved text instead of its html.
   */
  cond: ConditionalRule | null
}

/** A parsed template (Google Doc today; any HTML source in the future). */
export interface Template {
  /** Original link the user pasted (for display / re-fetch). */
  sourceUrl: string
  /** Human title if we could detect one. */
  title: string
  /** `<style>` CSS extracted from the exported document, kept for fidelity. */
  css: string
  /**
   * Class attribute of the document's content root (Google puts the page
   * geometry — width, margins — on a class). Re-applied to the rendered <body>
   * so the output matches the original exactly.
   */
  bodyClass: string
  blocks: TemplateBlock[]
  /** Unique tag names across the whole document, in first-seen order. */
  tags: string[]
}

/** Where the row data comes from. */
export type DataSourceKind = 'google_sheet' | 'api_endpoint'

/** The tabular data every source resolves to. */
export interface DataSourceData {
  kind: DataSourceKind
  /** Link or endpoint the data came from. */
  origin: string
  /** Column headers in order. */
  columns: string[]
  /** One record per row: column -> cell value (always string). */
  rows: Record<string, string>[]
}

/** tag name -> source column name (or null when still unmapped). */
export type TagMapping = Record<string, string | null>

/**
 * A document tag bound to a RULE instead of a column (the "anchored" model,
 * mirroring the team's previous Apps Script flow): the tag's substituted value
 * is the rule's resolved text. `perRow: false` evaluates once per document
 * (the group's first row); `perRow: true` evaluates once per row of the group
 * and joins the pieces with blank lines — a repeatable section anchored at a
 * single {{tag}} in the source doc, which keeps the NATIVE generation route
 * viable (replaceAllText can substitute it like any other tag).
 * Texts inside the rule may reference {{tags}} that resolve to COLUMNS only
 * (no rule-in-rule nesting).
 */
export interface RuleBinding {
  rule: ConditionalRule
  perRow: boolean
}

/** tag name -> rule binding. Lives alongside TagMapping; a tag has one OR the other. */
export type RuleBindings = Record<string, RuleBinding>

export type ConditionOperator = 'equals' | 'not_equals' | 'contains'

/** One branch of a conditional: "if [column] [op] [value] -> show [text]". */
export interface ConditionBranch {
  id: string
  column: string
  operator: ConditionOperator
  value: string
  /** Text to show when this branch matches. May itself contain `{{tags}}`. */
  text: string
}

/**
 * A conditional content block the user inserts at a chosen point of the
 * document (an inline `.ttg-cond` element; the rule JSON lives in its
 * data-cond attribute — see lib/cond.ts). Branches are evaluated
 * top-to-bottom; the first match wins. If nothing matches, `defaultText` is
 * shown (may be empty). Inside a repeatable section it is evaluated once per
 * row.
 */
export interface ConditionalRule {
  id: string
  /** Friendly name the user gives it, e.g. "Aviso de impago". */
  label: string
  branches: ConditionBranch[]
  defaultText?: string
}

/**
 * How many documents to produce and how rows collapse into each one.
 * (Which sections repeat per row lives in the document itself, as the
 * data-ttg-repeat attribute -> TemplateBlock.repeat.)
 */
export interface GroupConfig {
  mode: 'per_row' | 'per_group'
  /** Column used to group rows when mode === 'per_group'. */
  groupByColumn: string | null
}

export type DocStatus = 'pending' | 'done' | 'error'

/** A single produced document, resolved and (once generated) rendered to PDF. */
export interface GeneratedDocument {
  id: string
  /** The group key (grouping column value) or row label this doc came from. */
  groupKey: string
  /** How many source rows fed this document. */
  rowCount: number
  /** Fully-resolved HTML (tags substituted, conditionals evaluated). */
  html: string
  status: DocStatus
  error?: string
  /** File name suggested for download, without extension. */
  fileName: string
}

/** Everything needed to produce output — the serialisable workspace result. */
export interface GenerationPlan {
  template: Template
  data: DataSourceData
  mapping: TagMapping
  ruleBindings: RuleBindings
  group: GroupConfig
}

/**
 * A saved, reusable workspace configuration ("Mis plantillas"): the EDITED
 * template document plus sources, bindings and grouping. Row data is NOT
 * stored — it is per-batch and reloads from the data source on use.
 */
export interface Recipe {
  /** DB id (uuid). Absent only on not-yet-saved payloads. */
  id: string
  /** Name the user gives it, e.g. "Notificación impago mensual". */
  name: string
  /** ISO date of the save (shown so stale templates are recognisable). */
  savedAt: string
  templateUrl: string
  editorHtml: string
  editorCss: string
  editorTitle: string
  editorBodyClass: string
  dataKind: DataSourceKind
  dataUrl: string
  mapping: TagMapping
  /** Tag -> rule bindings (anchored conditionals/repeats). Absent in old recipes. */
  ruleBindings?: RuleBindings
  group: GroupConfig
  /**
   * Imported Drive file + as-imported fingerprints (see lib/nativeMerge.ts),
   * kept so an unedited saved template still generates through the native
   * route. Absent in recipes saved before this existed.
   */
  sourceFile?: import('./lib/nativeMerge').SourceFileMeta
}
