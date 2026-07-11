import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
import type { Recipe } from '../types'

/**
 * LEGACY localStorage template store. The library now lives in Postgres
 * (server/recipesDb.ts); this store only survives so the Home screen can
 * migrate any templates saved by older versions of the app into the database
 * (one at a time — see Home.tsx). Delete once no browser still holds data.
 */
interface RecipesState {
  recipes: Recipe[]
  remove: (id: string) => void
}

export const useRecipes = create<RecipesState>()(
  persist(
    (set) => ({
      recipes: [],
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
