import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Recipe } from '../types'
import { useWorkspace } from './workspaceStore'

/**
 * Saved workspace configurations ("Mis plantillas") — the accelerator for
 * recurring batches: set everything up once, save it, and next month load it
 * with one click and just re-read the data.
 *
 * Persisted to its own localStorage key. Templates can be ~1 MB of HTML each
 * (a 20-page bulletin), so saving is size-guarded against the ~5 MB
 * localStorage quota instead of failing opaquely mid-write.
 */
interface RecipesState {
  recipes: Recipe[]
  /** Snapshot the current workspace under `name`. */
  saveCurrent: (name: string) => 'ok' | 'too_big'
  remove: (id: string) => void
}

/** Stay well under the ~5 MB quota (the workspace itself also persists). */
const MAX_TOTAL_BYTES = 3_500_000

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

export const useRecipes = create<RecipesState>()(
  persist(
    (set, get) => ({
      recipes: [],

      saveCurrent: (name) => {
        const w = useWorkspace.getState()
        const recipe: Recipe = {
          id: uid(),
          name: name.trim() || w.editorTitle || 'Sin nombre',
          savedAt: new Date().toISOString(),
          templateUrl: w.templateUrl,
          editorHtml: w.editorHtml,
          editorCss: w.editorCss,
          editorTitle: w.editorTitle,
          editorBodyClass: w.editorBodyClass,
          dataKind: w.dataKind,
          dataUrl: w.dataUrl,
          mapping: w.mapping,
          group: w.group,
        }
        const next = [recipe, ...get().recipes]
        if (JSON.stringify(next).length > MAX_TOTAL_BYTES) return 'too_big'
        set({ recipes: next })
        return 'ok'
      },

      remove: (id) => set((s) => ({ recipes: s.recipes.filter((r) => r.id !== id) })),
    }),
    {
      name: 'ttg-recipes',
      storage: createJSONStorage(() => localStorage),
      // SSR-safe: rehydrated from a client effect alongside the workspace.
      skipHydration: true,
    },
  ),
)
