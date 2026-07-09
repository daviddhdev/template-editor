import { useState } from 'react'
import { Download, Eye, FileText, Pencil } from 'lucide-react'
import { useWorkspace } from '../state/workspaceStore'
import { fetchDocumentFn } from '../server/fetch'
import { loadDataIntoWorkspace } from '../lib/loadData'
import { extractSheetGid, withSheetGid } from '../lib/url'
import type { DataSourceKind } from '../types'
import { Button, ErrorNote, Spinner, TextInput } from './ui'

type LoadError = { error: string; hint?: string } | null

/**
 * Compact top bar: load the template doc and the data, choose grouping,
 * switch edit/preview, and generate.
 */
export function TopBar({
  canGenerate,
  generateBlockedReason,
  onGenerate,
}: {
  canGenerate: boolean
  generateBlockedReason: string | null
  onGenerate: () => void
}) {
  const {
    templateUrl,
    dataKind,
    dataUrl,
    data,
    sheetTabs,
    group,
    view,
    editorHtml,
    setTemplateUrl,
    loadRawDocument,
    setDataKind,
    setDataUrl,
    setGroup,
    setView,
    notify,
  } = useWorkspace()

  const [docLoading, setDocLoading] = useState(false)
  const [dataLoading, setDataLoading] = useState(false)
  const [error, setError] = useState<LoadError>(null)

  async function loadDoc() {
    setDocLoading(true)
    setError(null)
    try {
      const res = await fetchDocumentFn({ data: { url: templateUrl.trim() } })
      if (res.ok) {
        loadRawDocument(res.data)
        notify(`Plantilla cargada: «${res.data.title || 'documento'}».`)
      } else setError(res)
    } catch {
      setError({ error: 'Algo salió mal al leer el documento. Inténtalo de nuevo.' })
    } finally {
      setDocLoading(false)
    }
  }

  async function loadData(origin = dataUrl.trim()) {
    setDataLoading(true)
    setError(null)
    try {
      const res = await loadDataIntoWorkspace(dataKind, origin)
      if (res.ok) {
        const base = `Datos cargados: ${res.rows} ${res.rows === 1 ? 'fila' : 'filas'}, ${res.columns} columnas`
        // With several tabs, ALWAYS say which one fed the data — a Share-button
        // link carries no tab and silently means "the first one".
        notify(res.multiTab && res.tabTitle ? `${base} (pestaña «${res.tabTitle}»).` : `${base}.`)
      } else setError(res)
    } catch {
      setError({ error: 'Algo salió mal al leer los datos. Inténtalo de nuevo.' })
    } finally {
      setDataLoading(false)
    }
  }

  /** Point the link at another tab and reload the rows from it. */
  function switchTab(gid: string) {
    const url = withSheetGid(dataUrl.trim(), gid)
    setDataUrl(url)
    void loadData(url)
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-3">
      <div className="flex flex-wrap items-center gap-2">
        {/* Template source */}
        <div className="flex min-w-[16rem] flex-1 items-center gap-1.5">
          <FileText className="h-4 w-4 shrink-0 text-indigo-500" />
          <TextInput
            value={templateUrl}
            onChange={(e) => setTemplateUrl(e.target.value)}
            placeholder="Enlace del documento (Google Docs)…"
            aria-label="Enlace del documento de Google Docs"
            onKeyDown={(e) => e.key === 'Enter' && templateUrl.trim() && loadDoc()}
          />
          <Button variant="secondary" onClick={loadDoc} disabled={docLoading || !templateUrl.trim()}>
            {docLoading ? <Spinner /> : 'Cargar'}
          </Button>
        </div>

        {/* Data source */}
        <div className="flex min-w-[18rem] flex-1 items-center gap-1.5">
          <select
            value={dataKind}
            onChange={(e) => setDataKind(e.target.value as DataSourceKind)}
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-100"
            title="Origen de los datos"
            aria-label="Origen de los datos"
          >
            <option value="google_sheet">Hoja de Google</option>
            <option value="api_endpoint">API externa</option>
          </select>
          <TextInput
            value={dataUrl}
            onChange={(e) => setDataUrl(e.target.value)}
            placeholder={
              dataKind === 'google_sheet'
                ? 'Enlace de la hoja de cálculo…'
                : 'https://tu-api.ejemplo.com/datos'
            }
            aria-label="Enlace del origen de datos"
            onKeyDown={(e) => e.key === 'Enter' && dataUrl.trim() && loadData()}
          />
          <Button
            variant="secondary"
            onClick={() => loadData()}
            disabled={dataLoading || !dataUrl.trim()}
          >
            {dataLoading ? <Spinner /> : 'Cargar'}
          </Button>
          {dataKind === 'google_sheet' && sheetTabs.length > 1 ? (
            <select
              value={extractSheetGid(dataUrl) ?? sheetTabs[0]?.gid ?? ''}
              onChange={(e) => switchTab(e.target.value)}
              disabled={dataLoading}
              className="max-w-[9rem] rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500"
              title="Pestaña de la hoja de cálculo que aporta los datos"
              aria-label="Pestaña de la hoja de cálculo"
            >
              {sheetTabs.map((t) => (
                <option key={t.gid} value={t.gid}>
                  {t.title}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {/* Grouping */}
        <div className="flex items-center gap-1.5">
          <select
            value={group.mode}
            onChange={(e) =>
              setGroup({
                mode: e.target.value as 'per_row' | 'per_group',
                groupByColumn:
                  e.target.value === 'per_group'
                    ? (group.groupByColumn ?? data?.columns[0] ?? null)
                    : group.groupByColumn,
              })
            }
            className="rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500"
            title="Cuántos documentos se crean"
            aria-label="Cuántos documentos se crean"
          >
            <option value="per_row">Un documento por fila</option>
            <option value="per_group">Un documento por grupo</option>
          </select>
          {group.mode === 'per_group' ? (
            <select
              value={group.groupByColumn ?? ''}
              onChange={(e) => setGroup({ groupByColumn: e.target.value })}
              className="max-w-[10rem] rounded-lg border border-slate-300 px-2 py-2 text-sm text-slate-700 outline-none focus:border-indigo-500"
              title="Columna que agrupa las filas"
              aria-label="Columna que agrupa las filas"
            >
              {(data?.columns ?? []).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          ) : null}
        </div>

        {/* View toggle + generate */}
        <div className="ml-auto flex items-center gap-1.5">
          <Button
            variant={view === 'preview' ? 'primary' : 'secondary'}
            onClick={() => setView(view === 'edit' ? 'preview' : 'edit')}
            disabled={view === 'edit' && (!editorHtml.trim() || !data)}
            title={
              !editorHtml.trim()
                ? 'Escribe o carga primero la plantilla'
                : !data
                  ? 'Carga primero los datos'
                  : 'Alterna entre editar y ver el resultado'
            }
          >
            {view === 'edit' ? <Eye className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
            {view === 'edit' ? 'Vista previa' : 'Editar'}
          </Button>
          <Button onClick={onGenerate} disabled={!canGenerate} title={generateBlockedReason ?? 'Crear los PDF'}>
            <Download className="h-4 w-4" /> Generar PDF
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-2">
          <ErrorNote title={error.error} hint={error.hint} />
        </div>
      ) : null}
    </div>
  )
}
