import { useState } from 'react'
import { GitBranch, GripVertical, Plus, Repeat, Sparkles } from 'lucide-react'
import { useWorkspace } from '../state/workspaceStore'
import { suggestMapping } from '../lib/ai/suggestMapping'
import { sampleRowsForMapping } from '../lib/ai/mappingPrompt'
import { suggestMappingFn } from '../server/aiMapping'
import { unmappedTags } from '../lib/plan'
import { buildTemplateCached } from '../lib/template/parse'
import { COND_MIME, DRAG_MIME } from './DocCanvas'
import type { DocCanvasHandle } from './DocCanvas'

/**
 * Scratch-style palette: data columns you drag (or click) into the document,
 * plus the building blocks (conditional text, repeatable section). Page breaks
 * are not a block: they are Google's business when generating via a connected
 * account, and auto-synced from the source doc on the local fallback.
 */
export function Palette({ canvas }: { canvas: React.RefObject<DocCanvasHandle | null> }) {
  const {
    data,
    editorHtml,
    editorCss,
    editorTitle,
    editorBodyClass,
    templateUrl,
    mapping,
    ruleBindings,
    mergeMapping,
    assign,
    group,
    notify,
  } = useWorkspace()
  const [customName, setCustomName] = useState('')
  const [suggesting, setSuggesting] = useState(false)

  const columns = data?.columns ?? []
  // Cached: shares the parse with Workspace instead of re-parsing per render
  // (same arguments, INCLUDING sourceUrl, or the shared cache would thrash).
  const template = editorHtml
    ? buildTemplateCached(editorHtml, editorCss, editorTitle, templateUrl || 'editor', editorBodyClass)
    : null
  const unbound = unmappedTags(template, columns, mapping, ruleBindings)
  /** Tags physically present in the document — only these can host a rule. */
  const docTags = new Set(template?.tags ?? [])

  async function autoSuggest() {
    // AI first (server fn), name-similarity heuristic as fallback. Only the
    // UNMAPPED tags travel; mergeMapping never overwrites a manual choice.
    if (!template || columns.length === 0 || suggesting) return
    const tags = unbound
    if (tags.length === 0) return
    const fallback = () => mergeMapping(suggestMapping(tags, columns, data?.rows.slice(0, 5)))
    setSuggesting(true)
    try {
      const res = await suggestMappingFn({
        data: { tags, columns, sampleRows: sampleRowsForMapping(data?.rows, columns) },
      })
      if (res.ok && res.data.available) {
        mergeMapping(res.data.mapping)
      } else if (res.ok) {
        fallback()
        notify('IA no configurada — sugerencia por similitud de nombres.')
      } else {
        fallback()
        notify(`La IA no respondió (${res.error}) — sugerencia por similitud de nombres.`)
      }
    } catch {
      fallback()
      notify('La IA no respondió — sugerencia por similitud de nombres.')
    } finally {
      setSuggesting(false)
    }
  }

  return (
    <aside className="flex w-[15.25rem] shrink-0 flex-col gap-6 overflow-y-auto rounded-xl border border-hairline bg-surface p-4 shadow-e1">
      <section>
        <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Datos · arrastra al documento
        </h3>
        {columns.length === 0 ? (
          <p className="text-xs text-ink-muted">
            Carga una hoja de datos arriba y sus columnas aparecerán aquí.
          </p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {columns.map((col) => (
              <button
                key={col}
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, col)
                  e.dataTransfer.setData('text/plain', col)
                  e.dataTransfer.effectAllowed = 'copy'
                }}
                onClick={() => canvas.current?.insertField(col)}
                title={`${col} — arrastra al documento o haz clic para insertarlo`}
                className="inline-flex max-w-full cursor-grab items-center gap-1 rounded-md bg-primary/10 px-2.5 py-1 text-left text-sm font-medium text-primary hover:bg-primary/15 active:cursor-grabbing"
              >
                <GripVertical className="h-3 w-3 shrink-0 opacity-50" />
                {/* Long dotted API paths (financial_estimation.payment_conditions)
                    have no spaces: let them wrap instead of clipping at the edge. */}
                <span className="min-w-0 break-all">{col}</span>
              </button>
            ))}
          </div>
        )}

        <div className="mt-3 flex gap-1.5">
          <input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customName.trim()) {
                canvas.current?.insertField(customName)
                setCustomName('')
              }
            }}
            placeholder="Otro campo…"
            className="w-full rounded-lg border border-input-border bg-surface px-2.5 py-1 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-primary"
          />
          <button
            onClick={() => {
              if (customName.trim()) {
                canvas.current?.insertField(customName)
                setCustomName('')
              }
            }}
            disabled={!customName.trim()}
            className="rounded-lg border border-hairline bg-surface p-1.5 text-ink-secondary shadow-e1 outline-none hover:bg-canvas-soft focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40"
            title="Insertar campo con este nombre"
            aria-label="Insertar campo con este nombre"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {unbound.length > 0 && columns.length > 0 ? (
          <button
            onClick={autoSuggest}
            disabled={suggesting}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary-active disabled:opacity-50"
          >
            <Sparkles className={`h-3.5 w-3.5 ${suggesting ? 'animate-pulse' : ''}`} />
            {suggesting ? 'Sugiriendo…' : 'Sugerir vínculos automáticamente'}
          </button>
        ) : null}
      </section>

      <section>
        <h3 className="mb-2.5 text-[11px] font-semibold uppercase tracking-wider text-ink-faint">
          Bloques · se aplican donde está el cursor
        </h3>
        <div className="flex flex-col gap-2">
          <PaletteBlock
            icon={<GitBranch className="h-4 w-4 text-accent-orange" />}
            label="Texto condicional"
            hint="Texto que solo aparece si se cumple una condición — arrastra o haz clic"
            onClick={() => canvas.current?.insertConditional()}
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(COND_MIME, 'cond')
              e.dataTransfer.effectAllowed = 'copy'
            }}
          />
          <PaletteBlock
            icon={<Repeat className="h-4 w-4 text-accent-teal" />}
            label="Repetir por fila"
            hint={
              group.mode === 'per_group'
                ? 'La sección (o los bloques seleccionados) se repite por cada fila del grupo'
                : 'Necesita «un documento por grupo» — se te propondrá el cambio'
            }
            onClick={() => canvas.current?.toggleRepeat()}
          />
        </div>
      </section>

      {unbound.length > 0 ? (
        <section className="rounded-lg border border-accent-orange/30 bg-accent-orange/5 p-2.5 text-xs">
          <p className="mb-2 font-medium text-accent-orange">
            {unbound.length === 1 ? 'Este campo necesita' : 'Estos campos necesitan'} un dato:
          </p>
          <ul className="space-y-1.5">
            {unbound.map((tag) => (
              <li key={tag} className="flex items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate font-medium text-ink-secondary" title={tag}>
                  {tag}
                </span>
                <select
                  value=""
                  onChange={(e) => e.target.value && assign(tag, e.target.value)}
                  disabled={columns.length === 0}
                  aria-label={`Columna para ${tag}`}
                  className="w-24 rounded-md border border-input-border bg-surface px-1 py-0.5 text-xs text-ink-secondary outline-none focus:border-primary disabled:opacity-40"
                >
                  <option value="">columna…</option>
                  {columns.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
                {docTags.has(tag) ? (
                  <button
                    onClick={() => canvas.current?.openRuleEditor(tag)}
                    title="Rellenar con un texto condicional o una sección repetible"
                    aria-label={`Vincular ${tag} a una regla`}
                    className="rounded-md p-1 text-accent-orange outline-none hover:bg-accent-orange/10 focus-visible:ring-2 focus-visible:ring-primary"
                  >
                    <GitBranch className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

    </aside>
  )
}

function PaletteBlock({
  icon,
  label,
  hint,
  onClick,
  draggable,
  onDragStart,
}: {
  icon: React.ReactNode
  label: string
  hint: string
  onClick: () => void
  draggable?: boolean
  onDragStart?: React.DragEventHandler<HTMLButtonElement>
}) {
  return (
    <button
      onClick={onClick}
      title={hint}
      draggable={draggable}
      onDragStart={onDragStart}
      className={`flex items-start gap-2.5 rounded-lg border border-hairline bg-surface px-3 py-2.5 text-left text-sm hover:border-ink-faint/40 hover:bg-canvas-soft ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span>
        <span className="block font-semibold text-ink">{label}</span>
        <span className="mt-0.5 block text-xs leading-snug text-ink-muted">{hint}</span>
      </span>
    </button>
  )
}
