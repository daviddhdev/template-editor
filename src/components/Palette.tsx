import { useState } from 'react'
import { GitBranch, GripVertical, Plus, Repeat, Sparkles } from 'lucide-react'
import { useWorkspace } from '../state/workspaceStore'
import { suggestMapping } from '../lib/ai/suggestMapping'
import { unmappedTags } from '../lib/plan'
import { buildTemplate } from '../lib/template/parse'
import { COND_MIME, DRAG_MIME } from './DocCanvas'
import type { DocCanvasHandle } from './DocCanvas'

/**
 * Scratch-style palette: data columns you drag (or click) into the document,
 * plus the building blocks (conditional text, repeatable section). Page breaks
 * are not a block: they are Google's business when generating via a connected
 * account, and auto-synced from the source doc on the local fallback.
 */
export function Palette({ canvas }: { canvas: React.RefObject<DocCanvasHandle | null> }) {
  const { data, editorHtml, editorCss, editorTitle, editorBodyClass, mapping, mergeMapping, group } =
    useWorkspace()
  const [customName, setCustomName] = useState('')

  const columns = data?.columns ?? []
  const template = editorHtml
    ? buildTemplate(editorHtml, editorCss, editorTitle, 'editor', editorBodyClass)
    : null
  const unbound = unmappedTags(template, columns, mapping)

  function autoSuggest() {
    // Extension point: heuristic today, a real AI call later (same signature).
    if (!template || columns.length === 0) return
    mergeMapping(suggestMapping(template.tags, columns, data?.rows.slice(0, 5)))
  }

  return (
    <aside className="flex w-60 shrink-0 flex-col gap-5 overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Datos — arrastra al documento
        </h3>
        {columns.length === 0 ? (
          <p className="text-xs text-slate-500">
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
                title="Arrastra al documento o haz clic para insertarlo donde está el cursor"
                className="inline-flex cursor-grab items-center gap-1 rounded-lg border border-indigo-200 bg-indigo-50 px-2.5 py-1 text-sm font-medium text-indigo-700 hover:bg-indigo-100 active:cursor-grabbing"
              >
                <GripVertical className="h-3 w-3 text-indigo-300" />
                {col}
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
            className="w-full rounded-lg border border-slate-300 px-2 py-1 text-sm outline-none focus:border-indigo-500"
          />
          <button
            onClick={() => {
              if (customName.trim()) {
                canvas.current?.insertField(customName)
                setCustomName('')
              }
            }}
            disabled={!customName.trim()}
            className="rounded-lg border border-slate-300 p-1.5 text-slate-500 outline-none hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-40"
            title="Insertar campo con este nombre"
            aria-label="Insertar campo con este nombre"
          >
            <Plus className="h-4 w-4" />
          </button>
        </div>

        {unbound.length > 0 && columns.length > 0 ? (
          <button
            onClick={autoSuggest}
            className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            <Sparkles className="h-3.5 w-3.5" /> Sugerir vínculos automáticamente
          </button>
        ) : null}
      </section>

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Bloques — se aplican donde está el cursor
        </h3>
        <div className="flex flex-col gap-1.5">
          <PaletteBlock
            icon={<GitBranch className="h-4 w-4 text-amber-500" />}
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
            icon={<Repeat className="h-4 w-4 text-emerald-500" />}
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
        <section className="rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-xs text-amber-800">
          <strong>{unbound.length}</strong> {unbound.length === 1 ? 'campo necesita' : 'campos necesitan'}{' '}
          un dato: {unbound.join(', ')}. Haz clic en el campo (en el documento) para elegirlo.
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
      className={`flex items-center gap-2.5 rounded-lg border border-slate-200 px-2.5 py-2 text-left text-sm text-slate-700 hover:border-slate-300 hover:bg-slate-50 ${draggable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      {icon}
      <span>
        <span className="block font-medium">{label}</span>
        <span className="block text-[11px] leading-tight text-slate-500">{hint}</span>
      </span>
    </button>
  )
}
