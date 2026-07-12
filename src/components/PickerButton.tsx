import { useState } from 'react'
import { FolderOpen, Loader2 } from 'lucide-react'
import type { GoogleStatus } from '../server/google'
import { pickerConfigFn } from '../server/google'
import { openGooglePicker, type PickedFile, type PickerKind } from '../lib/googlePicker'
import { useWorkspace } from '../state/workspaceStore'

/**
 * Icon button that opens the Google Picker for one kind of file. Credentials
 * are fetched on demand per click (pickerConfigFn) and never stored. Disabled
 * — with a hint explaining why — until the user's connection can read Drive
 * and the server has a picker API key; pasting URLs keeps working regardless.
 */
export function PickerButton({
  kind,
  google,
  onPicked,
  label,
  size = 'md',
}: {
  kind: PickerKind
  google: GoogleStatus | null
  onPicked: (file: PickedFile) => void
  label: string
  /** md matches the 38px top-bar inputs; sm the compact dialog inputs. */
  size?: 'md' | 'sm'
}) {
  const notify = useWorkspace((s) => s.notify)
  const [loading, setLoading] = useState(false)

  const disabledHint = !google?.connected
    ? 'Conecta tu cuenta de Google (arriba a la derecha) para elegir de Drive.'
    : !google.canRead
      ? 'Usa «Reconectar» (arriba a la derecha) para conceder el permiso de lectura de Drive.'
      : !google.pickerConfigured
        ? 'Falta GOOGLE_API_KEY en el servidor (mira .env.example).'
        : null

  async function open() {
    setLoading(true)
    try {
      const res = await pickerConfigFn()
      if (!res.ok) {
        notify(res.error + (res.hint ? ` ${res.hint}` : ''))
        return
      }
      const file = await openGooglePicker(kind, res.data)
      if (file) onPicked(file)
    } catch (err) {
      notify(err instanceof Error ? err.message : 'No se pudo abrir el selector de Drive.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <button
      type="button"
      onClick={open}
      disabled={loading || disabledHint !== null}
      title={disabledHint ?? label}
      aria-label={label}
      className={`inline-flex shrink-0 items-center justify-center rounded-lg border border-hairline bg-surface text-ink-secondary shadow-e1 outline-none transition hover:bg-canvas-soft focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50 ${
        size === 'md' ? 'h-[38px] w-[38px]' : 'h-[30px] w-[30px] rounded-md'
      }`}
    >
      {loading ? (
        <Loader2 className={size === 'md' ? 'h-4 w-4 animate-spin' : 'h-3.5 w-3.5 animate-spin'} />
      ) : (
        <FolderOpen className={size === 'md' ? 'h-4 w-4' : 'h-3.5 w-3.5'} />
      )}
    </button>
  )
}
