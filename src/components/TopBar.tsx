import { useState } from 'react'
import { Download, Eye, FileText, Pencil } from 'lucide-react'
import { useWorkspace } from '../state/workspaceStore'
import { fetchDocumentFn } from '../server/fetch'
import { loadDataIntoWorkspace } from '../lib/loadData'
import { extractSheetGid, withSheetGid } from '../lib/url'
import type { DataSourceKind } from '../types'
import { Button, ErrorNote, Spinner } from './ui'

type LoadError = { error: string; hint?: string } | null

const selectCls =
  'h-[38px] rounded-lg border border-hairline bg-canvas-soft px-2.5 text-sm font-medium text-ink-secondary outline-none focus:border-primary focus-visible:ring-2 focus-visible:ring-primary/10'

/**
 * Compact top bar: load the template doc and the data, choose grouping,
 * switch edit/preview, and generate. Two rows split by a hairline, like the
 * Notion-style mock: sources above, output controls below.
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

  const previewDisabled = view === 'edit' && (!editorHtml.trim() || !data)

  return (
    <div className="rounded-xl border border-hairline bg-surface p-3 shadow-e1">
      {/* Row 1: the two sources. */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Template source */}
        <div className="flex min-w-[16rem] flex-1 items-center gap-2">
          <div className="flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-input-border bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
            <FileText className="h-4 w-4 shrink-0 text-accent-sky" />
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Plantilla
            </span>
            <input
              value={templateUrl}
              onChange={(e) => setTemplateUrl(e.target.value)}
              placeholder="Enlace del documento (Google Docs)…"
              aria-label="Enlace del documento de Google Docs"
              onKeyDown={(e) => e.key === 'Enter' && templateUrl.trim() && loadDoc()}
              className="h-full min-w-0 flex-1 border-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
          <Button variant="secondary" onClick={loadDoc} disabled={docLoading || !templateUrl.trim()}>
            {docLoading ? <Spinner /> : 'Cargar'}
          </Button>
        </div>

        {/* Data source */}
        <div className="flex min-w-[18rem] flex-[1.35] items-center gap-2">
          <select
            value={dataKind}
            onChange={(e) => setDataKind(e.target.value as DataSourceKind)}
            className={selectCls}
            title="Origen de los datos"
            aria-label="Origen de los datos"
          >
            <option value="google_sheet">Hoja de Google</option>
            <option value="api_endpoint">API externa</option>
          </select>
          <div className="flex h-[38px] min-w-0 flex-1 items-center gap-2 rounded-lg border border-input-border bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/10">
            <span className="shrink-0 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
              Datos
            </span>
            <input
              value={dataUrl}
              onChange={(e) => setDataUrl(e.target.value)}
              placeholder={
                dataKind === 'google_sheet'
                  ? 'Enlace de la hoja de cálculo…'
                  : 'https://tu-api.ejemplo.com/datos'
              }
              aria-label="Enlace del origen de datos"
              onKeyDown={(e) => e.key === 'Enter' && dataUrl.trim() && loadData()}
              className="h-full min-w-0 flex-1 border-none bg-transparent text-sm text-ink outline-none placeholder:text-ink-faint"
            />
          </div>
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
              className={`max-w-[9rem] ${selectCls}`}
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
      </div>

      <div className="-mx-3 my-3 h-px bg-hairline" />

      {/* Row 2: grouping on the left, view + generate on the right. */}
      <div className="flex flex-wrap items-center gap-2.5">
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
          className={selectCls}
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
            className={`max-w-[10rem] ${selectCls}`}
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

        <div className="ml-auto flex items-center gap-2.5">
          {/* Edit / preview segmented control. */}
          <div className="inline-flex h-[38px] overflow-hidden rounded-lg border border-hairline bg-surface">
            <button
              onClick={() => setView('edit')}
              aria-pressed={view === 'edit'}
              title="Editar la plantilla"
              className={`inline-flex items-center gap-1.5 px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                view === 'edit'
                  ? 'bg-primary font-semibold text-white'
                  : 'font-medium text-ink-secondary hover:bg-canvas-soft'
              }`}
            >
              <Pencil className="h-4 w-4" /> Editar
            </button>
            <button
              onClick={() => setView('preview')}
              disabled={previewDisabled}
              aria-pressed={view === 'preview'}
              title={
                !editorHtml.trim()
                  ? 'Escribe o carga primero la plantilla'
                  : !data
                    ? 'Carga primero los datos'
                    : 'Ver el resultado con los datos reales'
              }
              className={`inline-flex items-center gap-1.5 px-3.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-40 ${
                view === 'preview'
                  ? 'bg-primary font-semibold text-white'
                  : 'font-medium text-ink-secondary hover:bg-canvas-soft'
              }`}
            >
              <Eye className="h-4 w-4" /> Vista previa
            </button>
          </div>
          <Button onClick={onGenerate} disabled={!canGenerate} title={generateBlockedReason ?? 'Crear los PDF'}>
            <Download className="h-4 w-4" /> Generar PDF
          </Button>
        </div>
      </div>

      {error ? (
        <div className="mt-3">
          <ErrorNote title={error.error} hint={error.hint} />
        </div>
      ) : null}
    </div>
  )
}
