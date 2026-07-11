import { useState } from 'react'
import { GitBranch, Plus, Trash2 } from 'lucide-react'
import type { ConditionOperator, ConditionalRule } from '../types'
import { uid } from '../lib/uid'
import { Button, useDialogChrome } from './ui'

const OPERATORS: { value: ConditionOperator; label: string }[] = [
  { value: 'equals', label: 'es igual a' },
  { value: 'not_equals', label: 'no es igual a' },
  { value: 'contains', label: 'contiene' },
]

const selectCls =
  'rounded-lg border border-input-border bg-surface px-2 py-1.5 text-sm text-ink-secondary outline-none focus:border-primary'

/**
 * Popover form for one conditional rule. Edits a local copy; "Guardar" hands
 * it back to the caller — the canvas (inline conditional written into the
 * document) or a tag binding (anchored rule stored in the workspace).
 * `perRow` non-null shows the "repeat once per row" toggle (tag bindings).
 */
export function CondEditor({
  initial,
  columns,
  perRow = null,
  onSave,
  onDelete,
  onClose,
}: {
  initial: ConditionalRule
  columns: string[]
  /** null hides the toggle (inline conditionals); boolean sets its start value. */
  perRow?: boolean | null
  onSave: (rule: ConditionalRule, perRow: boolean) => void
  onDelete: () => void
  onClose: () => void
}) {
  const [rule, setRule] = useState<ConditionalRule>(initial)
  const [repeatPerRow, setRepeatPerRow] = useState(perRow ?? false)
  const dialogRef = useDialogChrome(onClose)

  const patchBranch = (id: string, patch: Partial<ConditionalRule['branches'][number]>) =>
    setRule((r) => ({
      ...r,
      branches: r.branches.map((b) => (b.id === id ? { ...b, ...patch } : b)),
    }))

  // Soft validation: warn about rules that would ALWAYS fire («contiene»
  // with an empty value matches every row) or that can never match (no
  // column chosen — e.g. the editor was opened before loading the data).
  // «es igual a» with an empty value is legitimate: "if the cell is blank".
  const alwaysTrue = rule.branches.some((b) => b.operator === 'contains' && !b.value.trim())
  const noColumn = rule.branches.some((b) => !b.column)

  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={`Editar condición ${rule.label}`}
      className="absolute left-1/2 top-4 z-20 max-h-[85%] w-[26rem] -translate-x-1/2 overflow-y-auto rounded-xl border border-hairline bg-surface p-4 shadow-e2"
    >
      <div className="mb-3 flex items-center gap-2">
        <GitBranch className="h-4 w-4 shrink-0 text-accent-orange" />
        <input
          value={rule.label}
          onChange={(e) => setRule((r) => ({ ...r, label: e.target.value }))}
          autoFocus
          className="flex-1 rounded-lg border border-input-border px-2 py-1 text-sm font-medium text-ink outline-none focus:border-primary"
          title="Nombre de esta condición"
          aria-label="Nombre de esta condición"
        />
      </div>

      <div className="space-y-2.5">
        {rule.branches.map((br, i) => (
          <div key={br.id} className="rounded-lg bg-canvas-soft p-2.5">
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-ink-muted">
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
                className="w-24 rounded-lg border border-input-border bg-surface px-2 py-1 outline-none placeholder:text-ink-faint focus:border-primary"
              />
              {rule.branches.length > 1 ? (
                <button
                  onClick={() =>
                    setRule((r) => ({ ...r, branches: r.branches.filter((b) => b.id !== br.id) }))
                  }
                  className="ml-auto rounded-md p-1 text-ink-faint outline-none hover:text-red-500 focus-visible:ring-2 focus-visible:ring-primary"
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
              className="mt-1.5 w-full rounded-lg border border-input-border bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-primary"
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
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:text-primary-active"
        >
          <Plus className="h-3.5 w-3.5" /> Añadir otra condición
        </button>

        <label className="block text-xs text-ink-muted">
          Si no se cumple ninguna, mostrar (opcional):
          <textarea
            value={rule.defaultText ?? ''}
            onChange={(e) => setRule((r) => ({ ...r, defaultText: e.target.value }))}
            placeholder="Dejar en blanco para no mostrar nada"
            rows={2}
            className="mt-1 w-full rounded-lg border border-input-border bg-surface px-2 py-1.5 text-sm outline-none placeholder:text-ink-faint focus:border-primary"
          />
        </label>

        {perRow !== null ? (
          <label className="flex cursor-pointer items-start gap-2 rounded-lg bg-canvas-soft p-2.5 text-xs text-ink-secondary">
            <input
              type="checkbox"
              checked={repeatPerRow}
              onChange={(e) => setRepeatPerRow(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-input-border accent-primary"
            />
            <span>
              <strong>Repetir por cada fila del grupo</strong> — el texto se genera una vez por
              fila y las piezas se unen con una línea en blanco (sección repetible).
            </span>
          </label>
        ) : null}
      </div>

      {alwaysTrue ? (
        <p className="mt-2 rounded-md bg-accent-orange/10 px-2.5 py-1.5 text-xs text-accent-orange">
          Una condición «contiene» con el valor vacío se cumple siempre: sus alternativas nunca se
          mostrarán.
        </p>
      ) : null}
      {noColumn ? (
        <p className="mt-2 rounded-md bg-accent-orange/10 px-2.5 py-1.5 text-xs text-accent-orange">
          Hay condiciones sin columna elegida (carga los datos arriba): esas condiciones nunca se
          cumplirán.
        </p>
      ) : null}

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
          <Button onClick={() => onSave(rule, repeatPerRow)}>Guardar</Button>
        </div>
      </div>
    </div>
  )
}
