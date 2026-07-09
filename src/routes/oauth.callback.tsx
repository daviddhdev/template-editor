import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { googleExchangeFn } from '../server/google'
import { ErrorNote, Spinner } from '../components/ui'

/**
 * Where Google redirects back after the consent screen. Exchanges the
 * authorization code on the server, then returns to the workspace. Using a
 * normal client route (instead of a server route) keeps the OAuth flow
 * independent of the server-route API.
 */
export const Route = createFileRoute('/oauth/callback')({
  validateSearch: (s: Record<string, unknown>) => ({
    code: typeof s.code === 'string' ? s.code : '',
    state: typeof s.state === 'string' ? s.state : '',
    error: typeof s.error === 'string' ? s.error : '',
  }),
  component: OAuthCallback,
})

function OAuthCallback() {
  const { code, state, error } = Route.useSearch()
  const navigate = useNavigate()
  const [failure, setFailure] = useState<{ error: string; hint?: string } | null>(null)
  const ran = useRef(false)

  useEffect(() => {
    if (ran.current) return
    ran.current = true

    if (error || !code) {
      setFailure({
        error:
          error === 'access_denied'
            ? 'Has cancelado la conexión con Google.'
            : 'Google no devolvió la autorización esperada.',
        hint: 'Puedes volver a intentarlo desde el botón "Conectar Google".',
      })
      return
    }

    googleExchangeFn({ data: { code, state } })
      .then((res) => {
        if (res.ok) navigate({ to: '/' })
        else setFailure(res)
      })
      .catch(() => setFailure({ error: 'No se pudo completar la conexión con Google.' }))
  }, [code, state, error, navigate])

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
      <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6">
        {failure ? (
          <div className="space-y-4">
            <ErrorNote title={failure.error} hint={failure.hint} />
            <a href="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-700">
              ← Volver al generador
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <Spinner label="Conectando tu cuenta de Google…" />
          </div>
        )}
      </div>
    </main>
  )
}
