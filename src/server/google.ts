import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import type { GoogleStatus } from './googleClient'
import { requireRecord, requireString } from './validate'

export type { GoogleStatus }

/**
 * Server functions for the Google connection (OAuth). The heavy lifting lives
 * in googleClient.ts, imported dynamically inside each handler so the client
 * bundle never sees node:fs / credentials handling.
 */

function asResultError(err: unknown, fallback: string): { ok: false; error: string; hint?: string } {
  const e = err as { message?: string; hint?: string }
  return { ok: false, error: e?.message || fallback, hint: e?.hint }
}

/** Connection status shown in the top bar and the generate dialog. */
export const googleStatusFn = createServerFn({ method: 'GET' }).handler(
  async (): Promise<GoogleStatus> => {
    const g = await import('./googleClient')
    return g.getStatus()
  },
)

/** URL of Google's consent screen the browser must navigate to. */
export const googleAuthUrlFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => ({
    origin: requireString(requireRecord(input, 'petición').origin, 'origin'),
  }))
  .handler(async ({ data }): Promise<Result<{ url: string }>> => {
    try {
      const g = await import('./googleClient')
      return { ok: true, data: { url: g.buildAuthUrl(data.origin) } }
    } catch (err) {
      return asResultError(err, 'No se pudo iniciar la conexión con Google.')
    }
  })

/** Called by the /oauth/callback route with the code Google redirected with. */
export const googleExchangeFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return { code: requireString(i.code, 'code'), state: requireString(i.state, 'state') }
  })
  .handler(async ({ data }): Promise<Result<{ email: string | null }>> => {
    try {
      const g = await import('./googleClient')
      return { ok: true, data: await g.exchangeCode(data.code, data.state) }
    } catch (err) {
      return asResultError(err, 'No se pudo completar la conexión con Google.')
    }
  })

/** Forget (and revoke) the stored Google connection. */
export const googleDisconnectFn = createServerFn({ method: 'POST' }).handler(
  async (): Promise<Result<null>> => {
    try {
      const g = await import('./googleClient')
      await g.disconnect()
      return { ok: true, data: null }
    } catch (err) {
      return asResultError(err, 'No se pudo desconectar la cuenta de Google.')
    }
  },
)
