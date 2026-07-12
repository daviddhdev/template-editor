import { useEffect, useState } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDashed,
  CloudUpload,
  ExternalLink,
  XCircle,
} from 'lucide-react'
import { authGuard } from '../lib/authRedirect'
import { listGenerationsFn, type GenerationRunSummary } from '../server/generationsDb'
import { Spinner } from './ui'

const dateTimeFmt = new Intl.DateTimeFormat('es-ES', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
})

const ROUTE_LABEL: Record<GenerationRunSummary['route'], string> = {
  native: 'Original de Drive',
  google_html: 'Google HTML',
  local: 'Motor local',
}

const KIND_LABEL: Record<string, string> = {
  google_sheet: 'Google Sheets',
  api_endpoint: 'API',
}

/**
 * Audit trail of generation batches (home screen section). Self-contained:
 * loads its own data so Home stays untouched beyond mounting it. Read-only —
 * the log is append-only by design (legal audit value).
 */
export function GenerationHistory() {
  const [runs, setRuns] = useState<GenerationRunSummary[] | null>(null)
  const [failed, setFailed] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    listGenerationsFn()
      .then((res) => {
        if (!alive) return
        authGuard(res)
        if (res.ok) setRuns(res.data)
        else setFailed(true)
      })
      .catch(() => alive && setFailed(true))
    return () => {
      alive = false
    }
  }, [])

  return (
    <section>
      <div className="mb-4 flex items-center gap-2.5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Historial de generaciones
        </h2>
        {runs ? (
          <span className="rounded-full border border-hairline bg-surface px-2 py-px text-xs font-semibold text-ink-muted">
            {runs.length}
          </span>
        ) : null}
      </div>

      {failed ? (
        // The templates section above already shows the big DB ErrorNote.
        <p className="text-sm text-ink-muted">No se pudo cargar el historial de generaciones.</p>
      ) : runs === null ? (
        <Spinner label="Cargando el historial…" />
      ) : runs.length === 0 ? (
        <p className="text-sm text-ink-muted">Aún no hay generaciones registradas.</p>
      ) : (
        <ul className="divide-y divide-hairline/60 rounded-lg border border-hairline bg-surface">
          {runs.map((r) => {
            const expanded = expandedId === r.id
            return (
              <li key={r.id}>
                <button
                  onClick={() => setExpandedId(expanded ? null : r.id)}
                  aria-expanded={expanded}
                  className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 px-3.5 py-2.5 text-left outline-none hover:bg-black/[.02] focus-visible:ring-2 focus-visible:ring-primary"
                >
                  {expanded ? (
                    <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                  )}
                  <span className="text-xs tabular-nums text-ink-muted">
                    {dateTimeFmt.format(new Date(r.startedAt))}
                  </span>
                  <span
                    className="min-w-0 flex-1 truncate text-sm font-medium text-ink"
                    title={r.templateName}
                  >
                    {r.templateName}
                  </span>
                  {r.status === 'running' ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-accent-orange/10 px-2 py-px text-[11px] font-medium text-accent-orange">
                      <AlertTriangle className="h-3 w-3" /> Interrumpida
                    </span>
                  ) : null}
                  <span className="rounded-full border border-hairline px-2 py-px text-[11px] text-ink-muted">
                    {ROUTE_LABEL[r.route]}
                  </span>
                  <span className="text-xs text-ink-muted">
                    <span className="font-semibold text-accent-green">{r.okCount} OK</span>
                    {r.errorCount > 0 ? (
                      <span className="font-semibold text-red-500"> · {r.errorCount} err.</span>
                    ) : null}
                    {' de '}
                    {r.docCount}
                  </span>
                  <span className="text-xs text-ink-faint">
                    {r.rowCount} filas · {KIND_LABEL[r.dataKind] ?? r.dataKind}
                  </span>
                  {r.actorEmail ? (
                    <span className="text-xs text-ink-faint" title={r.actorEmail}>
                      {r.actorEmail}
                    </span>
                  ) : null}
                  {r.driveFolderUrl ? (
                    <a
                      href={r.driveFolderUrl}
                      target="_blank"
                      rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
                    >
                      <ExternalLink className="h-3 w-3" /> Carpeta
                    </a>
                  ) : null}
                </button>
                {expanded ? (
                  <ul className="border-t border-hairline/60 bg-canvas-soft/50 px-9 py-2">
                    {r.docs.map((d, i) => (
                      <li key={`${d.name}-${i}`} className="flex items-center gap-2 py-0.5">
                        {d.status === 'ok' ? (
                          <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-accent-green" />
                        ) : d.status === 'error' ? (
                          <XCircle className="h-3.5 w-3.5 shrink-0 text-red-500" />
                        ) : (
                          <CircleDashed className="h-3.5 w-3.5 shrink-0 text-ink-faint" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs text-ink-secondary" title={d.name}>
                          {d.name}
                        </span>
                        {d.viaHtml ? (
                          <span className="text-[10px] uppercase tracking-wide text-ink-faint">
                            vía HTML
                          </span>
                        ) : null}
                        {d.uploaded === 'done' ? (
                          <span title="Subido a Drive">
                            <CloudUpload className="h-3.5 w-3.5 text-accent-green" />
                          </span>
                        ) : d.uploaded === 'error' ? (
                          <span title="Falló la subida a Drive">
                            <CloudUpload className="h-3.5 w-3.5 text-red-500" />
                          </span>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
