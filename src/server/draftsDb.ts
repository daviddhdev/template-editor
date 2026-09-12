import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import { requireInt, requireRecord, requireString } from './validate'


export interface WorkspaceDraft {
  payload: string
  savedAtMs: number
}

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
