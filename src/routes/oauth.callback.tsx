import { useEffect, useRef, useState } from 'react'
import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { googleExchangeFn } from '../server/google'
import { LOGIN_REDIRECT_KEY } from './login'
import { ErrorNote, Spinner } from '../components/ui'

/**
 * Where Google redirects back after the consent screen. Exchanges the
 * authorization code on the server — which completes the LOGIN (user upsert +
 * session cookie) — then returns to where /login was headed. Using a normal
 * client route (instead of a server route) keeps the OAuth flow independent
 * of the server-route API.
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
            ? 'Has cancelado la entrada con Google.'
            : 'Google no devolvió la autorización esperada.',
        hint: 'Puedes volver a intentarlo desde el botón "Entrar con Google".',
      })
      return
    }

    googleExchangeFn({ data: { code, state } })
      .then((res) => {
        if (res.ok) {
          const to = sessionStorage.getItem(LOGIN_REDIRECT_KEY) || '/'
          sessionStorage.removeItem(LOGIN_REDIRECT_KEY)
          navigate({ href: to })
        } else setFailure(res)
      })
      .catch(() => setFailure({ error: 'No se pudo completar la entrada con Google.' }))
  }, [code, state, error, navigate])

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas-soft p-6">
      <div className="w-full max-w-md rounded-xl border border-hairline bg-surface p-6 shadow-e1">
        {failure ? (
          <div className="space-y-4">
            <ErrorNote title={failure.error} hint={failure.hint} />
            <a href="/login" className="text-sm font-medium text-primary hover:text-primary-active">
              ← Volver a la pantalla de entrada
            </a>
          </div>
        ) : (
          <div className="flex items-center gap-3 text-sm text-ink-muted">
            <Spinner label="Entrando con tu cuenta de Google…" />
          </div>
        )}
      </div>
    </main>
  )
}
