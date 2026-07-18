import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import type { ApiSourceConfig, DataSourceKind, Recipe } from '../types'
import {
  optionalApiConfig,
  optionalString,
  requireOneOf,
  requireRecord,
  requireString,
  requireUuid,
} from './validate'

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
 * DB shape of the `api_config` column: identical to {@link ApiSourceConfig}
 * except the login body is stored ENCRYPTED (`authBodyEnc`) and never in the
 * clear — and never sent back to the client (see {@link fromStoredApiConfig}).
 */
interface StoredApiConfig {
  authUrl: string
  authBodyEnc: string
  tokenPath: string
  dataUrl: string
  recordsPath: string
  columns: string[]
}

/** Client config → stored shape, encrypting the login body. An empty incoming
 * `authBody` (redacted on read) keeps the previously stored secret `prevEnc`.
 * `encrypt` is passed in so crypto (node-only) stays a dynamic server import. */
function toStoredApiConfig(
  cfg: ApiSourceConfig | undefined,
  prevEnc: string,
  encrypt: (plain: string) => string,
): StoredApiConfig | null {
  if (!cfg) return null
  return {
    authUrl: cfg.authUrl,
    authBodyEnc: cfg.authBody ? encrypt(cfg.authBody) : prevEnc,
    tokenPath: cfg.tokenPath,
    dataUrl: cfg.dataUrl,
    recordsPath: cfg.recordsPath,
    columns: cfg.columns,
  }
}

/** Stored shape → client config, with the credentials REDACTED (never leave
 * the server); `authBodyStored` tells the UI a secret exists in the DB. */
function fromStoredApiConfig(raw: unknown): ApiSourceConfig | undefined {
  if (raw == null || typeof raw !== 'object') return undefined
  const s = raw as Partial<StoredApiConfig>
  return {
    authUrl: s.authUrl ?? '',
    authBody: '',
    authBodyStored: Boolean(s.authBodyEnc),
    tokenPath: s.tokenPath ?? '',
    dataUrl: s.dataUrl ?? '',
    recordsPath: s.recordsPath ?? '',
    columns: s.columns ?? [],
  }
}

/** The encrypted login body stored for a recipe, or '' — used when updating
 * with redacted credentials and when a data fetch reads a saved recipe. */
export async function storedAuthBodyEnc(
  sql: import('postgres').Sql,
  recipeId: string,
  ownerId: string,
): Promise<string> {
  const rows = await sql`SELECT api_config FROM recipes WHERE id = ${recipeId} AND owner_id = ${ownerId}`
  const raw = rows[0]?.api_config as Partial<StoredApiConfig> | null | undefined
  return raw?.authBodyEnc ?? ''
}

/** Validate the essentials of a recipe payload; JSON columns pass through. */
function validRecipe(v: unknown): RecipeInput {
  const r = requireRecord(v, 'recipe')
  return {
    name: requireString(r.name, 'name'),
    templateUrl: requireString(r.templateUrl, 'templateUrl'),
    editorHtml: requireString(r.editorHtml, 'editorHtml'),
    editorCss: requireString(r.editorCss, 'editorCss'),
    editorTitle: requireString(r.editorTitle, 'editorTitle'),
    editorBodyClass: requireString(r.editorBodyClass, 'editorBodyClass'),
    dataKind: requireOneOf<DataSourceKind>(r.dataKind, ['google_sheet', 'api_endpoint'], 'dataKind'),
    dataUrl: requireString(r.dataUrl, 'dataUrl'),
    apiConfig: optionalApiConfig(r.apiConfig),
    mapping: requireRecord(r.mapping, 'mapping') as RecipeInput['mapping'],
    ruleBindings: (r.ruleBindings === undefined
      ? undefined
      : requireRecord(r.ruleBindings, 'ruleBindings')) as RecipeInput['ruleBindings'],
    tagFormats: (r.tagFormats === undefined
      ? undefined
      : requireRecord(r.tagFormats, 'tagFormats')) as RecipeInput['tagFormats'],
    group: requireRecord(r.group, 'group') as unknown as RecipeInput['group'],
    sourceFile: (r.sourceFile === undefined || r.sourceFile === null
      ? undefined
      : requireRecord(r.sourceFile, 'sourceFile')) as RecipeInput['sourceFile'],
    outputFolderUrl: optionalString(r.outputFolderUrl, 'outputFolderUrl'),
  }
}

/** UUID shape — a malformed id is a bad request, not a DB round-trip. */
function validId(v: unknown): string {
  return requireUuid(v, 'id')
}

/**
 * Render a small PNG of the template's first page for the home grid.
 * Best-effort: a save never fails because the thumbnail did.
 * Uses the shared Chromium pool from pdf.ts — launching a fresh browser
 * added ~1s to every save.
 */
async function renderThumbnail(input: RecipeInput): Promise<Uint8Array | null> {
  try {
    const { acquireBrowser, releaseBrowser } = await import('./browserPool')
    const { escapeHtml } = await import('../lib/html')
    const bodyClass = input.editorBodyClass
      ? ` class="${escapeHtml(input.editorBodyClass)}"`
      : ''
    const html = `<!doctype html><html><head><meta charset="utf-8">
<style>${input.editorCss}</style>
<style>html{zoom:0.4;background:#fff;}body{margin:0 auto;}</style>
</head><body${bodyClass}>${input.editorHtml}</body></html>`
    const browser = await acquireBrowser()
    try {
      const page = await browser.newPage({ viewport: { width: 330, height: 460 } })
      try {
        await page.setContent(html, { waitUntil: 'load', timeout: 10000 }).catch(() => {})
        return await page.screenshot({ type: 'png' })
      } finally {
        await page.close().catch(() => {})
      }
    } finally {
      releaseBrowser()
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

/** The user's library, newest first (for the home grid). */
export const listRecipesFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<RecipeSummary[]>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const rows = await sql`
        SELECT id, name, updated_at, thumbnail FROM recipes
        WHERE owner_id = ${user.id} ORDER BY updated_at DESC`
      return { ok: true, data: rows.map((r) => summarize(r as Parameters<typeof summarize>[0])) }
    } catch (err) {
      return dbError(err)
    }
  },
)

export const getRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ id: validId(requireRecord(input, 'petición').id) }))
  .handler(async ({ data }): Promise<Result<Recipe>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      // owner check inside the WHERE: someone else's id looks identical to a
      // deleted one (no existence leak).
      const rows = await sql`SELECT * FROM recipes WHERE id = ${data.id} AND owner_id = ${user.id}`
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
          apiConfig: fromStoredApiConfig(r.api_config),
          mapping: r.mapping,
          ruleBindings: r.rule_bindings ?? {},
          tagFormats: r.tag_formats ?? {},
          group: r.group_config,
          sourceFile: r.source_file ?? undefined,
          outputFolderUrl: r.output_folder_url ?? '',
        },
      }
    } catch (err) {
      return dbError(err)
    }
  })

/** Save the current workspace as a new template (thumbnail included). */
export const saveRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ recipe: validRecipe(requireRecord(input, 'petición').recipe) }))
  .handler(async ({ data }): Promise<Result<{ id: string }>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const r = data.recipe
      const thumbnail = await renderThumbnail(r)
      // New recipe: no previous secret to preserve.
      const { encryptSecret } = await import('./crypto')
      const apiConfig = toStoredApiConfig(r.apiConfig, '', encryptSecret)
      const rows = await sql`
        INSERT INTO recipes (owner_id, name, template_url, editor_html, editor_css, editor_title,
          editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings,
          tag_formats, source_file, output_folder_url, thumbnail)
        VALUES (${user.id}, ${r.name}, ${r.templateUrl}, ${r.editorHtml}, ${r.editorCss}, ${r.editorTitle},
          ${r.editorBodyClass}, ${r.dataKind}, ${r.dataUrl},
          ${apiConfig ? sql.json(apiConfig as unknown as Parameters<typeof sql.json>[0]) : null},
          ${sql.json(r.mapping)},
          ${sql.json(r.group as unknown as Parameters<typeof sql.json>[0])},
          ${sql.json((r.ruleBindings ?? {}) as unknown as Parameters<typeof sql.json>[0])},
          ${sql.json((r.tagFormats ?? {}) as unknown as Parameters<typeof sql.json>[0])},
          ${r.sourceFile ? sql.json(r.sourceFile as unknown as Parameters<typeof sql.json>[0]) : null},
          ${r.outputFolderUrl ?? ''}, ${thumbnail ?? null})
        RETURNING id`
      return { ok: true, data: { id: rows[0].id } }
    } catch (err) {
      return dbError(err)
    }
  })

/** Overwrite an existing template with the current workspace (fresh thumbnail). */
export const updateRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return { id: validId(i.id), recipe: validRecipe(i.recipe) }
  })
  .handler(async ({ data }): Promise<Result<null>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const r = data.recipe
      const thumbnail = await renderThumbnail(r)
      // Redacted credentials come back empty: keep the secret already stored.
      const prevEnc =
        r.apiConfig && !r.apiConfig.authBody ? await storedAuthBodyEnc(sql, data.id, user.id) : ''
      const { encryptSecret } = await import('./crypto')
      const apiConfig = toStoredApiConfig(r.apiConfig, prevEnc, encryptSecret)
      const rows = await sql`
        UPDATE recipes SET name = ${r.name}, template_url = ${r.templateUrl},
          editor_html = ${r.editorHtml}, editor_css = ${r.editorCss},
          editor_title = ${r.editorTitle}, editor_body_class = ${r.editorBodyClass},
          data_kind = ${r.dataKind}, data_url = ${r.dataUrl},
          api_config = ${apiConfig ? sql.json(apiConfig as unknown as Parameters<typeof sql.json>[0]) : null},
          mapping = ${sql.json(r.mapping)},
          group_config = ${sql.json(r.group as unknown as Parameters<typeof sql.json>[0])},
          rule_bindings = ${sql.json((r.ruleBindings ?? {}) as unknown as Parameters<typeof sql.json>[0])},
          tag_formats = ${sql.json((r.tagFormats ?? {}) as unknown as Parameters<typeof sql.json>[0])},
          source_file = ${r.sourceFile ? sql.json(r.sourceFile as unknown as Parameters<typeof sql.json>[0]) : null},
          output_folder_url = ${r.outputFolderUrl ?? ''},
          thumbnail = ${thumbnail ?? null},
          updated_at = now()
        WHERE id = ${data.id} AND owner_id = ${user.id}
        RETURNING id`
      if (!rows[0]) {
        return {
          ok: false,
          error: 'Esa plantilla ya no existe en la biblioteca.',
          hint: 'Usa «Guardar como nueva» para volver a crearla.',
        }
      }
      return { ok: true, data: null }
    } catch (err) {
      return dbError(err)
    }
  })

export const renameRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return { id: validId(i.id), name: requireString(i.name, 'name') }
  })
  .handler(async ({ data }): Promise<Result<null>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      await sql`
        UPDATE recipes SET name = ${data.name.trim() || 'Sin nombre'}, updated_at = now()
        WHERE id = ${data.id} AND owner_id = ${user.id}`
      return { ok: true, data: null }
    } catch (err) {
      return dbError(err)
    }
  })

export const duplicateRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ id: validId(requireRecord(input, 'petición').id) }))
  .handler(async ({ data }): Promise<Result<{ id: string }>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const rows = await sql`
        INSERT INTO recipes (owner_id, name, template_url, editor_html, editor_css, editor_title,
          editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings,
          source_file, output_folder_url, thumbnail)
        SELECT owner_id, name || ' (copia)', template_url, editor_html, editor_css, editor_title,
          editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings,
          source_file, output_folder_url, thumbnail
        FROM recipes WHERE id = ${data.id} AND owner_id = ${user.id}
        RETURNING id`
      if (!rows[0]) return { ok: false, error: 'Esa plantilla ya no existe.' }
      return { ok: true, data: { id: rows[0].id } }
    } catch (err) {
      return dbError(err)
    }
  })

export const deleteRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ id: validId(requireRecord(input, 'petición').id) }))
  .handler(async ({ data }): Promise<Result<null>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      await sql`DELETE FROM recipes WHERE id = ${data.id} AND owner_id = ${user.id}`
      return { ok: true, data: null }
    } catch (err) {
      return dbError(err)
    }
  })
