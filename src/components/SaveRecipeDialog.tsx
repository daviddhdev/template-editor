import { useState } from 'react'
import { Save } from 'lucide-react'
import { useWorkspace } from '../state/workspaceStore'
import { saveRecipeFn, updateRecipeFn } from '../server/recipesDb'
import type { RecipeInput } from '../server/recipesDb'
import { Button, ErrorNote, Spinner, TextInput, useDialogChrome } from './ui'

/**
 * Save the current workspace into the template library (Postgres). When the
 * workspace is linked to a library row (opened from "Mis plantillas" or saved
 * before), the primary action overwrites it; "Guardar como nueva" always
 * creates a fresh row.
 */
export function SaveRecipeDialog({ onClose }: { onClose: () => void }) {
  const { editorTitle, savedRecipe, notify } = useWorkspace()
  const [name, setName] = useState(savedRecipe?.name ?? '')
  const [saving, setSaving] = useState<'update' | 'new' | null>(null)
  const [error, setError] = useState<{ error: string; hint?: string } | null>(null)

  const dialogRef = useDialogChrome(() => {
    if (!saving) onClose()
  })

  async function save(mode: 'update' | 'new') {
    const s = useWorkspace.getState()
    const finalName = name.trim() || s.editorTitle || 'Sin nombre'
    const recipe: RecipeInput = {
      name: finalName,
      templateUrl: s.templateUrl,
      editorHtml: s.editorHtml,
      editorCss: s.editorCss,
      editorTitle: s.editorTitle,
      editorBodyClass: s.editorBodyClass,
      dataKind: s.dataKind,
      dataUrl: s.dataUrl,
      mapping: s.mapping,
      ruleBindings: s.ruleBindings,
      group: s.group,
      sourceFile: s.sourceFile ?? undefined,
      outputFolderUrl: s.outputFolderUrl,
    }
    setSaving(mode)
    setError(null)
    try {
      if (mode === 'update' && s.savedRecipe) {
        const res = await updateRecipeFn({ data: { id: s.savedRecipe.id, recipe } })
        if (res.ok) {
          s.setSavedRecipe({ id: s.savedRecipe.id, name: finalName })
          notify(`Plantilla «${finalName}» actualizada en la biblioteca.`)
          onClose()
        } else {
          setError(res)
          setSaving(null)
        }
      } else {
        const res = await saveRecipeFn({ data: { recipe } })
        if (res.ok) {
          // Link the workspace to the new row so the next save can update it.
          s.setSavedRecipe({ id: res.data.id, name: finalName })
          notify(`Plantilla «${finalName}» guardada en la biblioteca.`)
          onClose()
        } else {
          setError(res)
          setSaving(null)
        }
      }
    } catch {
      setError({ error: 'No se pudo guardar la plantilla. Inténtalo de nuevo.' })
      setSaving(null)
    }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/30 p-4" onClick={() => !saving && onClose()}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Guardar plantilla"
        className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-5 shadow-e2"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-sm font-semibold text-ink">Guardar en la biblioteca</p>
        <p className="mt-1 text-xs text-ink-muted">
          {savedRecipe
            ? `«Guardar cambios» sobrescribe la plantilla «${savedRecipe.name}»; «Guardar como nueva» crea otra sin tocarla.`
            : 'Se guarda el documento con sus campos, el enlace de los datos, los vínculos y la agrupación. Los datos se releen al abrirla.'}
        </p>
        <TextInput
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && !saving && save(savedRecipe ? 'update' : 'new')}
          placeholder={`Nombre (p. ej. ${editorTitle || 'Notificación mensual'})`}
          aria-label="Nombre de la plantilla"
          autoFocus
          disabled={!!saving}
          className="mt-3"
        />
        {error ? (
          <div className="mt-3">
            <ErrorNote title={error.error} hint={error.hint} />
          </div>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={onClose} disabled={!!saving}>
            Cancelar
          </Button>
          {savedRecipe ? (
            <Button variant="secondary" onClick={() => save('new')} disabled={!!saving}>
              {saving === 'new' ? <Spinner label="Guardando…" /> : 'Guardar como nueva'}
            </Button>
          ) : null}
          <Button onClick={() => save(savedRecipe ? 'update' : 'new')} disabled={!!saving}>
            {saving === (savedRecipe ? 'update' : 'new') ? (
              <Spinner label="Guardando (y generando miniatura)…" />
            ) : (
              <>
                <Save className="h-4 w-4" /> {savedRecipe ? 'Guardar cambios' : 'Guardar'}
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  )
}
