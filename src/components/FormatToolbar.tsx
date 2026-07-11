import { useState } from 'react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  History,
  Italic,
  Redo2,
  Underline,
  Undo2,
} from 'lucide-react'
import { useWorkspace } from '../state/workspaceStore'
import { useDialogChrome } from './ui'

/** Friendly history labels for the formatting commands. */
export const FORMAT_LABEL: Record<string, string> = {
  bold: 'Negrita',
  italic: 'Cursiva',
  underline: 'Subrayado',
  justifyLeft: 'Alineación izquierda',
  justifyCenter: 'Centrado',
  justifyRight: 'Alineación derecha',
  justifyFull: 'Justificado',
}

/** Formatting commands, in toolbar order. `null` = visual separator. */
const FORMAT_BUTTONS: ({ cmd: string; label: string; Icon: typeof Bold } | null)[] = [
  { cmd: 'bold', label: 'Negrita', Icon: Bold },
  { cmd: 'italic', label: 'Cursiva', Icon: Italic },
  { cmd: 'underline', label: 'Subrayado', Icon: Underline },
  null,
  { cmd: 'justifyLeft', label: 'Alinear a la izquierda', Icon: AlignLeft },
  { cmd: 'justifyCenter', label: 'Centrar', Icon: AlignCenter },
  { cmd: 'justifyRight', label: 'Alinear a la derecha', Icon: AlignRight },
  { cmd: 'justifyFull', label: 'Justificar', Icon: AlignJustify },
]

/** Bold/italic/underline + alignment over the selection in the editor iframe,
 * plus undo/redo and the change-history panel. */
export function FormatToolbar({
  fmt,
  onCommand,
}: {
  fmt: Record<string, boolean>
  onCommand: (cmd: string) => void
}) {
  const { history, undo, redo, notify } = useWorkspace()
  const [historyOpen, setHistoryOpen] = useState(false)

  const doUndo = () => {
    const label = undo()
    if (label) notify(`Deshecho: ${label}`)
  }
  const doRedo = () => {
    const label = redo()
    if (label) notify(`Rehecho: ${label}`)
  }

  const iconBtn =
    'rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-primary text-ink-secondary hover:bg-black/5 disabled:opacity-35 disabled:hover:bg-transparent'

  return (
    <div
      role="toolbar"
      aria-label="Formato del texto"
      className="relative flex shrink-0 items-center gap-0.5 rounded-lg border border-hairline bg-surface px-2 py-1 shadow-e1"
    >
      <button
        onClick={doUndo}
        disabled={history.past.length === 0}
        title={
          history.past.length > 0
            ? `Deshacer: ${history.past.at(-1)!.label} (Ctrl+Z)`
            : 'Nada que deshacer'
        }
        aria-label="Deshacer"
        className={iconBtn}
      >
        <Undo2 className="h-4 w-4" />
      </button>
      <button
        onClick={doRedo}
        disabled={history.future.length === 0}
        title={
          history.future.length > 0
            ? `Rehacer: ${history.future.at(-1)!.label} (Ctrl+Y)`
            : 'Nada que rehacer'
        }
        aria-label="Rehacer"
        className={iconBtn}
      >
        <Redo2 className="h-4 w-4" />
      </button>
      <button
        onClick={() => setHistoryOpen((v) => !v)}
        disabled={history.past.length === 0 && history.future.length === 0}
        title="Historial de cambios"
        aria-label="Historial de cambios"
        aria-expanded={historyOpen}
        className={iconBtn}
      >
        <History className="h-4 w-4" />
      </button>
      <span className="mx-1 h-4 w-px bg-hairline" />

      {FORMAT_BUTTONS.map((b, i) =>
        b ? (
          <button
            key={b.cmd}
            // preventDefault: keep the iframe selection alive on click.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onCommand(b.cmd)}
            title={b.label}
            aria-label={b.label}
            aria-pressed={fmt[b.cmd] ?? false}
            className={`rounded-md p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-primary ${
              fmt[b.cmd] ? 'bg-primary/10 text-primary' : 'text-ink-secondary hover:bg-black/5'
            }`}
          >
            <b.Icon className="h-4 w-4" />
          </button>
        ) : (
          <span key={`sep-${i}`} className="mx-1 h-4 w-px bg-hairline" />
        ),
      )}
      <span className="ml-2 text-xs text-ink-faint">
        Selecciona texto en el documento y aplica formato
      </span>

      {historyOpen ? <HistoryPanel onClose={() => setHistoryOpen(false)} /> : null}
    </div>
  )
}

const timeFmt = new Intl.DateTimeFormat('es-ES', { hour: '2-digit', minute: '2-digit' })

/** Change history: newest first; click an entry to roll back to before it. */
function HistoryPanel({ onClose }: { onClose: () => void }) {
  const dialogRef = useDialogChrome(onClose)
  const { history, undo, notify } = useWorkspace()
  const entries = [...history.past].reverse()

  /** Roll back N steps (entry index 0 = most recent change). */
  const rollBack = (steps: number, label: string) => {
    for (let i = 0; i < steps; i++) undo()
    notify(`Documento devuelto a antes de: ${label}`)
    onClose()
  }

  return (
    <>
      <div className="fixed inset-0 z-30" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-label="Historial de cambios"
        className="absolute left-0 top-full z-40 mt-2 max-h-80 w-96 overflow-y-auto rounded-xl border border-hairline bg-surface p-2 shadow-e2"
      >
        <p className="px-2 py-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
          Historial de cambios
        </p>
        {entries.length === 0 ? (
          <p className="px-2 py-2 text-xs text-ink-muted">Sin cambios que deshacer.</p>
        ) : (
          <ul className="divide-y divide-hairline/60">
            {entries.map((e, i) => (
              <li key={`${e.at}-${i}`}>
                <button
                  onClick={() => rollBack(i + 1, e.label)}
                  className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left outline-none hover:bg-canvas-soft focus-visible:ring-2 focus-visible:ring-primary"
                  title="Devolver el documento a justo antes de este cambio"
                >
                  <span className="truncate text-sm text-ink-secondary">{e.label}</span>
                  <span className="shrink-0 text-xs text-ink-faint">{timeFmt.format(e.at)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <p className="px-2 pb-1 pt-2 text-[11px] text-ink-faint">
          Clic en un cambio = volver a justo antes de él. Ctrl+Z deshace, Ctrl+Y rehace.
        </p>
      </div>
    </>
  )
}
