import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { DataSourceData, DataSourceKind, GroupConfig, Recipe, TagMapping } from '../types'
import type { RawDocument } from '../lib/template/parse'

/**
 * Single-screen workspace state. Deliberately small: everything that is
 * "markup" (fields, repeatable sections, inline conditionals) lives INSIDE the
 * editable document HTML as data-* attributes / elements and travels with it;
 * the store only holds sources, data, explicit field bindings and the view
 * mode.
 *
 * Persistence: the working state auto-saves to localStorage so an accidental
 * reload never loses work (skipHydration — Workspace rehydrates on the client
 * and bumps docToken so the editor iframe re-renders the restored document).
 *
 * History: undo/redo works on snapshots of (editorHtml, editorCss) — the two
 * values that fully define the document. One stack for EVERYTHING (typing,
 * fields, conditionals, repeats, formatting, margins): the browser's native
 * contenteditable undo cannot see programmatic DOM mutations, so it is
 * intercepted and replaced by this. Memory-only (never persisted: snapshots
 * of a 1 MB document would blow the localStorage quota).
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

  // Data
  dataKind: DataSourceKind
  dataUrl: string
  data: DataSourceData | null
  /** Tabs of the loaded spreadsheet (empty = unknown/not a sheet). */
  sheetTabs: { gid: string; title: string }[]

  /**
   * Explicit field -> column bindings. Only needed for imported {{campos}}
   * whose name does not match a column; fields named like a column bind by
   * identity (see lib/plan.ts effectiveMapping).
   */
  mapping: TagMapping

  group: GroupConfig

  /** Canvas mode: editing the template or previewing resolved documents. */
  view: 'edit' | 'preview'

  /** One-at-a-time transient notice (toast). Token distinguishes repeats. */
  notice: string | null
  noticeToken: number

  setTemplateUrl: (url: string) => void
  loadRawDocument: (raw: RawDocument) => void
  setEditorHtml: (html: string) => void
  /** Page side margins (pt) chosen with the ruler; stored as CSS override. */
  setPageMargins: (leftPt: number, rightPt: number, contentWidthPt: number) => void

  setDataKind: (k: DataSourceKind) => void
  setDataUrl: (url: string) => void
  setData: (d: DataSourceData) => void
  setSheetTabs: (tabs: { gid: string; title: string }[]) => void

  assign: (tag: string, column: string | null) => void
  mergeMapping: (m: TagMapping) => void

  setGroup: (patch: Partial<GroupConfig>) => void
  setView: (v: 'edit' | 'preview') => void

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
      dataKind: 'google_sheet',
      dataUrl: '',
      data: null,
      sheetTabs: [],
      mapping: {},
      group: initialGroup,
      view: 'edit',
      notice: null,
      noticeToken: 0,

      setTemplateUrl: (templateUrl) => set({ templateUrl }),
      loadRawDocument: (raw) =>
        set((s) => ({
          editorHtml: raw.bodyHtml,
          editorCss: raw.css,
          editorTitle: raw.title,
          editorBodyClass: raw.bodyClass,
          docToken: s.docToken + 1,
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
      setData: (data) => set({ data }),
      setSheetTabs: (sheetTabs) => set({ sheetTabs }),

      assign: (tag, column) => set((s) => ({ mapping: { ...s.mapping, [tag]: column } })),
      mergeMapping: (m) =>
        set((s) => {
          // Fill gaps only; never overwrite an explicit user choice.
          const merged: TagMapping = { ...m }
          for (const [k, v] of Object.entries(s.mapping)) if (v) merged[k] = v
          return { mapping: merged }
        }),

      setGroup: (patch) => set((s) => ({ group: { ...s.group, ...patch } })),
      setView: (view) => set({ view }),

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
          dataKind: r.dataKind,
          dataUrl: r.dataUrl,
          data: null, // rows are per-batch: reloaded from the source each time
          sheetTabs: [],
          mapping: r.mapping,
          group: r.group,
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
          dataKind: 'google_sheet',
          dataUrl: '',
          data: null,
          sheetTabs: [],
          mapping: {},
          group: initialGroup,
          view: 'edit',
        })),
    }),
    {
      name: 'ttg-workspace',
      storage: createJSONStorage(() => localStorage),
      // SSR-safe: Workspace calls rehydrate() in a client effect, then bumps
      // docToken so DocCanvas rewrites the iframe with the restored HTML.
      skipHydration: true,
      partialize: (s) => ({
        templateUrl: s.templateUrl,
        editorHtml: s.editorHtml,
        editorCss: s.editorCss,
        editorTitle: s.editorTitle,
        editorBodyClass: s.editorBodyClass,
        dataKind: s.dataKind,
        dataUrl: s.dataUrl,
        data: s.data,
        sheetTabs: s.sheetTabs,
        mapping: s.mapping,
        group: s.group,
      }),
    },
  ),
)

let hydrated = false

/**
 * Rehydrate the persisted stores once per page load (idempotent — Home and the
 * editor both call it on mount). After restoring, docToken is bumped so the
 * editor iframe re-renders the restored document; rehydration alone would not.
 */
export async function rehydrateStores(): Promise<void> {
  if (hydrated || typeof window === 'undefined') return
  hydrated = true
  const { useRecipes } = await import('./recipesStore')
  await Promise.resolve(useWorkspace.persist.rehydrate())
  await Promise.resolve(useRecipes.persist.rehydrate())
  const s = useWorkspace.getState()
  if (s.editorHtml.trim()) useWorkspace.setState({ docToken: s.docToken + 1 })
}

// Dev-only: lets browser smoke tests drive the store without hitting Google.
if (import.meta.env.DEV && typeof window !== 'undefined') {
  ;(window as unknown as { __ttgStore?: typeof useWorkspace }).__ttgStore = useWorkspace
}
