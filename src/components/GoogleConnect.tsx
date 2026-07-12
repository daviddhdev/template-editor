import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { CircleCheck, LogOut } from 'lucide-react'
import { googleAuthUrlFn, type GoogleStatus } from '../server/google'
import { logoutFn } from '../server/auth'
import { shutdownDraftSync } from '../state/draftStorage'
import { LOGIN_REDIRECT_KEY } from '../routes/login'
import { ConfirmDialog } from './ui'

/**
 * Compact account chip for the header: the session user (the Google OAuth
 * consent IS the login), a logout action, and a reconnect action when the
 * user's Drive connection lacks permissions or died (revoked refresh token).
 * Reconnecting simply reruns the consent flow: the fresh refresh token
 * overwrites the stored one on the exchange.
 */
export function GoogleConnect({
  status,
  onChanged,
}: {
  status: GoogleStatus | null
  onChanged: () => void
}) {
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ error: string; hint?: string } | null>(null)
  const [confirmLogout, setConfirmLogout] = useState(false)

  if (!status) return null

  /** Rerun the Google consent (login) flow, returning to the current screen. */
  async function reconnect() {
    setBusy(true)
    setError(null)
    try {
      sessionStorage.setItem(
        LOGIN_REDIRECT_KEY,
        window.location.pathname + window.location.search,
      )
      const res = await googleAuthUrlFn({ data: { origin: window.location.origin } })
      if (res.ok) window.location.href = res.data.url
      else {
        setError(res)
        setBusy(false)
      }
    } catch {
      setError({ error: 'No se pudo iniciar la reconexión con Google.' })
      setBusy(false)
    }
  }

  async function logout() {
    setBusy(true)
    setError(null)
    try {
      // Draft to the DB first (and, if it got there, the local mirror goes:
      // nothing personal stays on a shared browser).
      await shutdownDraftSync()
      await logoutFn()
    } finally {
      setBusy(false)
      onChanged()
      void navigate({ to: '/login' })
    }
  }

  return (
    <div className="relative ml-auto flex items-center gap-2">
      <span
        className="inline-flex items-center gap-1.5 rounded-full bg-accent-green/10 px-3 py-1.5 text-xs font-medium text-accent-green"
        title="Sesión iniciada con esta cuenta de Google: los PDF se generan con ella (paginación idéntica al original)"
      >
        <CircleCheck className="h-3.5 w-3.5" />
        {status.email ?? 'Sesión iniciada'}
      </span>
      {!status.connected || !status.canRead || !status.canWrite ? (
        <button
          onClick={reconnect}
          disabled={busy}
          className="inline-flex items-center gap-1 rounded-full bg-accent-orange/10 px-3 py-1.5 text-xs font-medium text-accent-orange hover:bg-accent-orange/15 disabled:opacity-50"
          title={
            !status.connected
              ? 'La conexión con Google Drive ya no es válida: reconecta para volver a leer documentos y generar PDFs'
              : !status.canRead
                ? 'Tu conexión es anterior al permiso de lectura: reconecta para poder cargar documentos y hojas privados'
                : 'Tu conexión es anterior al permiso de escritura en Drive: reconecta para poder subir los documentos generados a una carpeta'
          }
        >
          {!status.connected
            ? 'Reconectar Google'
            : !status.canRead
              ? 'Reconectar (permiso de lectura)'
              : 'Reconectar (permisos de Drive)'}
        </button>
      ) : null}
      <button
        onClick={() => setConfirmLogout(true)}
        disabled={busy}
        className="inline-flex items-center gap-1 text-xs text-ink-faint outline-none hover:text-ink-secondary focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-50"
        title="Cerrar la sesión en esta aplicación"
      >
        <LogOut className="h-3.5 w-3.5" /> Cerrar sesión
      </button>

      {error ? (
        <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-red-200 bg-surface p-3 shadow-e2">
          <p className="text-xs font-medium text-red-700">{error.error}</p>
          {error.hint ? <p className="mt-1 text-xs text-ink-muted">{error.hint}</p> : null}
          <button
            onClick={() => setError(null)}
            className="mt-2 text-xs font-medium text-ink-muted outline-none hover:text-ink-secondary focus-visible:ring-2 focus-visible:ring-primary"
          >
            Cerrar
          </button>
        </div>
      ) : null}

      {confirmLogout ? (
        <ConfirmDialog
          title="¿Cerrar sesión?"
          body="El borrador de trabajo queda guardado en tu cuenta: lo recuperarás al volver a entrar, también desde otro navegador. Tu conexión con Google Drive no se toca."
          confirmLabel="Cerrar sesión"
          onConfirm={() => {
            setConfirmLogout(false)
            void logout()
          }}
          onCancel={() => setConfirmLogout(false)}
        />
      ) : null}
    </div>
  )
}
