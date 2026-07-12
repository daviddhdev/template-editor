import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CloudUpload,
  Download,
  ExternalLink,
  FileCheck2,
  Package,
  RotateCw,
  X,
  XCircle,
} from 'lucide-react'
import { generatePdfFn, type PdfFile, type PdfJob } from '../server/pdf'
import { generateGooglePdfFn, type GoogleFormat } from '../server/googlePdf'
import { generateNativePdfFn, type NativeJob } from '../server/googleNative'
import { driveUploadFn, ensureBatchFolderFn, type BatchFolder } from '../server/driveUpload'
import { finishGenerationFn, startGenerationFn } from '../server/generationsDb'
import type { GoogleStatus } from '../server/google'
import type { NativeFallbackReason } from '../lib/nativeMerge'
import { downloadDocument, downloadZip } from '../lib/download'
import { batchFolderName } from '../lib/fileName'
import { toGenerationDocs } from '../lib/generationLog'
import { extractGoogleFolderId } from '../lib/url'
import { useWorkspace } from '../state/workspaceStore'
import { Button, Spinner, useDialogChrome } from './ui'

const FALLBACK_EXPLANATION: Record<NativeFallbackReason, string> = {
  no_source:
    'Esta plantilla no viene de un archivo de Google Drive, así que se usará la conversión HTML.',
  inline_blocks:
    'Has insertado elementos sueltos en el documento (campo, texto condicional o sección repetible), así que se usará la conversión HTML. Para mantener la fidelidad exacta, escribe un {{campo}} en el documento de Google y vincúlalo desde la app (también a un texto condicional o una sección repetible).',
  edited:
    'Has modificado el texto del documento en la app, así que se usará la conversión HTML (el aspecto puede variar ligeramente respecto al original).',
  css_changed:
    'Has cambiado los márgenes en la app, así que se usará la conversión HTML (la generación desde el original los ignoraría).',
}

type DocStatus = 'pending' | 'running' | 'done' | 'error'

interface DocProgress {
  name: string
  status: DocStatus
  files: PdfFile[]
  error?: { error: string; hint?: string }
  /** True when this doc was (re)generated through the HTML route. */
  viaHtml?: boolean
  /** Drive upload sub-state — an upload failure never touches `status`, so
   * the local download stays available. */
  upload?: { status: 'uploading' | 'done' | 'error'; error?: { error: string; hint?: string } }
}

/** One output document with its per-route payloads. */
interface Unit {
  name: string
  nativeJob: NativeJob | null
  pdfJob: PdfJob | null
}

function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

/**
 * Modal that renders the documents and offers the downloads. Three routes:
 * `native` present → Google substitutes the data directly into a copy of the
 * ORIGINAL Drive document (exact fidelity); otherwise with a Google account
 * connected the resolved HTML is converted by Google Docs (exact pagination,
 * approximate styling); otherwise the local engine.
 *
 * Documents are generated ONE SERVER CALL EACH, so the dialog can show live
 * progress (count, elapsed, estimate), let the user cancel between documents,
 * keep going when one fails (the rest still download) and retry failures
 * individually — including retrying a failed native document through the
 * HTML route as an explicit choice.
 */
export function GenerateDialog({
  jobs,
  native = null,
  nativeFallbackReason = null,
  google,
  warnings = [],
  batchLabel = '',
  onClose,
}: {
  jobs: PdfJob[]
  /** Present when the document is untouched since import: generate from the
   * original Drive file instead of the resolved HTML. */
  native?: { sourceFileId: string; jobs: NativeJob[] } | null
  /** Why `native` is not available (shown so the fidelity change is visible). */
  nativeFallbackReason?: NativeFallbackReason | null
  google: GoogleStatus | null
  warnings?: string[]
  /** Template title, used to name the Drive batch folder. */
  batchLabel?: string
  onClose: () => void
}) {
  const [docs, setDocs] = useState<DocProgress[] | null>(null)
  const [running, setRunning] = useState(false)
  const [withDocx, setWithDocx] = useState(false)
  // Output folder is per template (saved with the recipe); the user pastes its
  // Drive URL. A template with a folder configured uploads by default.
  // savedRecipe/dataKind/dataUrl/data feed the generation audit log.
  const { outputFolderUrl, setOutputFolderUrl, savedRecipe, dataKind, dataUrl, data } =
    useWorkspace()
  const canWrite = google?.canWrite ?? false
  const [uploadToDrive, setUploadToDrive] = useState(
    () => outputFolderUrl.trim() !== '' && canWrite,
  )
  const outputFolderId = extractGoogleFolderId(outputFolderUrl)
  const [unmatched, setUnmatched] = useState<string[]>([])
  /** Batch subfolder in Drive, created lazily on the first upload. The name is
   * fixed once per batch so a FOLDER_GONE recreation reuses it. */
  const batchFolderRef = useRef<BatchFolder | null>(null)
  const batchNameRef = useRef<string | null>(null)
  const [batchFolder, setBatchFolder] = useState<BatchFolder | null>(null)
  /** Audit-log row of the current batch: promise of its id (start is fired
   * without await so a slow/down DB never delays the first document). */
  const runIdRef = useRef<Promise<string | null> | null>(null)
  /** Mirror of `docs` — by the time a batch finishes, the closure state is
   * stale; the ref always holds the latest per-document progress. */
  const docsRef = useRef<DocProgress[] | null>(null)
  const cancelRef = useRef(false)
  const startRef = useRef(0)
  /** Elapsed ms accumulated across previous runs (pause/resume keeps total). */
  const elapsedBase = useRef(0)
  const durations = useRef<number[]>([])
  // 1 s heartbeat so the elapsed/remaining readout moves while a doc renders.
  const [, setTick] = useState(0)

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setTick((x) => x + 1), 1000)
    return () => clearInterval(t)
  }, [running])

  // Escape closes — unless a generation is in flight (progress would be lost).
  const dialogRef = useDialogChrome(() => {
    if (!running) onClose()
  })

  const viaGoogle = google?.connected ?? false
  const viaNative = viaGoogle && native !== null

  // Native and HTML jobs come from the same planGroups() call in the same
  // order, so pairing is positional — pairing by name would send two groups
  // with the same label to the FIRST one's job, silently losing a document.
  const units: Unit[] = useMemo(() => {
    const count = native ? native.jobs.length : jobs.length
    return Array.from({ length: count }, (_, i) => ({
      name: native ? native.jobs[i].name : jobs[i].name,
      nativeJob: native?.jobs[i] ?? null,
      pdfJob: jobs[i] ?? null,
    }))
  }, [native, jobs])

  const patch = (i: number, p: Partial<DocProgress>) =>
    setDocs((d) => {
      const next = d ? d.map((doc, j) => (j === i ? { ...doc, ...p } : doc)) : d
      docsRef.current = next
      return next
    })

  async function callOne(
    unit: Unit,
    asHtml: boolean,
  ): Promise<
    { ok: true; files: PdfFile[]; unmatched?: string[] } | { ok: false; error: string; hint?: string }
  > {
    const formats: GoogleFormat[] = withDocx ? ['pdf', 'docx'] : ['pdf']
    try {
      if (viaNative && native && unit.nativeJob && !asHtml) {
        const res = await generateNativePdfFn({
          data: { sourceFileId: native.sourceFileId, jobs: [unit.nativeJob], formats },
        })
        return res.ok ? { ok: true, files: res.data.files, unmatched: res.data.unmatched } : res
      }
      if (viaGoogle && unit.pdfJob) {
        const res = await generateGooglePdfFn({ data: { jobs: [unit.pdfJob], formats } })
        return res.ok ? { ok: true, files: res.data.files } : res
      }
      if (unit.pdfJob) {
        const res = await generatePdfFn({ data: { jobs: [unit.pdfJob] } })
        return res.ok ? { ok: true, files: res.data.files } : res
      }
      return { ok: false, error: 'Este documento no tiene contenido que generar.' }
    } catch {
      return {
        ok: false,
        error: 'No se pudo generar. Revisa que el servidor esté funcionando e inténtalo de nuevo.',
      }
    }
  }

  /** Batch subfolder inside the template's output folder, created on first
   * use (or recreated with `force` after a FOLDER_GONE — same name, so the
   * batch stays together). */
  async function ensureFolder(
    force = false,
  ): Promise<{ ok: true; folder: BatchFolder } | { ok: false; error: string; hint?: string }> {
    if (force) batchFolderRef.current = null
    if (batchFolderRef.current) return { ok: true, folder: batchFolderRef.current }
    if (!outputFolderId) {
      return {
        ok: false,
        error: 'La URL de la carpeta de Drive no es válida.',
        hint: 'Pega el enlace de una carpeta (drive.google.com/drive/folders/…).',
      }
    }
    if (!batchNameRef.current) batchNameRef.current = batchFolderName(batchLabel, new Date())
    const res = await ensureBatchFolderFn({
      data: { parentFolderId: outputFolderId, batchName: batchNameRef.current },
    })
    if (!res.ok) return res
    batchFolderRef.current = res.data
    setBatchFolder(res.data)
    return { ok: true, folder: res.data }
  }

  /** Upload one document's files to the batch folder (never blocks the local
   * download: failures only mark the upload sub-state). */
  async function uploadDoc(i: number, files: PdfFile[]) {
    patch(i, { upload: { status: 'uploading' } })
    const fail = (error: string, hint?: string) =>
      patch(i, { upload: { status: 'error', error: { error, hint } } })
    try {
      let folder = await ensureFolder()
      if (!folder.ok) return fail(folder.error, folder.hint)
      for (const f of files) {
        const doc = {
          name: f.name,
          base64: f.base64,
          format: f.name.endsWith('.docx') ? ('docx' as const) : ('pdf' as const),
        }
        let res = await driveUploadFn({ data: { ...doc, folderId: folder.folder.folderId } })
        if (!res.ok && res.code === 'FOLDER_GONE') {
          // The user deleted the folder mid-batch: recreate once and retry.
          folder = await ensureFolder(true)
          if (!folder.ok) return fail(folder.error, folder.hint)
          res = await driveUploadFn({ data: { ...doc, folderId: folder.folder.folderId } })
        }
        if (!res.ok) return fail(res.error, res.hint)
      }
      patch(i, { upload: { status: 'done' } })
    } catch {
      fail('No se pudo subir a Drive. Comprueba tu conexión e inténtalo de nuevo.')
    }
  }

  /** Finalise (or re-finalise after retries) the audit-log row. Best effort:
   * a missing id (DB down at start) or a failed update never surfaces. */
  async function logFinish() {
    const id = await runIdRef.current?.catch(() => null)
    if (!id || !docsRef.current) return
    void finishGenerationFn({
      data: {
        id,
        docs: toGenerationDocs(docsRef.current),
        driveFolderUrl: batchFolderRef.current?.folderUrl ?? null,
      },
    }).catch(() => null)
  }

  async function runOne(i: number, asHtml: boolean) {
    patch(i, { status: 'running', error: undefined })
    const t0 = Date.now()
    const res = await callOne(units[i], asHtml)
    durations.current.push(Date.now() - t0)
    if (res.ok) {
      if (res.unmatched?.length) {
        setUnmatched((prev) => [...new Set([...prev, ...res.unmatched!])].sort())
      }
      patch(i, { status: 'done', files: res.files, viaHtml: asHtml || !(viaNative && units[i].nativeJob) })
      if (uploadToDrive && canWrite) await uploadDoc(i, res.files)
    } else {
      patch(i, { status: 'error', error: { error: res.error, hint: res.hint } })
    }
  }

  /** Generate every document that is not already done (start or resume). */
  async function run(current: DocProgress[] | null) {
    const base =
      current ?? units.map((u): DocProgress => ({ name: u.name, status: 'pending', files: [] }))
    setDocs(base)
    docsRef.current = base
    setRunning(true)
    cancelRef.current = false
    if (!current) {
      durations.current = []
      elapsedBase.current = 0
      setUnmatched([])
      batchFolderRef.current = null
      batchNameRef.current = null
      setBatchFolder(null)
      // Open the audit row for the new batch ("Continuar" keeps the same one).
      runIdRef.current = startGenerationFn({
        data: {
          recipeId: savedRecipe?.id ?? null,
          templateName: savedRecipe?.name ?? (batchLabel || 'Sin nombre'),
          route: viaNative ? 'native' : viaGoogle ? 'google_html' : 'local',
          dataKind,
          dataUrl,
          rowCount: data?.rows.length ?? 0,
          formats: withDocx && viaGoogle ? ['pdf', 'docx'] : ['pdf'],
          docNames: units.map((u) => u.name),
        },
      })
        .then((r) => (r.ok ? r.data.id : null))
        .catch(() => null)
    }
    startRef.current = Date.now()
    for (let i = 0; i < units.length; i++) {
      if (cancelRef.current) break
      if (base[i].status === 'done') continue
      await runOne(i, false)
    }
    elapsedBase.current += Date.now() - startRef.current
    void logFinish()
    setRunning(false)
  }

  async function retryOne(i: number, asHtml: boolean) {
    setRunning(true)
    cancelRef.current = false
    startRef.current = Date.now()
    await runOne(i, asHtml)
    elapsedBase.current += Date.now() - startRef.current
    void logFinish()
    setRunning(false)
  }

  async function retryFailedAsHtml() {
    if (!docs) return
    setRunning(true)
    cancelRef.current = false
    startRef.current = Date.now()
    for (let i = 0; i < units.length; i++) {
      if (cancelRef.current) break
      if (docs[i].status === 'error') await runOne(i, true)
    }
    elapsedBase.current += Date.now() - startRef.current
    void logFinish()
    setRunning(false)
  }

  async function downloadAll() {
    const files = docs?.flatMap((d) => d.files) ?? []
    const JSZip = (await import('jszip')).default
    const zip = new JSZip()
    for (const f of files) zip.file(f.name, f.base64, { base64: true })
    downloadZip('documentos.zip', await zip.generateAsync({ type: 'base64' }))
  }

  const started = docs !== null
  const doneCount = docs?.filter((d) => d.status === 'done').length ?? 0
  const errorCount = docs?.filter((d) => d.status === 'error').length ?? 0
  const finishedCount = doneCount + errorCount
  const pendingCount = (docs?.length ?? 0) - finishedCount
  const allFiles = docs?.flatMap((d) => d.files) ?? []
  const avg =
    durations.current.length > 0
      ? durations.current.reduce((a, b) => a + b, 0) / durations.current.length
      : 0
  const remainingMs = running && avg > 0 ? avg * pendingCount : 0
  const pct = docs && docs.length > 0 ? Math.round((finishedCount / docs.length) * 100) : 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Generar los documentos"
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-hairline bg-surface p-6 shadow-e2"
      >
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FileCheck2 className="h-6 w-6 text-primary" />
            <div>
              <h2 className="text-lg font-semibold text-ink">Generar los documentos</h2>
              <p className="text-sm text-ink-muted">
                Se crearán <strong>{units.length}</strong>{' '}
                {units.length === 1 ? 'documento' : 'documentos'} en PDF.
              </p>
            </div>
          </div>
          <button
            onClick={() => !running && onClose()}
            aria-label="Cerrar"
            disabled={running}
            className="rounded-md p-1.5 text-ink-muted outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-4 rounded-lg bg-canvas-soft px-3 py-2 text-xs text-ink-muted">
          {viaNative ? (
            <>
              Los generará <strong>Google Docs</strong> con tu cuenta
              {google?.email ? ` (${google.email})` : ''} a partir de tu documento{' '}
              <strong>original</strong> de Drive: cabecera, logotipos, imágenes y tipografías quedan
              exactamente como en la plantilla.
            </>
          ) : viaGoogle ? (
            <>
              Los generará <strong>Google Docs</strong> con tu cuenta
              {google?.email ? ` (${google.email})` : ''}: los saltos de página los pone Google,
              igual que en el documento original.
            </>
          ) : (
            <>
              Se generarán con el motor local (paginación aproximada). Conecta tu cuenta de Google
              (botón arriba a la derecha) para que los genere Google Docs con paginación exacta.
            </>
          )}
        </p>

        {viaGoogle && !viaNative && nativeFallbackReason && !started ? (
          <p className="mb-4 flex items-start gap-2 rounded-lg border border-accent-orange/30 bg-accent-orange/5 px-3 py-2 text-xs text-accent-orange">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            {FALLBACK_EXPLANATION[nativeFallbackReason]}
          </p>
        ) : null}

        {warnings.length > 0 && !started ? (
          <div className="mb-4 flex items-start gap-2.5 rounded-lg border border-accent-orange/30 bg-accent-orange/5 p-3 text-sm">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-accent-orange" />
            <div className="text-accent-orange">
              <p className="font-medium">Hay datos en blanco (saldrán vacíos en el PDF):</p>
              <ul className="mt-1 list-inside list-disc text-xs">
                {warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
              <p className="mt-1 text-xs">
                Si esas columnas son opcionales, puedes continuar sin problema.
              </p>
            </div>
          </div>
        ) : null}

        {!started ? (
          <div className="space-y-3">
            {viaGoogle ? (
              <>
                <label className="flex cursor-pointer items-center gap-2 text-sm text-ink-secondary">
                  <input
                    type="checkbox"
                    checked={withDocx}
                    onChange={(e) => setWithDocx(e.target.checked)}
                    className="h-4 w-4 rounded border-input-border accent-primary"
                  />
                  Incluir también Word (.docx) editable
                </label>
                <div>
                  <label
                    className={`flex items-center gap-2 text-sm text-ink-secondary ${canWrite ? 'cursor-pointer' : 'opacity-60'}`}
                  >
                    <input
                      type="checkbox"
                      checked={uploadToDrive}
                      disabled={!canWrite}
                      onChange={(e) => setUploadToDrive(e.target.checked)}
                      className="h-4 w-4 rounded border-input-border accent-primary"
                    />
                    Subir a una carpeta de Google Drive
                  </label>
                  {!canWrite ? (
                    <p className="ml-6 mt-1 flex items-start gap-1.5 text-xs text-accent-orange">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Tu conexión de Google no tiene el permiso de escritura en Drive. Usa
                      «Reconectar» (arriba a la derecha) para concederlo.
                    </p>
                  ) : uploadToDrive ? (
                    <div className="ml-6 mt-1.5 space-y-1">
                      <input
                        type="text"
                        value={outputFolderUrl}
                        onChange={(e) => setOutputFolderUrl(e.target.value)}
                        placeholder="https://drive.google.com/drive/folders/…"
                        className="w-full rounded-md border border-input-border bg-surface px-2.5 py-1.5 text-xs text-ink outline-none focus-visible:ring-2 focus-visible:ring-primary"
                        aria-label="URL de la carpeta de Drive de salida"
                      />
                      {outputFolderUrl.trim() !== '' && !outputFolderId ? (
                        <p className="text-xs text-red-500">
                          Esa URL no parece de una carpeta de Drive (drive.google.com/drive/folders/…).
                        </p>
                      ) : (
                        <p className="text-xs text-ink-muted">
                          Carpeta de esta plantilla (se guarda con ella). Cada generación crea una
                          subcarpeta con la fecha.
                        </p>
                      )}
                    </div>
                  ) : null}
                </div>
              </>
            ) : (
              <p className="text-xs text-ink-muted">
                El formato Word (.docx) solo está disponible generando con Google (conecta tu
                cuenta arriba a la derecha).
              </p>
            )}
            <Button
              onClick={() => run(null)}
              disabled={uploadToDrive && canWrite && !outputFolderId}
              title={
                uploadToDrive && canWrite && !outputFolderId
                  ? 'Pega la URL de la carpeta de Drive de salida (o desmarca la subida)'
                  : undefined
              }
            >
              <Download className="h-4 w-4" /> Generar {withDocx && viaGoogle ? 'PDF + Word' : 'PDF'}
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Progress: count, bar, elapsed / estimate, cancel. */}
            <div>
              <div className="mb-1 flex items-baseline justify-between text-xs text-ink-muted">
                <span className="font-medium text-ink-secondary">
                  {running
                    ? `Generando… ${finishedCount + 1 > docs!.length ? docs!.length : finishedCount + 1} de ${docs!.length}`
                    : cancelRefStatus(pendingCount, errorCount, docs!.length, doneCount)}
                </span>
                <span>
                  {fmtDuration(elapsedBase.current + (running ? Date.now() - startRef.current : 0))}{' '}
                  transcurrido
                  {running && remainingMs > 0 ? ` · quedan ~${fmtDuration(remainingMs)}` : ''}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-canvas-soft">
                <div
                  className="h-full rounded-full bg-primary transition-[width] duration-300"
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Per-document status list. */}
            <ul className="divide-y divide-hairline/60 rounded-lg border border-hairline">
              {docs!.map((d, i) => (
                <li key={d.name} className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    {d.status === 'done' ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-accent-green" />
                    ) : d.status === 'error' ? (
                      <XCircle className="h-4 w-4 shrink-0 text-red-500" />
                    ) : d.status === 'running' ? (
                      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    ) : (
                      <span className="h-4 w-4 shrink-0 rounded-full border-2 border-hairline" />
                    )}
                    <span className="min-w-0 flex-1 truncate text-sm text-ink-secondary" title={d.name}>
                      {d.name}
                      {d.status === 'done' && viaNative && d.viaHtml ? (
                        <span className="ml-1.5 text-[10px] uppercase tracking-wide text-ink-faint">
                          vía HTML
                        </span>
                      ) : null}
                    </span>
                    {d.status === 'done'
                      ? d.files.map((f) => (
                          <Button
                            key={f.name}
                            variant="secondary"
                            onClick={() => downloadDocument(f.name, f.base64)}
                            title={`Descargar ${f.name}`}
                          >
                            <Download className="h-3.5 w-3.5" />
                            {f.name.endsWith('.docx') ? 'Word' : 'PDF'}
                          </Button>
                        ))
                      : null}
                    {d.status === 'error' && !running ? (
                      <Button variant="secondary" onClick={() => retryOne(i, false)} title="Reintentar">
                        <RotateCw className="h-3.5 w-3.5" /> Reintentar
                      </Button>
                    ) : null}
                    {d.upload?.status === 'uploading' ? (
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-ink-muted">
                        <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                        Subiendo…
                      </span>
                    ) : d.upload?.status === 'done' ? (
                      <span title="Subido a Drive" className="shrink-0">
                        <CloudUpload className="h-4 w-4 text-accent-green" />
                      </span>
                    ) : d.upload?.status === 'error' && !running ? (
                      <Button
                        variant="secondary"
                        onClick={() => void uploadDoc(i, d.files).then(logFinish)}
                        title="Reintentar la subida a Drive"
                      >
                        <CloudUpload className="h-3.5 w-3.5" /> Reintentar subida
                      </Button>
                    ) : null}
                  </div>
                  {d.status === 'error' && d.error ? (
                    <p className="ml-6 mt-1 text-xs text-red-500">
                      {d.error.error}
                      {d.error.hint ? <span className="text-ink-muted"> {d.error.hint}</span> : null}
                    </p>
                  ) : null}
                  {d.upload?.status === 'error' && d.upload.error ? (
                    <p className="ml-6 mt-1 text-xs text-red-500">
                      No se subió a Drive: {d.upload.error.error}
                      {d.upload.error.hint ? (
                        <span className="text-ink-muted"> {d.upload.error.hint}</span>
                      ) : null}
                    </p>
                  ) : null}
                </li>
              ))}
            </ul>

            {unmatched.length > 0 ? (
              <p className="flex items-start gap-2 rounded-lg border border-accent-orange/30 bg-accent-orange/5 px-3 py-2 text-xs text-accent-orange">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                Estos campos no se encontraron en el documento original y quedaron sin sustituir:{' '}
                {unmatched.map((t) => `{{${t}}}`).join(', ')}.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              {running ? (
                <Button variant="secondary" onClick={() => (cancelRef.current = true)}>
                  <Ban className="h-4 w-4" />{' '}
                  {cancelRef.current ? (
                    <Spinner label="Cancelando tras el documento en curso…" />
                  ) : (
                    'Cancelar'
                  )}
                </Button>
              ) : (
                <>
                  {pendingCount > 0 ? (
                    <Button onClick={() => run(docs)}>
                      <Download className="h-4 w-4" /> Continuar ({pendingCount} pendientes)
                    </Button>
                  ) : null}
                  {allFiles.length > 1 ? (
                    <Button onClick={downloadAll}>
                      <Package className="h-4 w-4" /> Descargar todo (.zip)
                    </Button>
                  ) : null}
                  {errorCount > 0 && viaNative ? (
                    <Button variant="secondary" onClick={retryFailedAsHtml}>
                      <RotateCw className="h-4 w-4" /> Reintentar fallidos con conversión HTML
                    </Button>
                  ) : null}
                </>
              )}
              {batchFolder ? (
                <a
                  href={batchFolder.folderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Abrir carpeta en Drive
                </a>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/** Status line when not running: finished, cancelled midway, or with errors. */
function cancelRefStatus(pending: number, errors: number, total: number, done: number): string {
  if (pending > 0) return `En pausa — ${done} de ${total} generados`
  if (errors > 0) return `Terminado con ${errors} ${errors === 1 ? 'error' : 'errores'} — ${done} de ${total} generados`
  return `Listo — ${done} ${done === 1 ? 'documento generado' : 'documentos generados'}`
}
