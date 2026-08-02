import { useEffect, useState } from 'react'
import { History, RotateCcw } from 'lucide-react'
import type { Recipe } from '../types'
import { authGuard } from '../lib/authRedirect'
import { listRecipeVersionsFn, restoreRecipeVersionFn, type RecipeVersionSummary } from '../server/recipesDb'
import { Button, ConfirmDialog, ErrorNote, Spinner, useDialogChrome } from './ui'

const dateFmt = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

export function VersionHistoryDialog({
  recipeId,
  recipeName,
  onClose,
  onRestored,
}: {
  recipeId: string
  recipeName: string
  onClose: () => void
  onRestored: (recipe: Recipe, sourceVersion: number) => Promise<void> | void
}) {
  const dialogRef = useDialogChrome(onClose)
  const [versions, setVersions] = useState<RecipeVersionSummary[] | null>(null)
  const [confirmVersion, setConfirmVersion] = useState<number | null>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<{ error: string; hint?: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    void listRecipeVersionsFn({ data: { id: recipeId } })
      .then((res) => {
        if (cancelled) return
        const guarded = authGuard(res)
        if (guarded.ok) setVersions(guarded.data)
        else setError(guarded)
      })
      .catch(() => !cancelled && setError({ error: 'No se pudo cargar el historial de versiones.' }))
    return () => {
      cancelled = true
    }
  }, [recipeId])

  async function restore(version: number) {
    setBusy(version)
    setError(null)
    try {
      const res = authGuard(await restoreRecipeVersionFn({ data: { id: recipeId, version } }))
      if (!res.ok) {
        setError(res)
        setBusy(null)
        return
      }
      await onRestored(res.data, version)
      onClose()
    } catch {
      setError({ error: 'No se pudo restaurar la versión. Inténtalo de nuevo.' })
      setBusy(null)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => !busy && onClose()}>
        <div ref={dialogRef} role="dialog" aria-modal="true" aria-label={`Historial de ${recipeName}`} className="w-full max-w-lg rounded-xl border border-hairline bg-surface p-5 shadow-e2" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center gap-2">
            <History className="h-5 w-5 text-primary" />
            <p className="truncate text-sm font-semibold text-ink">Historial de «{recipeName}»</p>
          </div>
          <p className="mt-1 text-xs text-ink-muted">Cada guardado conserva una versión. Restaurar crea una nueva versión y mantiene el historial.</p>
          {error ? <div className="mt-3"><ErrorNote title={error.error} hint={error.hint} /></div> : null}
          <div className="mt-4 max-h-[22rem] overflow-y-auto rounded-lg border border-hairline">
            {versions === null ? <div className="p-4"><Spinner label="Cargando historial…" /></div> : versions.length === 0 ? <p className="p-4 text-sm text-ink-muted">Aún no hay versiones guardadas.</p> : versions.map((v) => (
              <div key={v.version} className="flex items-center gap-3 border-b border-hairline px-3.5 py-3 last:border-b-0">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink">v{v.version} {v.isCurrent ? <span className="ml-1 rounded-full bg-accent-green/10 px-2 py-0.5 text-[11px] font-semibold text-accent-green">Actual</span> : null}</p>
                  <p className="text-xs text-ink-muted">{dateFmt.format(new Date(v.createdAt))}</p>
                  {v.restoredFromVersion ? <p className="text-[11px] text-ink-faint">Restaurada desde v{v.restoredFromVersion}</p> : null}
                </div>
                {v.isCurrent ? <span className="text-xs text-ink-faint">En uso</span> : <Button variant="secondary" className="px-2.5 py-1.5 text-xs" onClick={() => setConfirmVersion(v.version)} disabled={busy !== null}><RotateCcw className="h-3.5 w-3.5" /> Restaurar</Button>}
              </div>
            ))}
          </div>
          <div className="mt-4 flex justify-end"><Button variant="secondary" onClick={onClose} disabled={busy !== null}>Cerrar</Button></div>
        </div>
      </div>
      {confirmVersion !== null ? <ConfirmDialog title={`¿Restaurar v${confirmVersion}?`} body={`Se creará una nueva versión con el contenido de v${confirmVersion}. Las versiones existentes se conservarán.`} confirmLabel="Restaurar" onCancel={() => setConfirmVersion(null)} onConfirm={() => { const v = confirmVersion; setConfirmVersion(null); void restore(v) }} /> : null}
    </>
  )
}
