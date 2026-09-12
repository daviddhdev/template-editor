
export type BlockType = 'paragraph' | 'heading' | 'table' | 'list' | 'other'

export interface TemplateBlock {
  id: string
  type: BlockType
  html: string
  text: string
  tags: string[]
  repeat: boolean
  cond: ConditionalRule | null
}

export interface Template {
  sourceUrl: string
  title: string
  css: string
  bodyClass: string
  blocks: TemplateBlock[]
  tags: string[]
}

export type DataSourceKind = 'google_sheet' | 'api_endpoint' | 'manual_form'

export interface DataSourceData {
  kind: DataSourceKind
  origin: string
  columns: string[]
  rows: Record<string, string>[]
}

export interface ApiSourceConfig {
  authUrl: string
  /** Sensitive login body; encrypted at rest and redacted before browser return. */
  authBody: string
  tokenPath: string
  dataUrl: string
  recordsPath: string
  columns: string[]
  /** Read-only hint that the stored recipe contains encrypted credentials. */
  authBodyStored?: boolean
}

export type TagMapping = Record<string, string | null>

export type FormatId =
  | 'fecha_larga' // «12 de julio de 2026»
  | 'fecha_corta' // «12/07/2026»
  | 'moneda' // «1.200,00 €» (always 2 decimals)
  | 'importe_letra' // «mil doscientos euros (1.200 €)»
  | 'importe_letra_mayus' // «MIL DOSCIENTOS EUROS (1.200 €)»
  | 'mayusculas' // «ACME SL»
  | 'titulo' // «Juan Pérez de la Cruz»

export type TagFormats = Record<string, FormatId>

export interface RuleBinding {
  rule: ConditionalRule
  perRow: boolean
}

export type RuleBindings = Record<string, RuleBinding>

export type ConditionOperator = 'equals' | 'not_equals' | 'contains'

export interface ConditionalTextStyle {
  fontFamily?: string
  fontSize?: string
  lineHeight?: string
  color?: string
}

export interface ConditionBranch {
  id: string
  column: string
  operator: ConditionOperator
  value: string
  text: string
  textHtml?: string
}

export interface ConditionalRule {
  id: string
  label: string
  branches: ConditionBranch[]
  defaultText?: string
  defaultTextHtml?: string
  textStyle?: ConditionalTextStyle
}

export interface GroupConfig {
  mode: 'per_row' | 'per_group'
  groupByColumn: string | null
}

export type DocStatus = 'pending' | 'done' | 'error'

export interface GeneratedDocument {
  id: string
  groupKey: string
  rowCount: number
  html: string
  status: DocStatus
  error?: string
  fileName: string
}

export interface GenerationPlan {
  template: Template
  data: DataSourceData
  mapping: TagMapping
  ruleBindings: RuleBindings
  tagFormats?: TagFormats
  group: GroupConfig
}

export interface Recipe {
  id: string
  name: string
  savedAt: string
  currentVersion: number
  templateUrl: string
  editorHtml: string
  editorCss: string
  editorTitle: string
  editorBodyClass: string
  dataKind: DataSourceKind
  dataUrl: string
  apiConfig?: ApiSourceConfig
  mapping: TagMapping
  ruleBindings?: RuleBindings
  tagFormats?: TagFormats
  group: GroupConfig
  sourceFile?: import('./lib/nativeMerge').SourceFileMeta
  outputFolderUrl?: string
}
