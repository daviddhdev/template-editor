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

/**
 * Single-screen workspace state. Deliberately small: everything that is
 * "markup" (fields, repeatable sections, inline conditionals) lives INSIDE the
 * editable document HTML as data-* attributes / elements and travels with it;
 * the store only holds sources, data, explicit field bindings and the view
 * mode.
 *
 * Persistence: the working state auto-saves PER USER — instantly to a
 * per-user localStorage mirror and, debounced, to the DB (workspace_drafts;
 * see draftStorage.ts) — so an accidental reload never loses work and the
 * draft follows the account across browsers. skipHydration: the authed
 * layout rehydrates on the client with the session user and docToken is
 * bumped so the editor iframe re-renders the restored document.
 *
 * History: undo/redo works on snapshots of (editorHtml, editorCss) — the two
 * values that fully define the document. One stack for EVERYTHING (typing,
 * fields, conditionals, repeats, formatting, margins): the browser's native
 * contenteditable undo cannot see programmatic DOM mutations, so it is
 * intercepted and replaced by this. Memory-only (never persisted: snapshots
 * of a 1 MB document would blow the storage quota).
 */

/** One undoable step: the document state BEFORE the change named `label`. */
export interface HistoryEntry {
  html: string
  css: string
  label: string
  at: number
}

const HISTORY_LIMIT = 50

/** Push the current document onto the past (helper for store actions). */
function pushHistory(
  s: Pick<WorkspaceState, 'editorHtml' | 'editorCss' | 'history'>,
  label: string,
): WorkspaceState['history'] {
  if (!s.editorHtml.trim()) return s.history
  const top = s.history.past.at(-1)
  if (top && top.html === s.editorHtml && top.css === s.editorCss) return s.history
  // Coalesce bursts of the same action (typing, arrow-key margin nudges):
  // one entry per burst, keeping the state at the burst's start. The future
  // is still cleared — the timeline has diverged.
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
  // Template document (editor canvas)
  templateUrl: string
  /** Editable body HTML — the single source of truth for the document. */
  editorHtml: string
  editorCss: string
  editorTitle: string
  editorBodyClass: string
  /** Bumped whenever a new source doc is loaded, so the canvas re-initialises. */
  docToken: number
  /**
   * The imported Drive file behind the document, with fingerprints of the
   * as-imported state — the gate for the native generation route (see
   * lib/nativeMerge.ts). Null for blank documents and old recipes.
   */
  sourceFile: SourceFileMeta | null

  // Data
  dataKind: DataSourceKind
  dataUrl: string
  /** API-source config when dataKind is 'api_endpoint' (types.ts). Null for a
   * sheet. Its `authBody` is only populated in the session where the user typed
   * it; a recipe reloads it redacted (authBodyStored flags a stored secret). */
  apiConfig: ApiSourceConfig | null
  data: DataSourceData | null
  /** Tabs of the loaded spreadsheet (empty = unknown/not a sheet). */
  sheetTabs: { gid: string; title: string }[]

  /**
   * Explicit field -> column bindings. Only needed for imported {{campos}}
   * whose name does not match a column; fields named like a column bind by
   * identity (see lib/plan.ts effectiveMapping).
   */
  mapping: TagMapping

  /**
   * Tags bound to a RULE instead of a column (anchored conditionals /
   * repeatable sections — see types.ts RuleBinding). A tag lives in `mapping`
   * OR here, never both.
   */
  ruleBindings: RuleBindings

  /**
   * Per-tag display formats (types.ts TagFormats). Kept even while the tag is
   * unbound or its column is missing — like `mapping`, coming back revives it.
   */
  tagFormats: TagFormats

  group: GroupConfig

  /** Drive folder URL (pasted by the user) where generated documents are
   * uploaded. Per template — saved/restored with the recipe. '' = none. */
  outputFolderUrl: string

  /**
   * Library row this workspace came from or was last saved to (null = never
   * saved). Lets "Guardar" overwrite the existing template instead of always
   * creating a new one.
   */
  savedRecipe: { id: string; name: string } | null

  /** Canvas mode: editing the template or previewing resolved documents. */
  view: 'edit' | 'preview'

  /** One-at-a-time transient notice (toast). Token distinguishes repeats. */
  notice: string | null
  noticeToken: number

  setTemplateUrl: (url: string) => void
  /** `sourceId` = Drive file id of the imported doc (enables native output). */
  loadRawDocument: (raw: RawDocument, sourceId?: string | null) => void
  setEditorHtml: (html: string) => void
  /** Page side margins (pt) chosen with the ruler; stored as CSS override. */
  setPageMargins: (leftPt: number, rightPt: number, contentWidthPt: number) => void

  setDataKind: (k: DataSourceKind) => void
  setDataUrl: (url: string) => void
  setApiConfig: (c: ApiSourceConfig | null) => void
  setData: (d: DataSourceData) => void
  setSheetTabs: (tabs: { gid: string; title: string }[]) => void

  assign: (tag: string, column: string | null) => void
  mergeMapping: (m: TagMapping) => void
  /** Bind a tag to a rule (clears any column binding for it). */
  bindRule: (tag: string, rule: ConditionalRule, perRow: boolean) => void
  unbindRule: (tag: string) => void
  /** Set (or clear, with null) the display format of a tag. */
  setTagFormat: (tag: string, format: FormatId | null) => void

  setGroup: (patch: Partial<GroupConfig>) => void
  setOutputFolderUrl: (url: string) => void
  setView: (v: 'edit' | 'preview') => void

  /** Record (or clear) the library row this workspace is linked to. */
  setSavedRecipe: (v: { id: string; name: string } | null) => void

  notify: (text: string) => void
  clearNotice: () => void

  /** Undo/redo stacks (memory only). `past` top = most recent change. */
  history: { past: HistoryEntry[]; future: HistoryEntry[] }
  /** Record the CURRENT document as the state before the change `label`. */
  checkpoint: (label: string) => void
  /** Revert the last change. Returns its label, or null if nothing to undo. */
  undo: () => string | null
  /** Re-apply the last undone change. Returns its label, or null. */
  redo: () => string | null

  /** Restore a saved recipe (template + sources + bindings; data reloads). */
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
          // Fingerprints of the AS-IMPORTED state (the same strings stored
          // above) so generation can tell "untouched" from "edited in-app",
          // plus the exact {{tag}} spellings for native replaceAllText.
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

      // The body padding IS the document's page margin (server/pdf.ts turns it
      // into real @page margins; the Google path re-lays it out the same way).
      // max-width moves WITH the margins so the physical page width stays
      // constant — a wider margin narrows the content, like a real page.
      // Kept as a marked, replaceable override at the END of the doc CSS —
      // !important because Google's own geometry class would otherwise win.
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
          // A tag is bound to a column OR a rule — never both.
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
          // Fill gaps only; never overwrite an explicit user choice.
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
            // Current state goes to the future so redo can bring it back.
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
          data: null, // rows are per-batch: reloaded from the source each time
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
      // SSR-safe: the authed layout calls rehydrateStores() in a client
      // effect (it knows the session user), then docToken is bumped so
      // DocCanvas rewrites the iframe with the restored HTML.
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
        // Never persist the plaintext login body to the draft: a saved recipe
        // reloads it from its encrypted copy (via recipeId); an unsaved one is
        // re-entered. Keeps credentials out of localStorage / workspace_drafts.
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

/** Resolves once the first rehydrateStores() finishes — screens that read
 * restored state await this instead of hydrating themselves (only the authed
 * layout knows the session user). */
export function storesHydrated(): Promise<void> {
  return hydratedOnce
}

/**
 * Rehydrate the persisted stores for the session user (idempotent per user —
 * the authed layout calls it on mount). The workspace draft comes from the
 * newest of DB row / local mirror (see draftStorage.ts); afterwards docToken
 * is bumped so the editor iframe re-renders the restored document.
 */
export async function rehydrateStores(user: { id: string; email: string }): Promise<void> {
  if (typeof window === 'undefined' || hydratedFor === user.id) return
  const switching = hydratedFor !== null
  hydratedFor = user.id
  configureDraftStorage(user, (text) => useWorkspace.getState().notify(text))
  if (switching) {
    // A different account took over this tab without a reload: nothing of the
    // previous user may survive in memory (their draft-less rehydrate below
    // would otherwise keep the current state). History included — it holds
    // the other user's document snapshots.
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

// Dev-only: lets browser smoke tests drive the store without hitting Google.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __ttgStore?: typeof useWorkspace }).__ttgStore = useWorkspace
}
