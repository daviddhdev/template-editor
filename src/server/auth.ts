import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'


function asResultError(err: unknown, fallback: string): { ok: false; error: string; hint?: string } {
  const e = err as { message?: string; hint?: string }
  return { ok: false, error: e?.message || fallback, hint: e?.hint }
}

export const meFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<{ id: string; email: string } | null>> => {
    try {
      const s = await import('./session')
      const user = await s.currentUser()
      return { ok: true, data: user ? { id: user.id, email: user.email } : null }
    } catch (err) {
      return asResultError(err, 'No se pudo comprobar la sesión.')
    }
  },
)

export const logoutFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<Result<null>> => {
    try {
      const s = await import('./session')
      await s.destroySession()
      return { ok: true, data: null }
    } catch (err) {
      return asResultError(err, 'No se pudo cerrar la sesión.')
    }
  },
)
