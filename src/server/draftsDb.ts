import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import { requireInt, requireRecord, requireString } from './validate'

/**
 * Workspace draft (autosave) on Postgres — one row per user, so the working
 * draft follows the account across browsers instead of living in a shared
 * localStorage. The payload is the exact JSON string zustand's persist
 * middleware produces; the server never parses it. savedAtMs is the CLIENT
 * clock at save time: the browser compares it with its local mirror on
 * hydration (newest wins — see state/draftStorage.ts).
 */

export interface WorkspaceDraft {
  payload: string
  savedAtMs: number
}

/** Hard cap so a runaway payload cannot fill the DB (inlined images can make
 * a draft big, but not THIS big). */
const MAX_PAYLOAD_BYTES = 25 * 1024 * 1024

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

/** The session user's draft, or null when they have none yet. */
export const getDraftFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<WorkspaceDraft | null>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const rows = await sql`
        SELECT payload, saved_at_ms FROM workspace_drafts WHERE user_id = ${user.id}`
      if (!rows[0]) return { ok: true, data: null }
      return {
        ok: true,
        data: { payload: rows[0].payload as string, savedAtMs: Number(rows[0].saved_at_ms) },
      }
    } catch (err) {
      return dbError(err)
    }
  },
)

/** Upsert the session user's draft (last write wins). */
export const saveDraftFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return {
      payload: requireString(i.payload, 'payload'),
      savedAtMs: requireInt(i.savedAtMs, 'savedAtMs'),
    }
  })
  .handler(async ({ data }): Promise<Result<null>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    if (data.payload.length > MAX_PAYLOAD_BYTES) {
      return {
        ok: false,
        error: 'El borrador es demasiado grande para el guardado automático.',
        hint: 'Usa «Guardar plantilla» para no perder los cambios.',
      }
    }
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      await sql`
        INSERT INTO workspace_drafts (user_id, payload, saved_at_ms, updated_at)
        VALUES (${user.id}, ${data.payload}, ${data.savedAtMs}, now())
        ON CONFLICT (user_id) DO UPDATE
        SET payload = EXCLUDED.payload, saved_at_ms = EXCLUDED.saved_at_ms, updated_at = now()`
      return { ok: true, data: null }
    } catch (err) {
      return dbError(err)
    }
  })
