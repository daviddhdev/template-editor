import { Trash2 } from 'lucide-react'
import { Button, useDialogChrome } from './ui'

/** Popover to bind a clicked field chip to a data column. */
export function BindFieldPopover({
  tag,
  columns,
  onAssign,
  onRule,
  onRemove,
  onClose,
}: {
  tag: string
  columns: string[]
  onAssign: (column: string) => void
  /** Bind to a rule instead: false = conditional text, true = repeat per row. */
  onRule: (perRow: boolean) => void
  /** Delete the clicked chip from the document. */
  onRemove: () => void
  onClose: () => void
}) {
  const dialogRef = useDialogChrome(onClose)
  return (
    <div
      ref={dialogRef}
      role="dialog"
      aria-label={`Vincular el campo ${tag}`}
      className="absolute left-1/2 top-4 z-20 w-80 -translate-x-1/2 rounded-xl border border-hairline bg-surface p-4 shadow-e2"
    >
      <p className="mb-2 text-sm text-ink-secondary">
        ¿Con qué dato se rellena <strong>{tag}</strong>?
      </p>
      {columns.length > 0 ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {columns.map((c, i) => (
            <button
              key={c}
              onClick={() => onAssign(c)}
              autoFocus={i === 0}
              className="rounded-md bg-primary/10 px-2.5 py-1 text-sm font-medium text-primary outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-primary"
            >
              {c}
            </button>
          ))}
        </div>
      ) : (
        <p className="mb-3 text-xs text-ink-muted">
          Aún no has cargado los datos. Cárgalos arriba y vuelve a pulsar el campo.
        </p>
      )}
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
        <button
          onClick={onRemove}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1.5 text-xs font-medium text-red-500 outline-none hover:bg-red-50 focus-visible:ring-2 focus-visible:ring-primary"
          title="Eliminar este campo del documento"
        >
          <Trash2 className="h-3.5 w-3.5" /> Quitar campo
        </button>
        <Button variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  )
}
