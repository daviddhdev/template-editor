import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import { requireRecord, requireString, requireUuid } from './validate'

const MAX_FIELDS = 500
const MAX_VALUE = 100_000

function dbError(err: unknown): { ok: false; error: string; hint?: string } {
  const e = err as { message?: string; hint?: string; code?: string }
  if (typeof e?.code === 'string' && (e.code.startsWith('ECONN') || e.code === 'CONNECT_TIMEOUT')) {
    return { ok: false, error: 'No se pudo conectar con la base de datos.', hint: 'Arráncala con «docker compose up -d» y vuelve a intentarlo.' }
  }
  return { ok: false, error: e?.message || 'La base de datos devolvió un error.', hint: e?.hint }
}

function validValues(v: unknown): Record<string, string> {
  const record = requireRecord(v, 'values')
  const out: Record<string, string> = {}
  const entries = Object.entries(record)
  if (entries.length > MAX_FIELDS) throw new Error('El formulario tiene demasiados campos.')
  for (const [key, value] of entries) {
    if (!/^[^\u0000]{1,500}$/.test(key)) throw new Error('Nombre de campo no válido.')
    const text = requireString(value, `values.${key}`)
    if (text.length > MAX_VALUE) throw new Error('Un valor del formulario es demasiado largo.')
    out[key] = text
  }
  return out
}

export const getManualFormDraftFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ recipeId: requireUuid(requireRecord(input, 'petición').recipeId, 'recipeId') }))
  .handler(async ({ data }): Promise<Result<Record<string, string> | null>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      const rows = await sql`SELECT payload FROM manual_form_drafts WHERE owner_id = ${user.id} AND recipe_id = ${data.recipeId}`
      return { ok: true, data: rows[0] ? (rows[0].payload as Record<string, string>) : null }
    } catch (err) { return dbError(err) }
  })

export const saveManualFormDraftFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return { recipeId: requireUuid(i.recipeId, 'recipeId'), values: validValues(i.values) }
  })
  .handler(async ({ data }): Promise<Result<null>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      await sql`INSERT INTO manual_form_drafts (owner_id, recipe_id, payload, updated_at)
        VALUES (${user.id}, ${data.recipeId}, ${sql.json(data.values)}, now())
        ON CONFLICT (owner_id, recipe_id) DO UPDATE SET payload = EXCLUDED.payload, updated_at = now()`
      return { ok: true, data: null }
    } catch (err) { return dbError(err) }
  })

export const clearManualFormDraftFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({ recipeId: requireUuid(requireRecord(input, 'petición').recipeId, 'recipeId') }))
  .handler(async ({ data }): Promise<Result<null>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const { getSql } = await import('./db')
      const sql = await getSql()
      await sql`DELETE FROM manual_form_drafts WHERE owner_id = ${user.id} AND recipe_id = ${data.recipeId}`
      return { ok: true, data: null }
    } catch (err) { return dbError(err) }
  })
