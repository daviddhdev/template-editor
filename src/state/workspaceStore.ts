import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type {
  ApiSourceConfig,
  ConditionalRule,
  DataSourceData,
  DataSourceKind,
  FormatId,
  GroupConfig,
  Recipe,
  RuleBindings,
  TagFormats,
  TagMapping,
} from '../types'
import type { RawDocument } from '../lib/template/parse'
import { fingerprintCss, fingerprintHtml, normalizeBodyHtml } from '../lib/fingerprint'
import {
  nativeTextSegments,
  sourceFieldOccurrences,
  tagLiterals,
  upgradeSourceFileMeta,
  type SourceFileMeta,
} from '../lib/nativeMerge'
import { configureDraftStorage, draftStorage } from './draftStorage'

// Markup stays in editorHtml/editorCss; the store holds sources, data, bindings,
// view state, and memory-only undo snapshots. Draft persistence is per user.

export interface HistoryEntry {
  html: string
  css: string
  label: string
  at: number
}

const HISTORY_LIMIT = 50

function pushHistory(
  s: Pick<WorkspaceState, 'editorHtml' | 'editorCss' | 'history'>,
  label: string,
): WorkspaceState['history'] {
  if (!s.editorHtml.trim()) return s.history
  const top = s.history.past.at(-1)
  if (top && top.html === s.editorHtml && top.css === s.editorCss) return s.history
  // Coalesce consecutive typing and margin nudges into one undo step.
  if (top && top.label === label && Date.now() - top.at < 1500) {
    return { past: s.history.past, future: [] }
  }
  return {
    past: [
      ...s.history.past,
      { html: s.editorHtml, css: s.editorCss, label, at: Date.now() },
    ].slice(-HISTORY_LIMIT),
    future: [],
  }
}
interface WorkspaceState {
  templateUrl: string
  editorHtml: string
  editorCss: string
  editorTitle: string
  editorBodyClass: string
  docToken: number
  sourceFile: SourceFileMeta | null

  dataKind: DataSourceKind
  dataUrl: string
  apiConfig: ApiSourceConfig | null
  data: DataSourceData | null
  sheetTabs: { gid: string; title: string }[]

  mapping: TagMapping

  ruleBindings: RuleBindings

  tagFormats: TagFormats

  group: GroupConfig

  outputFolderUrl: string

  savedRecipe: { id: string; name: string } | null

  view: 'edit' | 'preview'

  notice: string | null
  noticeToken: number

  setTemplateUrl: (url: string) => void
  loadRawDocument: (raw: RawDocument, sourceId?: string | null) => void
  setEditorHtml: (html: string) => void
  setPageMargins: (leftPt: number, rightPt: number, contentWidthPt: number) => void

  setDataKind: (k: DataSourceKind) => void
  setDataUrl: (url: string) => void
  setApiConfig: (c: ApiSourceConfig | null) => void
  setData: (d: DataSourceData) => void
  setSheetTabs: (tabs: { gid: string; title: string }[]) => void

  assign: (tag: string, column: string | null) => void
  mergeMapping: (m: TagMapping) => void
  bindRule: (tag: string, rule: ConditionalRule, perRow: boolean) => void
  unbindRule: (tag: string) => void
  setTagFormat: (tag: string, format: FormatId | null) => void

  setGroup: (patch: Partial<GroupConfig>) => void
  setOutputFolderUrl: (url: string) => void
  setView: (v: 'edit' | 'preview') => void

  setSavedRecipe: (v: { id: string; name: string } | null) => void

  notify: (text: string) => void
  clearNotice: () => void

  history: { past: HistoryEntry[]; future: HistoryEntry[] }
  checkpoint: (label: string) => void
  undo: () => string | null
  redo: () => string | null

  loadRecipe: (r: Recipe) => void

  reset: () => void
}

const initialGroup: GroupConfig = { mode: 'per_row', groupByColumn: null }

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      templateUrl: '',
      editorHtml: '',
      editorCss: '',
      editorTitle: 'Plantilla',
      editorBodyClass: '',
      docToken: 0,
      sourceFile: null,
      dataKind: 'google_sheet',
      dataUrl: '',
      apiConfig: null,
      data: null,
      sheetTabs: [],
      mapping: {},
      ruleBindings: {},
      tagFormats: {},
      group: initialGroup,
      outputFolderUrl: '',
      savedRecipe: null,
      view: 'edit',
      notice: null,
      noticeToken: 0,

      setTemplateUrl: (templateUrl) => set({ templateUrl }),
      loadRawDocument: (raw, sourceId) =>
        set((s) => ({
          editorHtml: raw.bodyHtml,
          editorCss: raw.css,
          editorTitle: raw.title,
          editorBodyClass: raw.bodyClass,
          docToken: s.docToken + 1,
          // Store the imported fingerprints and literal tag spellings used by
          // the native route.
          sourceFile: sourceId
            ? {
                id: sourceId,
                fingerprint: fingerprintHtml(raw.bodyHtml),
                cssFingerprint: fingerprintCss(raw.css),
                tagLiterals: tagLiterals(raw.bodyHtml),
                textSegments: nativeTextSegments(normalizeBodyHtml(raw.bodyHtml)),
                fieldOccurrences: sourceFieldOccurrences(raw.bodyHtml),
              }
            : null,
          view: 'edit',
          history: pushHistory(s, 'Cargar documento'),
        })),
      setEditorHtml: (editorHtml) => set({ editorHtml }),

      // Body padding represents page margins; preserve content width and replace
      // the marked override after the source CSS.
      setPageMargins: (leftPt, rightPt, contentWidthPt) =>
        set((s) => {
          const rule = `/*ttg-margins*/body{padding-left:${leftPt}pt !important;padding-right:${rightPt}pt !important;max-width:${contentWidthPt}pt !important;}`
          const re = /\n?\/\*ttg-margins\*\/body\{[^}]*\}/
          const css = s.editorCss
          return {
            editorCss: re.test(css) ? css.replace(re, `\n${rule}`) : `${css}\n${rule}`,
          }
        }),

      setDataKind: (dataKind) => set({ dataKind }),
      setDataUrl: (dataUrl) => set({ dataUrl }),
      setApiConfig: (apiConfig) => set({ apiConfig }),
      setData: (data) => set({ data }),
      setSheetTabs: (sheetTabs) => set({ sheetTabs }),

      assign: (tag, column) =>
        set((s) => {
          // A tag belongs to a column or a rule, never both.
          const { [tag]: _dropped, ...rest } = s.ruleBindings
          return { mapping: { ...s.mapping, [tag]: column }, ruleBindings: rest }
        }),
      bindRule: (tag, rule, perRow) =>
        set((s) => ({
          ruleBindings: { ...s.ruleBindings, [tag]: { rule, perRow } },
          mapping: { ...s.mapping, [tag]: null },
        })),
      unbindRule: (tag) =>
        set((s) => {
          const { [tag]: _dropped, ...rest } = s.ruleBindings
          return { ruleBindings: rest }
        }),
      setTagFormat: (tag, format) =>
        set((s) => {
          if (!format) {
            const { [tag]: _dropped, ...rest } = s.tagFormats
            return { tagFormats: rest }
          }
          return { tagFormats: { ...s.tagFormats, [tag]: format } }
        }),
      mergeMapping: (m) =>
        set((s) => {
          const merged: TagMapping = { ...m }
          for (const [k, v] of Object.entries(s.mapping)) if (v) merged[k] = v
          return { mapping: merged }
        }),

      setGroup: (patch) => set((s) => ({ group: { ...s.group, ...patch } })),
      setOutputFolderUrl: (outputFolderUrl) => set({ outputFolderUrl }),
      setView: (view) => set({ view }),

      setSavedRecipe: (savedRecipe) => set({ savedRecipe }),

      notify: (notice) => set((s) => ({ notice, noticeToken: s.noticeToken + 1 })),
      clearNotice: () => set({ notice: null }),

      history: { past: [], future: [] },

      checkpoint: (label) => set((s) => ({ history: pushHistory(s, label) })),

      undo: () => {
        const s = get()
        const prev = s.history.past.at(-1)
        if (!prev) return null
        set({
          editorHtml: prev.html,
          editorCss: prev.css,
          docToken: s.docToken + 1,
          history: {
            past: s.history.past.slice(0, -1),
            future: [
              ...s.history.future,
              { html: s.editorHtml, css: s.editorCss, label: prev.label, at: Date.now() },
            ],
          },
        })
        return prev.label
      },

      redo: () => {
        const s = get()
        const next = s.history.future.at(-1)
        if (!next) return null
        set({
          editorHtml: next.html,
          editorCss: next.css,
          docToken: s.docToken + 1,
          history: {
            past: [
              ...s.history.past,
              { html: s.editorHtml, css: s.editorCss, label: next.label, at: Date.now() },
            ].slice(-HISTORY_LIMIT),
            future: s.history.future.slice(0, -1),
          },
        })
        return next.label
      },

      loadRecipe: (r) =>
        set((s) => ({
          history: pushHistory(s, 'Cargar plantilla guardada'),
          templateUrl: r.templateUrl,
          editorHtml: r.editorHtml,
          editorCss: r.editorCss,
          editorTitle: r.editorTitle,
          editorBodyClass: r.editorBodyClass,
          sourceFile: upgradeSourceFileMeta(r.sourceFile, r.editorHtml),
          dataKind: r.dataKind,
          dataUrl: r.dataUrl,
          apiConfig: r.apiConfig ?? null,
      data: null,
          sheetTabs: [],
          mapping: r.mapping,
          ruleBindings: r.ruleBindings ?? {},
          tagFormats: r.tagFormats ?? {},
          group: r.group,
          outputFolderUrl: r.outputFolderUrl ?? '',
          savedRecipe: { id: r.id, name: r.name },
          docToken: s.docToken + 1,
          view: 'edit',
        })),

      reset: () =>
        set((s) => ({
          history: pushHistory(s, 'Vaciar todo'),
          templateUrl: '',
          editorHtml: '',
          editorCss: '',
          editorTitle: 'Plantilla',
          editorBodyClass: '',
          docToken: s.docToken + 1,
          sourceFile: null,
          dataKind: 'google_sheet',
          dataUrl: '',
          apiConfig: null,
          data: null,
          sheetTabs: [],
          mapping: {},
          ruleBindings: {},
          tagFormats: {},
          group: initialGroup,
          outputFolderUrl: '',
          savedRecipe: null,
          view: 'edit',
        })),
    }),
    {
      name: 'ttg-workspace',
      storage: createJSONStorage(() => draftStorage),
      skipHydration: true,
      partialize: (s) => ({
        templateUrl: s.templateUrl,
        editorHtml: s.editorHtml,
        editorCss: s.editorCss,
        editorTitle: s.editorTitle,
        editorBodyClass: s.editorBodyClass,
        sourceFile: s.sourceFile,
        dataKind: s.dataKind,
        dataUrl: s.dataUrl,
        // Never persist plaintext API credentials to localStorage or drafts.
        apiConfig: s.apiConfig ? { ...s.apiConfig, authBody: '' } : null,
        data: s.data,
        sheetTabs: s.sheetTabs,
        mapping: s.mapping,
        ruleBindings: s.ruleBindings,
        tagFormats: s.tagFormats,
        group: s.group,
        outputFolderUrl: s.outputFolderUrl,
        savedRecipe: s.savedRecipe,
      }),
    },
  ),
)

let hydratedFor: string | null = null
let resolveHydrated: (() => void) | null = null
const hydratedOnce = new Promise<void>((resolve) => {
  resolveHydrated = resolve
})

export function storesHydrated(): Promise<void> {
  return hydratedOnce
}

export async function rehydrateStores(user: { id: string; email: string }): Promise<void> {
  if (typeof window === 'undefined' || hydratedFor === user.id) return
  const switching = hydratedFor !== null
  hydratedFor = user.id
  configureDraftStorage(user, (text) => useWorkspace.getState().notify(text))
  if (switching) {
    // Clear in-memory state when another account takes over this tab.
    useWorkspace.setState((s) => ({
      templateUrl: '',
      editorHtml: '',
      editorCss: '',
      editorTitle: 'Plantilla',
      editorBodyClass: '',
      docToken: s.docToken + 1,
      sourceFile: null,
      dataKind: 'google_sheet',
      dataUrl: '',
      apiConfig: null,
      data: null,
      sheetTabs: [],
      mapping: {},
      ruleBindings: {},
      tagFormats: {},
      group: initialGroup,
      outputFolderUrl: '',
      savedRecipe: null,
      view: 'edit',
      history: { past: [], future: [] },
    }))
  }
  await Promise.resolve(useWorkspace.persist.rehydrate())
  const s = useWorkspace.getState()
  if (s.editorHtml.trim()) {
    useWorkspace.setState({
      docToken: s.docToken + 1,
      sourceFile: upgradeSourceFileMeta(s.sourceFile, s.editorHtml),
    })
  }
  resolveHydrated?.()
}

if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __ttgStore?: typeof useWorkspace }).__ttgStore = useWorkspace
}
