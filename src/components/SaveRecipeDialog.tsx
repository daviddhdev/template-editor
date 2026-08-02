import { useState } from 'react'
import type { RecipeInput } from '../server/recipesDb'
import { saveRecipeFn, updateRecipeFn } from '../server/recipesDb'
import { useWorkspace } from '../state/workspaceStore'
import { Button, ErrorNote, Spinner, TextInput, useDialogChrome } from './ui'

/** Save a new template or append an immutable version to the linked template. */
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
      apiConfig: s.apiConfig ?? undefined,
      mapping: s.mapping,
      ruleBindings: s.ruleBindings,
      tagFormats: s.tagFormats,
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
          notify(`Plantilla «${finalName}» guardada como v${res.data.version}.`)
          onClose()
        } else {
          setError(res)
          setSaving(null)
        }
      } else {
        const res = await saveRecipeFn({ data: { recipe, sourceRecipeId: s.savedRecipe?.id } })
        if (res.ok) {
          s.setSavedRecipe({ id: res.data.id, name: finalName })
          notify(`Plantilla «${finalName}» guardada como v${res.data.version}.`)
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
      <div ref={dialogRef} role="dialog" aria-modal="true" aria-label="Guardar plantilla" className="w-full max-w-sm rounded-xl border border-hairline bg-surface p-5 shadow-e2" onClick={(e) => e.stopPropagation()}>
        <p className="text-sm font-semibold text-ink">Guardar en la biblioteca</p>
        <p className="mt-1 text-xs text-ink-muted">
          {savedRecipe
            ? `«Guardar cambios» crea una nueva versión de «${savedRecipe.name}»; «Guardar como nueva» crea otra plantilla desde v1.`
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
        {error ? <div className="mt-3"><ErrorNote title={error.error} hint={error.hint} /></div> : null}
        <div className="mt-4 flex justify-end gap-2 flex-col">
          <Button onClick={() => save(savedRecipe ? 'update' : 'new')} disabled={!!saving}>
            {saving === (savedRecipe ? 'update' : 'new') ? <Spinner label="Guardando (y generando miniatura)…" /> : <>{savedRecipe ? 'Guardar nueva versión' : 'Guardar'}</>}
          </Button>
          {savedRecipe ? <Button variant="secondary" onClick={() => save('new')} disabled={!!saving}>{saving === 'new' ? <Spinner label="Guardando…" /> : 'Guardar como nueva'}</Button> : null}
          <Button variant="secondary" onClick={onClose} disabled={!!saving}>Cancelar</Button>
        </div>
      </div>
    </div>
  )
}
