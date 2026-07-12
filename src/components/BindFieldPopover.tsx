import { Check, Trash2, Unlink } from 'lucide-react'
import type { FormatId } from '../types'
import { FIELD_FORMATS } from '../lib/engine/format'
import { Button, useDialogChrome } from './ui'

/** Popover to bind a clicked field chip to a data column. */
export function BindFieldPopover({
  tag,
  columns,
  current,
  implicit,
  format,
  onAssign,
  onUnassign,
  onFormat,
  onRule,
  onRemove,
  onClose,
}: {
  tag: string
  columns: string[]
  /** Column the field currently resolves to (explicit or by name), if any. */
  current: string | null
  /** True when `current` comes from the name match, not an explicit choice. */
  implicit: boolean
  /** Display format chosen for this field (null = as-is). */
  format: FormatId | null
  onAssign: (column: string) => void
  /** Clear the explicit binding (shown only when there is one). */
  onUnassign: () => void
  /** Choose how the value is written (null = as-is). */
  onFormat: (format: FormatId | null) => void
  /** Bind to a rule instead: false = conditional text, true = repeat per row. */
  onRule: (perRow: boolean) => void
  /** Delete the clicked chip from the document. */
  onRemove: () => void
  onClose: () => void
}) {
  const dialogRef = useDialogChrome(onClose)
  const formatLabel = FIELD_FORMATS.find((f) => f.id === format)?.label
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={`Vincular el campo ${tag}`}
      className="absolute left-1/2 top-4 z-20 w-80 -translate-x-1/2 rounded-xl border border-hairline bg-surface p-4 shadow-e2"
    >
      <p className="mb-2 text-sm text-ink-secondary">
        {current ? (
          <>
            <strong>{tag}</strong> se rellena con la columna <strong>{current}</strong>
            {implicit ? ' (coincide por nombre)' : ''}
            {formatLabel ? (
              <>
                {' '}
                en formato <strong>{formatLabel}</strong>
              </>
            ) : null}
            . ¿Cambiarlo?
          </>
        ) : (
          <>
            ¿Con qué dato se rellena <strong>{tag}</strong>?
          </>
        )}
      </p>
      {columns.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {columns.map((c, i) => (
            <button
              key={c}
              onClick={() => onAssign(c)}
              autoFocus={i === 0}
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                c === current
                  ? 'bg-primary text-white'
                  : 'bg-primary/10 text-primary hover:bg-primary/15'
              }`}
            >
              {c === current ? <Check className="h-3.5 w-3.5" /> : null}
              {c}
            </button>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-xs text-ink-muted">
          Aún no has cargado los datos. Cárgalos arriba y vuelve a pulsar el campo.
        </p>
      )}
      {current ? (
        <>
          <p className="mb-1.5 text-xs text-ink-muted">¿Cómo se escribe?</p>
          <div className="mb-3 flex flex-wrap gap-1.5">
            <button
              onClick={() => onFormat(null)}
              title="El valor de la celda, sin cambios"
              className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                format === null
                  ? 'bg-ink text-white'
                  : 'bg-canvas-soft text-ink-secondary hover:bg-hairline'
              }`}
            >
              {format === null ? <Check className="h-3.5 w-3.5" /> : null}
              Tal cual
            </button>
            {FIELD_FORMATS.map((f) => (
              <button
                key={f.id}
                onClick={() => onFormat(f.id)}
                title={`Ej.: ${f.example}`}
                className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                  format === f.id
                    ? 'bg-ink text-white'
                    : 'bg-canvas-soft text-ink-secondary hover:bg-hairline'
                }`}
              >
                {format === f.id ? <Check className="h-3.5 w-3.5" /> : null}
                {f.label}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <p className="mb-1.5 text-xs text-ink-muted">O rellénalo con un texto construido:</p>
      <div className="mb-3 flex flex-wrap gap-1.5">
        <button
          onClick={() => onRule(false)}
          className="rounded-md bg-accent-orange/10 px-2.5 py-1 text-sm font-medium text-accent-orange outline-none hover:bg-accent-orange/15 focus-visible:ring-2 focus-visible:ring-primary"
        >
          Texto condicional…
        </button>
        <button
          onClick={() => onRule(true)}
          className="rounded-md bg-accent-teal/10 px-2.5 py-1 text-sm font-medium text-accent-teal outline-none hover:bg-accent-teal/15 focus-visible:ring-2 focus-visible:ring-primary"
        >
          Sección repetible (una por fila)…
        </button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <button
            onClick={onRemove}
            className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-500 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-primary"
            title="Eliminar este campo del documento"
          >
            <Trash2 className="h-3.5 w-3.5" /> Quitar campo
          </button>
          {current && !implicit ? (
            <button
              onClick={onUnassign}
              className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-ink-secondary outline-none hover:bg-canvas-soft focus-visible:ring-2 focus-visible:ring-primary"
              title="Quitar el vínculo con la columna (el campo se queda en el documento)"
            >
              <Unlink className="h-3.5 w-3.5" /> Desvincular
            </button>
          ) : null}
        </div>
        <Button variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  )
}
