import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, Eraser, FileCheck2, FileText, Sparkles } from 'lucide-react'
import { Link, useNavigate } from '@tanstack/react-router'
import type { Recipe } from '../types'
import { getRecipeFn } from '../server/recipesDb'
import { authGuard } from '../lib/authRedirect'
import { buildTemplateCached } from '../lib/template/parse'
import { manualPlan } from '../lib/manualForm'
import { resolveGroupDocument } from '../lib/engine/resolve'
import { buildNativeJobs, decideNativeRoute } from '../lib/nativeMerge'
import { renderDocuments } from '../lib/plan'
import { googleStatusFn, type GoogleStatus } from '../server/google'
import { getManualFormDraftFn, saveManualFormDraftFn, clearManualFormDraftFn } from '../server/manualFormDraftsDb'
import { GenerateDialog } from './GenerateDialog'
import { NativePreviewFrame } from './NativePreviewFrame'
import { PreviewFrame } from './PreviewFrame'
import { Button, ConfirmDialog, ErrorNote, Spinner, Toast } from './ui'

type LoadState = { status: 'loading' } | { status: 'ready'; recipe: Recipe } | { status: 'error'; error: string }

export function ManualForm({ recipeId }: { recipeId: string }) {
  const navigate = useNavigate()
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [values, setValues] = useState<Record<string, string>>({})
  const [draftReady, setDraftReady] = useState(false)
  const [draftError, setDraftError] = useState<string | null>(null)
  const [generateOpen, setGenerateOpen] = useState(false)
  const [confirmClear, setConfirmClear] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [google, setGoogle] = useState<GoogleStatus | null>(null)
  const skipNextSave = useRef(false)

  useEffect(() => {
    let alive = true
    void (async () => {
      try {
        const res = authGuard(await getRecipeFn({ data: { id: recipeId } }))
        if (!res.ok) { if (alive) setState({ status: 'error', error: res.error }); return }
        if (!alive) return
        const draft = await getManualFormDraftFn({ data: { recipeId } })
        if (!alive) return
        if (draft.ok && draft.data) setValues(draft.data)
        else if (!draft.ok) setDraftError(draft.error)
        setDraftReady(true)
        setState({ status: 'ready', recipe: res.data })
      } catch { if (alive) setState({ status: 'error', error: 'No se pudo abrir la plantilla.' }) }
    })()
    return () => { alive = false }
  }, [recipeId])

  useEffect(() => {
    googleStatusFn().then((res) => setGoogle(res.ok ? res.data : null)).catch(() => setGoogle(null))
  }, [])

  useEffect(() => {
    if (!draftReady) return
    if (skipNextSave.current) {
      skipNextSave.current = false
      return
    }
    const timer = window.setTimeout(() => {
      void saveManualFormDraftFn({ data: { recipeId, values } }).then((res) => {
        if (!res.ok) setDraftError(res.error)
        else setDraftError(null)
      }).catch(() => setDraftError('No se pudo guardar el borrador.'))
    }, 500)
    return () => window.clearTimeout(timer)
  }, [draftReady, recipeId, values])

  if (state.status === 'loading') return <div className="flex min-h-screen items-center justify-center"><Spinner label="Abriendo plantilla…" /></div>
  if (state.status === 'error') return <div className="mx-auto max-w-xl p-8"><ErrorNote title={state.error} /><Link className="mt-4 inline-flex text-sm text-primary hover:underline" to="/">Volver a plantillas</Link></div>

  return <ManualFormReady recipe={state.recipe} values={values} setValues={setValues} draftError={draftError} setDraftError={setDraftError} google={google} generateOpen={generateOpen} setGenerateOpen={setGenerateOpen} confirmClear={confirmClear} setConfirmClear={setConfirmClear} notice={notice} setNotice={setNotice} skipNextSave={skipNextSave} onBack={() => void navigate({ to: '/' })} />
}

function ManualFormReady({
  recipe, values, setValues, draftError, setDraftError, google, generateOpen, setGenerateOpen,
  confirmClear, setConfirmClear, notice, setNotice, skipNextSave, onBack,
}: {
  recipe: Recipe
  values: Record<string, string>
  setValues: React.Dispatch<React.SetStateAction<Record<string, string>>>
  draftError: string | null
  setDraftError: (value: string | null) => void
  google: GoogleStatus | null
  generateOpen: boolean
  setGenerateOpen: (value: boolean) => void
  confirmClear: boolean
  setConfirmClear: (value: boolean) => void
  notice: string | null
  setNotice: (value: string | null) => void
  skipNextSave: React.MutableRefObject<boolean>
  onBack: () => void
}) {
  const template = useMemo(() => buildTemplateCached(recipe.editorHtml, recipe.editorCss, recipe.editorTitle, recipe.templateUrl || 'form', recipe.editorBodyClass), [recipe])
  const resolved = useMemo(() => manualPlan(recipe, template, values), [recipe, template, values])
  const row = resolved.plan.data.rows[0] ?? {}
  const group = { key: recipe.name, rows: [row] }
  const previewHtml = useMemo(() => resolveGroupDocument(resolved.plan, group, 'placeholder'), [resolved.plan, row])
  const nativeRoute = useMemo(() => recipe.sourceFile ? decideNativeRoute({ sourceFile: recipe.sourceFile, editorHtml: recipe.editorHtml, editorCss: recipe.editorCss, ruleBindings: recipe.ruleBindings ?? {} }) : null, [recipe])
  const nativeJob = useMemo(() => {
    if (!recipe.sourceFile || !nativeRoute?.eligible || !google?.connected) return null
    const job = buildNativeJobs(resolved.plan, recipe.sourceFile.tagLiterals, nativeRoute.edits, nativeRoute.styles ?? [])[0]
    return job ? { ...job, name: recipe.name } : null
  }, [recipe, nativeRoute, google, resolved.plan])
  const jobs = useMemo(() => renderDocuments(resolved.plan, 'empty').map((job) => ({ ...job, name: recipe.name })), [resolved.plan, recipe.name])
  const emptyWarnings = resolved.fields.filter((f) => !(values[f.key] ?? '').trim()).map((f) => `«${f.label}» está vacío`)
  const formatWarnings = resolved.formatIssues.map((i) => `«${i.column}» no tiene un formato válido (ejemplo: ${i.example})`)
  const warnings = [...emptyWarnings, ...formatWarnings]
  const canGenerate = template.tags.length > 0 && resolved.missing.length === 0 && resolved.fields.length > 0

  async function clear() {
    skipNextSave.current = true
    setValues({})
    setConfirmClear(false)
    const res = await clearManualFormDraftFn({ data: { recipeId: recipe.id } }).catch(() => null)
    if (res && !res.ok) setDraftError(res.error)
    setNotice('Formulario limpio.')
  }

  return (
    <div className="mx-auto flex min-h-screen max-w-[110rem] flex-col gap-4 px-5 py-4">
      <header className="flex items-center gap-3">
        <button onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg border border-hairline bg-surface px-3 py-1.5 text-sm font-medium text-ink-secondary shadow-e1 hover:text-primary"><ArrowLeft className="h-3.5 w-3.5" /> Plantillas</button>
        <FileText className="h-5 w-5 text-accent-sky" />
        <div className="min-w-0"><h1 className="truncate text-lg font-bold text-ink">{recipe.name}</h1><p className="text-xs text-ink-muted">Rellenar formulario</p></div>
        <span className="ml-auto inline-flex items-center gap-1.5 text-xs text-ink-muted"><Sparkles className="h-3.5 w-3.5 text-accent-orange" /> Un documento</span>
      </header>

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col rounded-xl border border-hairline bg-surface p-4 shadow-e1">
          <div className="mb-3"><h2 className="text-sm font-semibold text-ink">Datos del documento</h2><p className="mt-1 text-xs text-ink-muted">Rellena los campos que utiliza esta plantilla. Los vacíos se pueden confirmar al generar.</p></div>
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto pr-1">
            {resolved.fields.map((field) => (
              <label key={field.key} className="block"><span className="mb-1 block text-xs font-medium text-ink-secondary">{field.label}</span><input type={field.inputType} value={values[field.key] ?? ''} onChange={(e) => setValues((current) => ({ ...current, [field.key]: e.target.value }))} className="w-full rounded-lg border border-input-border bg-surface px-3 py-2 text-sm text-ink outline-none focus:border-primary focus:ring-2 focus:ring-primary/10" /></label>
            ))}
            {resolved.fields.length === 0 ? <p className="rounded-lg bg-canvas-soft p-3 text-xs text-ink-muted">Esta plantilla no tiene campos rellenables.</p> : null}
          </div>
          {draftError ? <p className="mt-3 text-xs text-accent-orange">{draftError}</p> : null}
          <div className="mt-4 flex gap-2 border-t border-hairline pt-3"><Button variant="secondary" onClick={() => setConfirmClear(true)} disabled={!Object.values(values).some(Boolean)}><Eraser className="h-4 w-4" /> Limpiar</Button><Button onClick={() => setGenerateOpen(true)} disabled={!canGenerate} title={!canGenerate ? 'Completa la plantilla antes de generar' : undefined}><FileCheck2 className="h-4 w-4" /> Generar documento</Button></div>
        </section>

        <section className="flex min-h-[28rem] min-w-0 flex-col rounded-xl border border-hairline bg-canvas-soft p-3 shadow-e1"><div className="mb-2 flex items-center gap-2 px-1"><h2 className="text-sm font-semibold text-ink">Vista previa</h2><span className="text-xs text-ink-muted">Se actualiza al escribir</span></div>{nativeJob && recipe.sourceFile && google?.connected ? <NativePreviewFrame sourceFileId={recipe.sourceFile.id} job={nativeJob} fallbackHtml={previewHtml} className="min-h-0 flex-1" /> : <PreviewFrame html={previewHtml} className="min-h-0 flex-1" />}</section>
      </div>

      {generateOpen ? <GenerateDialog jobs={jobs} native={nativeJob && recipe.sourceFile ? { sourceFileId: recipe.sourceFile.id, jobs: [nativeJob] } : null} nativeFallbackReason={nativeRoute && !nativeRoute.eligible ? nativeRoute.reason : null} google={google} warnings={warnings} batchLabel={recipe.name} generationContext={{ recipeId: recipe.id, templateName: recipe.name, dataKind: 'manual_form', dataUrl: '', outputFolderUrl: recipe.outputFolderUrl }} onClose={() => setGenerateOpen(false)} /> : null}
      {confirmClear ? <ConfirmDialog title="¿Limpiar formulario?" body="Se borrarán los valores guardados para esta plantilla." confirmLabel="Limpiar" onConfirm={() => void clear()} onCancel={() => setConfirmClear(false)} /> : null}
      <Toast text={notice} token={notice ? 1 : 0} onDismiss={() => setNotice(null)} />
    </div>
  )
}
