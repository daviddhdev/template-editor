import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import type { Recipe } from '../types'

/**
 * Template library (recipes) on Postgres — the durable, multi-user-ready home
 * that replaced localStorage. All fns return Result<> with actionable errors;
 * the DB module is imported dynamically so nothing server-side leaks into the
 * client bundle.
 */

/** Lightweight row for the home grid — no editor_html (~1 MB per template). */
export interface RecipeSummary {
  id: string
  name: string
  /** ISO date of the last save. */
  updatedAt: string
  /** PNG thumbnail, base64 (no data: prefix), or null for older rows. */
  thumbnail: string | null
}

function dbError(err: unknown): { ok: false; error: string; hint?: string } {
  const e = err as { message?: string; hint?: string; code?: string }
  if (typeof e?.code === 'string' && (e.code.startsWith('ECONN') || e.code === 'CONNECT_TIMEOUT')) {
    return {
      ok: false,
      error: 'No se pudo conectar con la base de datos.',
      hint: 'Arráncala con «docker compose up -d» en la carpeta del proyecto y vuelve a intentarlo.',
    }
  }
  return { ok: false, error: e?.message || 'La base de datos devolvió un error.', hint: e?.hint }
}

/** Payload to save: a Recipe minus the DB-managed fields. */
export type RecipeInput = Omit<Recipe, 'id' | 'savedAt'>

/**
 * Render a small PNG of the template's first page for the home grid.
 * Best-effort: a save never fails because the thumbnail did.
 */
async function renderThumbnail(input: RecipeInput): Promise<Uint8Array | null> {
  try {
    const { chromium } = await import('playwright')
    const bodyClass = input.editorBodyClass ? ` class="${input.editorBodyClass}"` : ''
    const html = `<!doctype html><html><head><meta charset="utf-8">
<style>${input.editorCss}</style>
<style>html{zoom:0.4;background:#fff;}body{margin:0 auto;}</style>
</head><body${bodyClass}>${input.editorHtml}</body></html>`
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 330, height: 460 } })
      await page.setContent(html, { waitUntil: 'load', timeout: 10000 }).catch(() => {})
      return await page.screenshot({ type: 'png' })
    } finally {
      await browser.close()
    }
  } catch {
    return null
  }
}

const summarize = (r: {
  id: string
  name: string
  updated_at: Date
  thumbnail: Uint8Array | null
}): RecipeSummary => ({
  id: r.id,
  name: r.name,
  updatedAt: r.updated_at.toISOString(),
  thumbnail: r.thumbnail ? Buffer.from(r.thumbnail).toString('base64') : null,
})

/** The library, newest first (for the home grid). */
export const listRecipesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<RecipeSummary[]>> => {
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const rows = await sql`
        SELECT id, name, updated_at, thumbnail FROM recipes ORDER BY updated_at DESC`
      return { ok: true, data: rows.map((r) => summarize(r as Parameters<typeof summarize>[0])) }
    } catch (err) {
      return dbError(err)
    }
  },
)

export const getRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<Result<Recipe>> => {
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const rows = await sql`SELECT * FROM recipes WHERE id = ${data.id}`
      const r = rows[0]
      if (!r) return { ok: false, error: 'Esa plantilla ya no existe.' }
      return {
        ok: true,
        data: {
          id: r.id,
          name: r.name,
          savedAt: (r.updated_at as Date).toISOString(),
          templateUrl: r.template_url,
          editorHtml: r.editor_html,
          editorCss: r.editor_css,
          editorTitle: r.editor_title,
          editorBodyClass: r.editor_body_class,
          dataKind: r.data_kind,
          dataUrl: r.data_url,
          mapping: r.mapping,
          group: r.group_config,
        },
      }
    } catch (err) {
      return dbError(err)
    }
  })

/** Save the current workspace as a new template (thumbnail included). */
export const saveRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: { recipe: RecipeInput }) => input)
  .handler(async ({ data }): Promise<Result<{ id: string }>> => {
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const r = data.recipe
      const thumbnail = await renderThumbnail(r)
      const rows = await sql`
        INSERT INTO recipes (name, template_url, editor_html, editor_css, editor_title,
          editor_body_class, data_kind, data_url, mapping, group_config, thumbnail)
        VALUES (${r.name}, ${r.templateUrl}, ${r.editorHtml}, ${r.editorCss}, ${r.editorTitle},
          ${r.editorBodyClass}, ${r.dataKind}, ${r.dataUrl}, ${sql.json(r.mapping)},
          ${sql.json(r.group as unknown as Parameters<typeof sql.json>[0])}, ${thumbnail ?? null})
        RETURNING id`
      return { ok: true, data: { id: rows[0].id } }
    } catch (err) {
      return dbError(err)
    }
  })

export const renameRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: { id: string; name: string }) => input)
  .handler(async ({ data }): Promise<Result<null>> => {
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      await sql`
        UPDATE recipes SET name = ${data.name.trim() || 'Sin nombre'}, updated_at = now()
        WHERE id = ${data.id}`
      return { ok: true, data: null }
    } catch (err) {
      return dbError(err)
    }
  })

export const duplicateRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<Result<{ id: string }>> => {
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const rows = await sql`
        INSERT INTO recipes (name, template_url, editor_html, editor_css, editor_title,
          editor_body_class, data_kind, data_url, mapping, group_config, thumbnail)
        SELECT name || ' (copia)', template_url, editor_html, editor_css, editor_title,
          editor_body_class, data_kind, data_url, mapping, group_config, thumbnail
        FROM recipes WHERE id = ${data.id}
        RETURNING id`
      if (!rows[0]) return { ok: false, error: 'Esa plantilla ya no existe.' }
      return { ok: true, data: { id: rows[0].id } }
    } catch (err) {
      return dbError(err)
    }
  })

export const deleteRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }): Promise<Result<null>> => {
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      await sql`DELETE FROM recipes WHERE id = ${data.id}`
      return { ok: true, data: null }
    } catch (err) {
      return dbError(err)
    }
  })
