import { useState } from 'react'
import { GitBranch, Plus, Trash2 } from 'lucide-react'
import type { ConditionOperator, ConditionalRule } from '../types'
import { Button, useDialogChrome } from './ui'

const OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: 'equals', label: 'es igual a' },
  { value: 'not_equals', label: 'no es igual a' },
  { value: 'contains', label: 'contiene' },
]

const selectCls =
  'rounded-lg border border-slate-300 px-2 py-1.5 text-sm text-slate-700 outline-none focus:border-indigo-500'

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

/**
 * Popover form for one inline conditional. Edits a local copy of the rule;
 * "Guardar" hands it back to the canvas, which writes it into the document.
 */
export function CondEditor({
  initial,
  columns,
  onSave,
  onDelete,
  onClose,
}: {
  initial: ConditionalRule
  columns: string[]
  onSave: (rule: ConditionalRule) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [rule, setRule] = useState<ConditionalRule>(initial)
  useDialogChrome(onClose)

  const patchBranch = (id: string, patch: Partial<ConditionalRule['branches'][number]>) =>
    setRule((r) => ({
      ...r,
      branches: r.branches.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }))

  return (
    <div
      role="dialog"
      aria-label={`Editar condición ${rule.label}`}
      className="absolute left-1/2 top-4 z-20 max-h-[85%] w-[26rem] -translate-x-1/2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 shadow-xl"
    >
      <div className="mb-3 flex items-center gap-2">
        <GitBranch className="h-4 w-4 shrink-0 text-amber-500" />
        <input
          value={rule.label}
          onChange={(e) => setRule((r) => ({ ...r, label: e.target.value }))}
          autoFocus
          className="flex-1 rounded-lg border border-slate-300 px-2 py-1 text-sm font-medium text-slate-800 outline-none focus:border-indigo-500"
          title="Nombre de esta condición"
          aria-label="Nombre de esta condición"
        />
      </div>

      <div className="space-y-2.5">
        {rule.branches.map((br, i) => (
          <div key={br.id} className="rounded-lg bg-slate-50 p-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-600">
              <span className="font-medium">{i === 0 ? 'Si' : 'O si'}</span>
              <select
                value={br.column}
                onChange={(e) => patchBranch(br.id, { column: e.target.value })}
                className={selectCls}
                aria-label="Columna de la condición"
              >
                {columns.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <select
                value={br.operator}
                onChange={(e) => patchBranch(br.id, { operator: e.target.value as ConditionOperator })}
                className={selectCls}
                aria-label="Operador de comparación"
              >
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <input
                value={br.value}
                onChange={(e) => patchBranch(br.id, { value: e.target.value })}
                placeholder="valor"
                aria-label="Valor con el que comparar"
                className="w-24 rounded-lg border border-slate-300 px-2 py-1 outline-none focus:border-indigo-500"
              />
              {rule.branches.length > 1 ? (
                <button
                  onClick={() =>
                    setRule((r) => ({ ...r, branches: r.branches.filter((b) => b.id !== br.id) }))
                  }
                  className="ml-auto rounded-md p-1 text-slate-500 outline-none hover:text-red-500 focus-visible:ring-2 focus-visible:ring-indigo-500"
                  title="Quitar esta condición"
                  aria-label="Quitar esta condición"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </div>
            <textarea
              value={br.text}
              onChange={(e) => patchBranch(br.id, { text: e.target.value })}
              placeholder="Mostrar este texto… (puede incluir campos como {{nombre}})"
              aria-label="Texto a mostrar cuando se cumpla"
              rows={2}
              className="mt-1.5 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
            />
          </div>
        ))}

        <button
          onClick={() =>
            setRule((r) => ({
              ...r,
              branches: [
                ...r.branches,
                { id: uid(), column: columns[0] ?? '', operator: 'equals', value: '', text: '' },
              ],
            }))
          }
          className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-700"
        >
          <Plus className="h-3.5 w-3.5" /> Añadir otra condición
        </button>

        <label className="block text-xs text-slate-500">
          Si no se cumple ninguna, mostrar (opcional):
          <textarea
            value={rule.defaultText ?? ''}
            onChange={(e) => setRule((r) => ({ ...r, defaultText: e.target.value }))}
            placeholder="Dejar en blanco para no mostrar nada"
            rows={2}
            className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm outline-none focus:border-indigo-500"
          />
        </label>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <button
          onClick={onDelete}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-500 hover:bg-red-50"
        >
          <Trash2 className="h-3.5 w-3.5" /> Eliminar
        </button>
        <div className="flex gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button onClick={() => onSave(rule)}>Guardar</Button>
        </div>
      </div>
    </div>
  )
}
