import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import type { GoogleStatus } from './googleClient'
import { requireRecord, requireString } from './validate'

export type { GoogleStatus }

/**
 * Server functions for the Google OAuth flow — which IS the app's login: the
 * exchange creates/updates the user (per-user refresh token) and opens the
 * session. The heavy lifting lives in googleClient.ts / session.ts, imported
 * dynamically inside each handler so the client bundle never sees them.
 */

function asResultError(err: unknown, fallback: string): { ok: false; error: string; hint?: string } {
  const e = err as { message?: string; hint?: string }
  return { ok: false, error: e?.message || fallback, hint: e?.hint }
}

/** The session user's Drive permissions, for the top bar and generate dialog. */
export const googleStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<Result<GoogleStatus>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const g = await import('./googleClient')
      const status = await g.getStatusForUser(user.id)
      return { ok: true, data: { ...status, email: user.email } }
    } catch (err) {
      return asResultError(err, 'No se pudo comprobar la conexión con Google.')
    }
  },
)

/** URL of Google's consent screen the browser must navigate to. Unauthenticated
 * on purpose: it is the login door (also used to re-consent Drive scopes). */
export const googleAuthUrlFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    origin: requireString(requireRecord(input, 'petición').origin, 'origin'),
  }))
  .handler(async ({ data }): Promise<Result<{ url: string }>> => {
    try {
      const g = await import('./googleClient')
      return { ok: true, data: { url: g.buildAuthUrl(data.origin) } }
    } catch (err) {
      return asResultError(err, 'No se pudo iniciar la entrada con Google.')
    }
  })

/** Credentials the Google Picker needs in the browser, fetched ON DEMAND each
 * time the picker opens: the user's own short-lived access token (~1h; kept in
 * memory only, never persisted client-side) plus the browser API key. */
export const pickerConfigFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<Result<{ accessToken: string; apiKey: string }>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    try {
      const g = await import('./googleClient')
      const apiKey = g.loadApiKey()
      if (!apiKey) {
        return {
          ok: false,
          error: 'Falta la clave de API de Google (GOOGLE_API_KEY).',
          hint: 'Añádela al archivo .env (mira .env.example) para poder elegir archivos de Drive.',
        }
      }
      const accessToken = await g.getAccessToken(user.id)
      return { ok: true, data: { accessToken, apiKey } }
    } catch (err) {
      return asResultError(err, 'No se pudo preparar el selector de archivos de Drive.')
    }
  },
)

/** Called by the /oauth/callback route with the code Google redirected with.
 * Completes the LOGIN: upserts the user with their fresh tokens and sets the
 * session cookie. Unauthenticated on purpose (it is how a session is born). */
export const googleExchangeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return { code: requireString(i.code, 'code'), state: requireString(i.state, 'state') }
  })
  .handler(async ({ data }): Promise<Result<{ email: string }>> => {
    try {
      const g = await import('./googleClient')
      const tokens = await g.exchangeCode(data.code, data.state)
      const { upsertUserOnLogin } = await import('./usersDb')
      const { id } = await upsertUserOnLogin(tokens.email, tokens)
      const s = await import('./session')
      await s.createSession(id)
      return { ok: true, data: { email: tokens.email } }
    } catch (err) {
      return asResultError(err, 'No se pudo completar la entrada con Google.')
    }
  })
