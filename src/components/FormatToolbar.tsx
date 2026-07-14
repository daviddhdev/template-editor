import { useEffect, useState } from 'react'
import {
  AlignCenter,
  AlignJustify,
  AlignLeft,
  AlignRight,
  Bold,
  Check,
  History,
  Italic,
  Paintbrush,
  Redo2,
  Underline,
  Undo2,
} from 'lucide-react'
import { useWorkspace } from '../state/workspaceStore'
import { colorToHex, validFontSizePt } from '../lib/fieldAppearance'
import { useDialogChrome } from './ui'

const COMMON_FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 72]

export interface ToolbarTextStyle {
  fontSizePt: number
  colorHex: string
}

/** Friendly history labels for the formatting commands. */
export const FORMAT_LABEL: Record<string, string> = {
  fontSizePt: 'Tamaño de fuente',
  foreColor: 'Color del texto',
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

/** Bold/italic/underline + alignment over the latest editor/dialog selection,
 * plus undo/redo and the change-history panel. */
export function FormatToolbar({
  fmt,
  textStyle,
  templateColors,
  onCommand,
  onFontSize,
  onColor,
}: {
  fmt: Record<string, boolean>
  textStyle: ToolbarTextStyle
  templateColors: string[]
  onCommand: (cmd: string) => void
  onFontSize: (sizePt: number) => void
  onColor: (colorHex: string) => void
}) {
  const { history, undo, redo, notify } = useWorkspace()
  const [historyOpen, setHistoryOpen] = useState(false)
  const [colorOpen, setColorOpen] = useState(false)
  const [showAllColors, setShowAllColors] = useState(false)
  const [sizeInput, setSizeInput] = useState(String(textStyle.fontSizePt))
  const [hexInput, setHexInput] = useState(textStyle.colorHex)

  useEffect(() => {
    setSizeInput(String(textStyle.fontSizePt))
    setHexInput(textStyle.colorHex)
  }, [textStyle])

  const validateSize = () => {
    const size = Number(sizeInput)
    if (!validFontSizePt(size)) setSizeInput(String(textStyle.fontSizePt))
  }
  const changeSize = (raw: string) => {
    setSizeInput(raw)
    const size = Number(raw)
    if (raw.trim() && validFontSizePt(size)) onFontSize(size)
  }
  const commitColor = (raw: string, close = false) => {
    const color = colorToHex(raw)
    if (!color) {
      setHexInput(textStyle.colorHex)
      return
    }
    setHexInput(color)
    onColor(color)
    if (close) setColorOpen(false)
  }
  const colors = [textStyle.colorHex, ...templateColors.filter((c) => c !== textStyle.colorHex)]
  const visibleColors = showAllColors ? colors : colors.slice(0, 12)

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

      <label className="flex h-8 items-center gap-1 rounded-md border border-input-border bg-surface px-1.5 text-xs text-ink-muted">
        <input
          type="number"
          min={1}
          max={400}
          step={0.5}
          list="ttg-toolbar-font-sizes"
          value={sizeInput}
          onChange={(e) => changeSize(e.target.value)}
          onBlur={validateSize}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              validateSize()
            }
          }}
          aria-label="Tamaño de fuente en puntos"
          title="Tamaño de fuente"
          className="w-10 bg-transparent text-right text-sm text-ink outline-none"
        />
        <span>pt</span>
        <datalist id="ttg-toolbar-font-sizes">
          {COMMON_FONT_SIZES.map((size) => <option key={size} value={size} />)}
        </datalist>
      </label>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => setColorOpen((v) => !v)}
        title="Color del texto"
        aria-label="Color del texto"
        aria-expanded={colorOpen}
        className="relative flex h-8 items-center gap-1 rounded-md px-1.5 text-ink-secondary outline-none hover:bg-black/5 focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Paintbrush className="h-4 w-4" />
        <span className="h-1.5 w-5 rounded-full border border-black/10" style={{ backgroundColor: textStyle.colorHex }} />
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
        Selecciona texto en el documento o en una regla y aplica formato
      </span>

      {historyOpen ? <HistoryPanel onClose={() => setHistoryOpen(false)} /> : null}
      {colorOpen ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setColorOpen(false)} />
          <div
            role="dialog"
            aria-label="Elegir color del texto"
            className="absolute left-24 top-full z-40 mt-2 w-72 rounded-xl border border-hairline bg-surface p-3 shadow-e2"
          >
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Colores de la plantilla
            </p>
            <div className="flex flex-wrap gap-1.5">
              {visibleColors.map((color) => (
                <button
                  key={color}
                  type="button"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => commitColor(color, true)}
                  title={color}
                  aria-label={`Color ${color}`}
                  aria-pressed={color === textStyle.colorHex}
                  className={`flex h-7 w-7 items-center justify-center rounded-full border outline-none focus-visible:ring-2 focus-visible:ring-primary ${color === textStyle.colorHex ? 'border-primary ring-2 ring-primary/20' : 'border-black/15'}`}
                  style={{ backgroundColor: color }}
                >
                  {color === textStyle.colorHex ? <Check className={`h-3.5 w-3.5 ${color === '#FFFFFF' ? 'text-black' : 'text-white'}`} /> : null}
                </button>
              ))}
            </div>
            {colors.length > 12 ? (
              <button
                type="button"
                onClick={() => setShowAllColors((v) => !v)}
                className="mt-2 text-xs font-medium text-primary hover:text-primary-active"
              >
                {showAllColors ? 'Ver menos' : `Ver todos (${colors.length})`}
              </button>
            ) : null}
            <div className="mt-3 flex items-center gap-2 border-t border-hairline pt-3">
              <input
                type="color"
                value={textStyle.colorHex}
                onChange={(e) => commitColor(e.target.value)}
                aria-label="Elegir color personalizado"
                className="h-8 w-10 cursor-pointer rounded border border-input-border bg-surface p-0.5"
              />
              <input
                value={hexInput}
                onChange={(e) => setHexInput(e.target.value.toUpperCase())}
                onBlur={() => commitColor(hexInput)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    commitColor(hexInput, true)
                  }
                }}
                maxLength={7}
                aria-label="Color hexadecimal"
                className="h-8 w-24 rounded-md border border-input-border px-2 font-mono text-xs uppercase text-ink outline-none focus:border-primary"
              />
            </div>
          </div>
        </>
      ) : null}
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
