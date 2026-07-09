import { useState } from 'react'
import { Save } from 'lucide-react'
import { useWorkspace } from '../state/workspaceStore'
import { saveRecipeFn } from '../server/recipesDb'
import { Button, ErrorNote, Spinner, TextInput, useDialogChrome } from './ui'

/** Save the current workspace into the template library (Postgres). */
export function SaveRecipeDialog({ onClose }: { onClose: () => void }) {
  const { editorTitle, notify } = useWorkspace()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<{ error: string; hint?: string } | null>(null)

  useDialogChrome(() => {
    if (!saving) onClose()
  })

  async function save() {
    const s = useWorkspace.getState()
    const finalName = name.trim() || s.editorTitle || 'Sin nombre'
    setSaving(true)
    setError(null)
    try {
      const res = await saveRecipeFn({
        data: {
          recipe: {
            name: finalName,
            templateUrl: s.templateUrl,
            editorHtml: s.editorHtml,
            editorCss: s.editorCss,
            editorTitle: s.editorTitle,
            editorBodyClass: s.editorBodyClass,
            dataKind: s.dataKind,
            dataUrl: s.dataUrl,
            mapping: s.mapping,
            group: s.group,
          },
        },
      })
      if (res.ok) {
        notify(`Plantilla «${finalName}» guardada en la biblioteca.`)
        onClose()
      } else {
        setError(res)
        setSaving(false)
      }
    } catch {
      setError({ error: 'No se pudo guardar la plantilla. Inténtalo de nuevo.' })
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/40 p-4" onClick={() => !saving && onClose()}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Guardar plantilla"
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-slate-800">Guardar en la biblioteca</p>
        <p className="mt-1 text-xs text-slate-500">
          Se guarda el documento con sus campos, el enlace de los datos, los vínculos y la
          agrupación. Los datos se releen al abrirla.
        </p>
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !saving && save()}
          placeholder={`Nombre (p. ej. ${editorTitle || 'Notificación mensual'})`}
          aria-label="Nombre de la plantilla"
          autoFocus
          disabled={saving}
          className="mt-3"
        />
        {error ? (
          <div className="mt-3">
            <ErrorNote title={error.error} hint={error.hint} />
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? (
              <Spinner label="Guardando (y generando miniatura)…" />
            ) : (
              <>
                <Save className="h-4 w-4" /> Guardar
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
