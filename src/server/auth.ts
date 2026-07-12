import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'

/**
 * Session server functions. Login itself lives in google.ts (the Google OAuth
 * exchange creates the user + session); here are the probe and the exit.
 */

function asResultError(err: unknown, fallback: string): { ok: false; error: string; hint?: string } {
  const e = err as { message?: string; hint?: string }
  return { ok: false, error: e?.message || fallback, hint: e?.hint }
}

/** Who is logged in (or null). The route guard's probe — no auth required.
 * The id keys the per-user draft mirror in the browser (draftStorage.ts). */
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

/** Revoke the current session and drop its cookie. Does NOT revoke the Google
 * refresh token: logging out must not break Drive for the next login. */
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
