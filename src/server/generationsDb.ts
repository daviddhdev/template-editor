import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import { countDocs, type GenerationDoc } from '../lib/generationLog'
import {
  optionalFormats,
  optionalString,
  requireArray,
  requireInt,
  requireOneOf,
  requireRecord,
  requireString,
  requireUuid,
} from './validate'

/**
 * Generation audit log (generation_runs): one row per batch, recorded in two
 * steps — INSERT when the batch starts (status 'running') and an idempotent
 * finalising UPDATE when it ends. A row left 'running' without finished_at is
 * evidence of an interrupted batch. Retries re-finalise the same row.
 * Append-only by design (legal audit trail): rows are never deleted, and
 * recipe_id keeps the literal id even after the template is gone.
 */

export type GenerationRoute = 'native' | 'google_html' | 'local'

export interface GenerationRunSummary {
  id: string
  startedAt: string
  finishedAt: string | null
  status: 'running' | 'done'
  recipeId: string | null
  templateName: string
  route: GenerationRoute
  dataKind: string
  dataUrl: string
  rowCount: number
  formats: string[]
  actorEmail: string | null
  driveFolderUrl: string | null
  docCount: number
  okCount: number
  errorCount: number
  docs: GenerationDoc[]
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

function validDocs(v: unknown, what: string): GenerationDoc[] {
  return requireArray(v, what).map((d, i) => {
    const doc = requireRecord(d, `${what}[${i}]`)
    const out: GenerationDoc = {
      name: requireString(doc.name, `${what}[${i}].name`),
      status: requireOneOf(doc.status, ['ok', 'error', 'pending'] as const, `${what}[${i}].status`),
    }
    if (doc.viaHtml === true) out.viaHtml = true
    if (doc.uploaded !== undefined && doc.uploaded !== null) {
      out.uploaded = requireOneOf(doc.uploaded, ['done', 'error'] as const, `${what}[${i}].uploaded`)
    }
    return out
  })
}

/** Open the audit row for a starting batch. */
export const startGenerationFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return {
      recipeId:
        i.recipeId === undefined || i.recipeId === null ? null : requireUuid(i.recipeId, 'recipeId'),
      templateName: requireString(i.templateName, 'templateName'),
      route: requireOneOf(i.route, ['native', 'google_html', 'local'] as const, 'route'),
      dataKind: requireOneOf(i.dataKind, ['google_sheet', 'api_endpoint'] as const, 'dataKind'),
      dataUrl: requireString(i.dataUrl, 'dataUrl'),
      rowCount: requireInt(i.rowCount, 'rowCount'),
      formats: optionalFormats(i.formats) ?? ['pdf'],
      actorEmail: optionalString(i.actorEmail ?? undefined, 'actorEmail') ?? null,
      docNames: requireArray(i.docNames, 'docNames').map((n, k) =>
        requireString(n, `docNames[${k}]`),
      ),
    }
  })
  .handler(async ({ data }): Promise<Result<{ id: string }>> => {
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const docs: GenerationDoc[] = data.docNames.map((name) => ({ name, status: 'pending' }))
      const rows = await sql`
        INSERT INTO generation_runs (recipe_id, template_name, route, data_kind, data_url,
          row_count, formats, actor_email, doc_count, docs)
        VALUES (${data.recipeId}, ${data.templateName}, ${data.route}, ${data.dataKind},
          ${data.dataUrl}, ${data.rowCount}, ${data.formats}, ${data.actorEmail},
          ${data.docNames.length}, ${sql.json(docs as unknown as Parameters<typeof sql.json>[0])})
        RETURNING id`
      return { ok: true, data: { id: rows[0].id } }
    } catch (err) {
      return dbError(err)
    }
  })

/** Finalise (or re-finalise after a retry) the audit row. Idempotent: it
 * rewrites docs and counters wholesale, so calling it again after retries
 * simply brings the row up to date. Counters derive from docs server-side. */
export const finishGenerationFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return {
      id: requireUuid(i.id, 'id'),
      docs: validDocs(i.docs, 'docs'),
      driveFolderUrl:
        i.driveFolderUrl === undefined || i.driveFolderUrl === null
          ? null
          : requireString(i.driveFolderUrl, 'driveFolderUrl'),
    }
  })
  .handler(async ({ data }): Promise<Result<null>> => {
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const counts = countDocs(data.docs)
      await sql`
        UPDATE generation_runs SET
          docs = ${sql.json(data.docs as unknown as Parameters<typeof sql.json>[0])},
          ok_count = ${counts.ok}, error_count = ${counts.error},
          drive_folder_url = COALESCE(${data.driveFolderUrl}, drive_folder_url),
          finished_at = now(), status = 'done'
        WHERE id = ${data.id}`
      return { ok: true, data: null }
    } catch (err) {
      return dbError(err)
    }
  })

/** Newest batches first, for the home-screen history section. */
export const listGenerationsFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<GenerationRunSummary[]>> => {
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      // No pagination yet (LIMIT 50). If this ever grows: paginate — this is
      // an audit trail, rows are never purged.
      const rows = await sql`
        SELECT * FROM generation_runs ORDER BY started_at DESC LIMIT 50`
      return {
        ok: true,
        data: rows.map((r) => ({
          id: r.id,
          startedAt: (r.started_at as Date).toISOString(),
          finishedAt: r.finished_at ? (r.finished_at as Date).toISOString() : null,
          status: r.status,
          recipeId: r.recipe_id ?? null,
          templateName: r.template_name,
          route: r.route,
          dataKind: r.data_kind,
          dataUrl: r.data_url,
          rowCount: r.row_count,
          formats: r.formats ?? ['pdf'],
          actorEmail: r.actor_email ?? null,
          driveFolderUrl: r.drive_folder_url ?? null,
          docCount: r.doc_count,
          okCount: r.ok_count,
          errorCount: r.error_count,
          docs: r.docs ?? [],
        })),
      }
    } catch (err) {
      return dbError(err)
    }
  },
)
