import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import type { ApiSourceConfig, DataSourceKind, Recipe } from '../types'
import {
  optionalApiConfig,
  optionalString,
  requireInt,
  requireOneOf,
  requireRecord,
  requireString,
  requireUuid,
} from './validate'

/** Durable, owner-scoped template library and immutable version history. */

export interface RecipeSummary {
  id: string
  name: string
  updatedAt: string
  currentVersion: number
  thumbnail: string | null
}

export interface RecipeVersionSummary {
  version: number
  createdAt: string
  restoredFromVersion: number | null
  isCurrent: boolean
}

function dbError(err: unknown): { ok: false; error: string; hint?: string } {
  const e = err as { message?: string; hint?: string; code?: string }
  if (typeof e?.code === 'string' && (e.code.startsWith('ECONN') || e.code === 'CONNECT_TIMEOUT')) {
    return {
      ok: false,
      error: 'No se pudo conectar con la base de datos.',
      hint: 'Arranca Postgres con «docker compose up -d» y vuelve a intentarlo.',
    }
  }
  return { ok: false, error: e?.message || 'La base de datos devolvio un error.', hint: e?.hint }
}

/** Payload to save: a Recipe minus DB-managed identity/version fields. */
export type RecipeInput = Omit<Recipe, 'id' | 'savedAt' | 'currentVersion'>

interface StoredApiConfig {
  authUrl: string
  authBodyEnc: string
  tokenPath: string
  dataUrl: string
  recordsPath: string
  columns: string[]
}

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

/** Encrypted API login body used by data fetching when the client is redacted. */
export async function storedAuthBodyEnc(
  sql: import('postgres').Sql,
  recipeId: string,
  ownerId: string,
): Promise<string> {
  const rows = await sql`SELECT api_config FROM recipes WHERE id = ${recipeId} AND owner_id = ${ownerId}`
  const raw = rows[0]?.api_config as Partial<StoredApiConfig> | null | undefined
  return raw?.authBodyEnc ?? ''
}

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
    ruleBindings: (r.ruleBindings === undefined ? undefined : requireRecord(r.ruleBindings, 'ruleBindings')) as RecipeInput['ruleBindings'],
    tagFormats: (r.tagFormats === undefined ? undefined : requireRecord(r.tagFormats, 'tagFormats')) as RecipeInput['tagFormats'],
    group: requireRecord(r.group, 'group') as unknown as RecipeInput['group'],
    sourceFile: (r.sourceFile === undefined || r.sourceFile === null ? undefined : requireRecord(r.sourceFile, 'sourceFile')) as RecipeInput['sourceFile'],
    outputFolderUrl: optionalString(r.outputFolderUrl, 'outputFolderUrl'),
  }
}

function validId(v: unknown): string {
  return requireUuid(v, 'id')
}

async function renderThumbnail(input: RecipeInput): Promise<Uint8Array | null> {
  try {
    const { acquireBrowser, releaseBrowser } = await import('./browserPool')
    const { escapeHtml } = await import('../lib/html')
    const bodyClass = input.editorBodyClass ? ` class="${escapeHtml(input.editorBodyClass)}"` : ''
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${input.editorCss}</style><style>html{zoom:0.4;background:#fff;}body{margin:0 auto;}</style></head><body${bodyClass}>${input.editorHtml}</body></html>`
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

const summarize = (r: { id: string; name: string; updated_at: Date; current_version: number; thumbnail: Uint8Array | null }): RecipeSummary => ({
  id: r.id,
  name: r.name,
  updatedAt: r.updated_at.toISOString(),
  currentVersion: Number(r.current_version ?? 1),
  thumbnail: r.thumbnail ? Buffer.from(r.thumbnail).toString('base64') : null,
})

function recipeFromRow(r: Record<string, any>): Recipe {
  return {
    id: r.id,
    name: r.name,
    savedAt: (r.updated_at as Date).toISOString(),
    currentVersion: Number(r.current_version ?? 1),
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
  }
}

export const listRecipesFn = createServerFn({ method: 'GET' }).handler(async (): Promise<Result<RecipeSummary[]>> => {
  const s = await import('./session')
  const user = await s.requireUser()
  if (!user) return s.AUTH_ERROR
  try {
    const { getSql } = await import('./db')
    const sql = await getSql()
    const rows = await sql`SELECT id, name, updated_at, current_version, thumbnail FROM recipes WHERE owner_id = ${user.id} ORDER BY updated_at DESC`
    return { ok: true, data: rows.map((r) => summarize(r as Parameters<typeof summarize>[0])) }
  } catch (err) {
    return dbError(err)
  }
})

export const getRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ id: validId(requireRecord(input, 'peticion').id) }))
  .handler(async ({ data }): Promise<Result<Recipe>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const rows = await sql`SELECT * FROM recipes WHERE id = ${data.id} AND owner_id = ${user.id}`
      if (!rows[0]) return { ok: false, error: 'Esa plantilla ya no existe.' }
      return { ok: true, data: recipeFromRow(rows[0]) }
    } catch (err) {
      return dbError(err)
    }
  })

export const listRecipeVersionsFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ id: validId(requireRecord(input, 'peticion').id) }))
  .handler(async ({ data }): Promise<Result<RecipeVersionSummary[]>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const rows = await sql`SELECT v.version, v.created_at, v.restored_from_version, r.current_version FROM recipe_versions v JOIN recipes r ON r.id = v.recipe_id WHERE v.recipe_id = ${data.id} AND r.owner_id = ${user.id} ORDER BY v.version DESC`
      if (!rows[0]) {
        const exists = await sql`SELECT 1 FROM recipes WHERE id = ${data.id} AND owner_id = ${user.id}`
        if (!exists[0]) return { ok: false, error: 'Esa plantilla ya no existe.' }
      }
      return {
        ok: true,
        data: rows.map((r) => ({
          version: Number(r.version),
          createdAt: (r.created_at as Date).toISOString(),
          restoredFromVersion: r.restored_from_version == null ? null : Number(r.restored_from_version),
          isCurrent: Number(r.version) === Number(r.current_version),
        })),
      }
    } catch (err) {
      return dbError(err)
    }
  })

export const saveRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'peticion')
    return {
      recipe: validRecipe(i.recipe),
      sourceRecipeId: i.sourceRecipeId === undefined ? undefined : validId(i.sourceRecipeId),
    }
  })
  .handler(async ({ data }): Promise<Result<{ id: string; version: number }>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const r = data.recipe
      const thumbnail = await renderThumbnail(r)
      const { encryptSecret } = await import('./crypto')
      const prevEnc = r.apiConfig && !r.apiConfig.authBody && data.sourceRecipeId
        ? await storedAuthBodyEnc(sql, data.sourceRecipeId, user.id)
        : ''
      const apiConfig = toStoredApiConfig(r.apiConfig, prevEnc, encryptSecret)
      const rows = await sql.begin(async (tx) => {
        const inserted = await tx`INSERT INTO recipes (owner_id, name, template_url, editor_html, editor_css, editor_title, editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings, tag_formats, source_file, output_folder_url, thumbnail, current_version) VALUES (${user.id}, ${r.name}, ${r.templateUrl}, ${r.editorHtml}, ${r.editorCss}, ${r.editorTitle}, ${r.editorBodyClass}, ${r.dataKind}, ${r.dataUrl}, ${apiConfig ? tx.json(apiConfig as unknown as Parameters<typeof tx.json>[0]) : null}, ${tx.json(r.mapping)}, ${tx.json(r.group as unknown as Parameters<typeof tx.json>[0])}, ${tx.json((r.ruleBindings ?? {}) as unknown as Parameters<typeof tx.json>[0])}, ${tx.json((r.tagFormats ?? {}) as unknown as Parameters<typeof tx.json>[0])}, ${r.sourceFile ? tx.json(r.sourceFile as unknown as Parameters<typeof tx.json>[0]) : null}, ${r.outputFolderUrl ?? ''}, ${thumbnail ?? null}, 1) RETURNING id`
        await tx`INSERT INTO recipe_versions (recipe_id, version, template_url, editor_html, editor_css, editor_title, editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings, tag_formats, source_file, output_folder_url, thumbnail) SELECT id, 1, template_url, editor_html, editor_css, editor_title, editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings, tag_formats, source_file, output_folder_url, thumbnail FROM recipes WHERE id = ${inserted[0].id} AND owner_id = ${user.id}`
        return inserted
      })
      return { ok: true, data: { id: (rows[0] as { id: string }).id, version: 1 } }
    } catch (err) {
      return dbError(err)
    }
  })

export const updateRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'peticion')
    return { id: validId(i.id), recipe: validRecipe(i.recipe) }
  })
  .handler(async ({ data }): Promise<Result<{ version: number }>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const r = data.recipe
      const thumbnail = await renderThumbnail(r)
      const { encryptSecret } = await import('./crypto')
      const rows = await sql.begin(async (tx) => {
        const current = await tx`SELECT current_version, api_config FROM recipes WHERE id = ${data.id} AND owner_id = ${user.id} FOR UPDATE`
        if (!current[0]) return []
        const prevEnc = r.apiConfig && !r.apiConfig.authBody ? ((current[0].api_config as Partial<StoredApiConfig> | null)?.authBodyEnc ?? '') : ''
        const apiConfig = toStoredApiConfig(r.apiConfig, prevEnc, encryptSecret)
        const version = Number(current[0].current_version) + 1
        const updated = await tx`UPDATE recipes SET name = ${r.name}, template_url = ${r.templateUrl}, editor_html = ${r.editorHtml}, editor_css = ${r.editorCss}, editor_title = ${r.editorTitle}, editor_body_class = ${r.editorBodyClass}, data_kind = ${r.dataKind}, data_url = ${r.dataUrl}, api_config = ${apiConfig ? tx.json(apiConfig as unknown as Parameters<typeof tx.json>[0]) : null}, mapping = ${tx.json(r.mapping)}, group_config = ${tx.json(r.group as unknown as Parameters<typeof tx.json>[0])}, rule_bindings = ${tx.json((r.ruleBindings ?? {}) as unknown as Parameters<typeof tx.json>[0])}, tag_formats = ${tx.json((r.tagFormats ?? {}) as unknown as Parameters<typeof tx.json>[0])}, source_file = ${r.sourceFile ? tx.json(r.sourceFile as unknown as Parameters<typeof tx.json>[0]) : null}, output_folder_url = ${r.outputFolderUrl ?? ''}, thumbnail = ${thumbnail ?? null}, current_version = ${version}, updated_at = now() WHERE id = ${data.id} AND owner_id = ${user.id} RETURNING id`
        await tx`INSERT INTO recipe_versions (recipe_id, version, template_url, editor_html, editor_css, editor_title, editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings, tag_formats, source_file, output_folder_url, thumbnail) SELECT id, ${version}, template_url, editor_html, editor_css, editor_title, editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings, tag_formats, source_file, output_folder_url, thumbnail FROM recipes WHERE id = ${data.id} AND owner_id = ${user.id}`
        return updated.length ? [{ version }] : []
      })
      if (!rows[0]) return { ok: false, error: 'Esa plantilla ya no existe en la biblioteca.', hint: 'Usa «Guardar como nueva» para volver a crearla.' }
      return { ok: true, data: rows[0] as { version: number } }
    } catch (err) {
      return dbError(err)
    }
  })

export const restoreRecipeVersionFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'peticion')
    const version = requireInt(i.version, 'version')
    if (version < 1) throw new Error('Peticion invalida: «version» debe ser mayor que cero.')
    return { id: validId(i.id), version }
  })
  .handler(async ({ data }): Promise<Result<Recipe>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const rows = await sql.begin(async (tx) => {
        const current = await tx`SELECT id, current_version FROM recipes WHERE id = ${data.id} AND owner_id = ${user.id} FOR UPDATE`
        if (!current[0]) return []
        const source = await tx`SELECT * FROM recipe_versions WHERE recipe_id = ${data.id} AND version = ${data.version}`
        if (!source[0]) return []
        const next = Number(current[0].current_version) + 1
        const restored = await tx`UPDATE recipes SET
          template_url = ${source[0].template_url}, editor_html = ${source[0].editor_html},
          editor_css = ${source[0].editor_css}, editor_title = ${source[0].editor_title},
          editor_body_class = ${source[0].editor_body_class}, data_kind = ${source[0].data_kind},
          data_url = ${source[0].data_url},
          api_config = ${source[0].api_config ? tx.json(source[0].api_config as unknown as Parameters<typeof tx.json>[0]) : null},
          mapping = ${tx.json(source[0].mapping)},
          group_config = ${tx.json(source[0].group_config)},
          rule_bindings = ${tx.json(source[0].rule_bindings)},
          tag_formats = ${tx.json(source[0].tag_formats)},
          source_file = ${source[0].source_file ? tx.json(source[0].source_file as unknown as Parameters<typeof tx.json>[0]) : null},
          output_folder_url = ${source[0].output_folder_url}, thumbnail = ${source[0].thumbnail},
          current_version = ${next}, updated_at = now()
          WHERE id = ${data.id} AND owner_id = ${user.id} RETURNING *`
        await tx`INSERT INTO recipe_versions (recipe_id, version, restored_from_version, template_url, editor_html, editor_css, editor_title, editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings, tag_formats, source_file, output_folder_url, thumbnail) SELECT id, ${next}, ${data.version}, template_url, editor_html, editor_css, editor_title, editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings, tag_formats, source_file, output_folder_url, thumbnail FROM recipes WHERE id = ${data.id} AND owner_id = ${user.id}`
        return restored
      })
      if (!rows[0]) return { ok: false, error: 'La plantilla o la version ya no existe.' }
      return { ok: true, data: recipeFromRow(rows[0]) }
    } catch (err) {
      return dbError(err)
    }
  })

export const renameRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'peticion')
    return { id: validId(i.id), name: requireString(i.name, 'name') }
  })
  .handler(async ({ data }): Promise<Result<null>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      await sql`UPDATE recipes SET name = ${data.name.trim() || 'Sin nombre'}, updated_at = now() WHERE id = ${data.id} AND owner_id = ${user.id}`
      return { ok: true, data: null }
    } catch (err) {
      return dbError(err)
    }
  })

export const duplicateRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ id: validId(requireRecord(input, 'peticion').id) }))
  .handler(async ({ data }): Promise<Result<{ id: string; version: number }>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const rows = await sql.begin(async (tx) => {
        const inserted = await tx`INSERT INTO recipes (owner_id, name, template_url, editor_html, editor_css, editor_title, editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings, tag_formats, source_file, output_folder_url, thumbnail, current_version) SELECT owner_id, name || ' (copia)', template_url, editor_html, editor_css, editor_title, editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings, tag_formats, source_file, output_folder_url, thumbnail, 1 FROM recipes WHERE id = ${data.id} AND owner_id = ${user.id} RETURNING id`
        if (!inserted[0]) return []
        await tx`INSERT INTO recipe_versions (recipe_id, version, template_url, editor_html, editor_css, editor_title, editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings, tag_formats, source_file, output_folder_url, thumbnail) SELECT id, 1, template_url, editor_html, editor_css, editor_title, editor_body_class, data_kind, data_url, api_config, mapping, group_config, rule_bindings, tag_formats, source_file, output_folder_url, thumbnail FROM recipes WHERE id = ${inserted[0].id} AND owner_id = ${user.id}`
        return inserted
      })
      if (!rows[0]) return { ok: false, error: 'Esa plantilla ya no existe.' }
      return { ok: true, data: { id: (rows[0] as { id: string }).id, version: 1 } }
    } catch (err) {
      return dbError(err)
    }
  })

export const deleteRecipeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ id: validId(requireRecord(input, 'peticion').id) }))
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
