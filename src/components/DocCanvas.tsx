import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { useWorkspace } from '../state/workspaceStore'
import {
  applyCondToElement,
  buildEditorDocument,
  decorateFields,
  makeCondElement,
  makeFieldChip,
  undecorateFields,
} from '../lib/editorHtml'
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
import { decodeCond } from '../lib/cond'
import { effectiveMapping } from '../lib/plan'
import type { ConditionalRule } from '../types'
import { CondEditor } from './CondEditor'
import { Button, ConfirmDialog, useDialogChrome } from './ui'

/** MIME type used to carry a column name through native drag & drop. */
export const DRAG_MIME = 'text/ttg-column'
/** MIME type used to drop a new inline conditional block. */
export const COND_MIME = 'text/ttg-cond'

function uid(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
}

/** Imperative surface the palette / panels use to act on the document. */
export interface DocCanvasHandle {
  /** Insert a field chip at the cursor (or at the end when no cursor). */
  insertField: (name: string) => void
  /**
   * Toggle "repeat once per row of the group". Single block at the cursor ->
   * toggles its data-ttg-repeat; a selection spanning several blocks -> wraps
   * them in one repeatable <div data-ttg-repeat>.
   */
  toggleRepeat: () => void
  /** Insert a new inline conditional after the cursor block and open its editor. */
  insertConditional: () => void
}

/**
 * The editable document canvas: an iframe rendering the source document with
 * its ORIGINAL CSS untouched (fidelity), plus editing chrome — field chips,
 * repeat markers and inline conditional blocks — all persisted inside the
 * document HTML itself (data-* attributes / .ttg-cond elements).
 */
export const DocCanvas = forwardRef<DocCanvasHandle, { className?: string }>(function DocCanvas(
  { className = '' },
  ref,
) {
  const { editorHtml, editorCss, editorBodyClass, docToken, data, mapping, setEditorHtml, assign } =
    useWorkspace()

  const iframeRef = useRef<HTMLIFrameElement>(null)
  const savedRange = useRef<Range | null>(null)
  /** Field-binding popover: which chip was clicked. */
  const [bindTag, setBindTag] = useState<string | null>(null)
  /** Inline-conditional editor: the .ttg-cond element being edited. */
  const [editingCond, setEditingCond] = useState<{ el: HTMLElement; rule: ConditionalRule } | null>(
    null,
  )
  /** Start from scratch: a real A4 page (Google-like defaults) instead of an
   * unstyled grey void — 595pt wide, 2.54 cm margins, Arial 11pt, white. */
  const startBlankDocument = useCallback(() => {
    useWorkspace.getState().loadRawDocument({
      title: 'Documento',
      css: 'body{background-color:#ffffff;max-width:451.3pt;padding:72pt;font-family:Arial;font-size:11pt;color:#000000;}\np{margin:0;line-height:1.15;}',
      bodyClass: '',
      bodyHtml: '<p><br></p>',
    })
  }, [])
  /** "Repetir por fila" pressed while in per-row mode: offer to switch. */
  const [askGroupMode, setAskGroupMode] = useState(false)
  /** Active inline formats at the caret, for toolbar button highlighting. */
  const [fmt, setFmt] = useState<Record<string, boolean>>({})

  const editorDoc = () => iframeRef.current?.contentDocument ?? null
  const editorWin = () => iframeRef.current?.contentWindow ?? null

  /** Amber-mark chips whose field name resolves to no column. */
  const refreshBindings = useCallback(() => {
    const doc = editorDoc()
    if (!doc) return
    const columns = useWorkspace.getState().data?.columns ?? []
    const explicit = useWorkspace.getState().mapping
    doc.body.querySelectorAll<HTMLElement>('.ttg-chip').forEach((chip) => {
      const tag = chip.dataset.field ?? ''
      const eff = effectiveMapping([tag], columns, explicit)
      chip.classList.toggle('ttg-unbound', !eff[tag])
    })
  }, [])

  const persist = useCallback(() => {
    const body = editorDoc()?.body
    if (body) setEditorHtml(undecorateFields(body.innerHTML))
    refreshBindings()
  }, [setEditorHtml, refreshBindings])

  const saveSelection = useCallback(() => {
    const win = editorWin()
    const doc = editorDoc()
    const sel = win?.getSelection()
    if (sel && sel.rangeCount && doc?.body.contains(sel.getRangeAt(0).commonAncestorContainer)) {
      savedRange.current = sel.getRangeAt(0).cloneRange()
    }
  }, [])

  /** Range at the saved cursor, or collapsed at the end of the document. */
  const cursorRange = useCallback((): Range | null => {
    const doc = editorDoc()
    const win = editorWin()
    if (!doc || !win) return null
    const sel = win.getSelection()
    if (savedRange.current) {
      sel?.removeAllRanges()
      sel?.addRange(savedRange.current)
    }
    let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null
    if (!range || !doc.body.contains(range.commonAncestorContainer)) {
      range = doc.createRange()
      range.selectNodeContents(doc.body)
      range.collapse(false)
    }
    return range
  }, [])

  /** Toolbar state: which inline formats apply at the current caret. */
  const refreshFmt = useCallback(() => {
    const doc = editorDoc()
    if (!doc) return
    const states: Record<string, boolean> = {}
    for (const cmd of ['bold', 'italic', 'underline', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull']) {
      try {
        states[cmd] = doc.queryCommandState(cmd)
      } catch {
        states[cmd] = false
      }
    }
    setFmt(states)
  }, [])

  /** Friendly history labels for the formatting commands. */
  const FORMAT_LABEL: Record<string, string> = {
    bold: 'Negrita',
    italic: 'Cursiva',
    underline: 'Subrayado',
    justifyLeft: 'Alineación izquierda',
    justifyCenter: 'Centrado',
    justifyRight: 'Alineación derecha',
    justifyFull: 'Justificado',
  }

  /**
   * Apply an inline/paragraph format to the current selection. The toolbar
   * lives OUTSIDE the iframe, so the saved selection is restored first;
   * `styleWithCSS` (set at init) makes execCommand emit inline styles like
   * Google's own export instead of <b>/<font> tags.
   */
  const execFormat = useCallback(
    (command: string) => {
      const doc = editorDoc()
      const win = editorWin()
      if (!doc || !win) return
      useWorkspace.getState().checkpoint(FORMAT_LABEL[command] ?? 'Formato')
      win.focus()
      doc.body.focus()
      const sel = win.getSelection()
      if (savedRange.current) {
        sel?.removeAllRanges()
        sel?.addRange(savedRange.current)
      }
      doc.execCommand(command)

      // Google's export gives paragraphs their own first-line indent
      // (text-indent) and side margins via CSS classes. text-align:center
      // alone leaves the first line pushed right of centre and the whole box
      // offset — the text looks anchored to its first letter. Centring a
      // paragraph means centring it ON THE PAGE, so neutralise those.
      if (command === 'justifyCenter') {
        const r = sel && sel.rangeCount ? sel.getRangeAt(0) : null
        if (r) {
          for (const el of doc.body.querySelectorAll<HTMLElement>('p,h1,h2,h3,h4,h5,h6,li')) {
            if (!r.intersectsNode(el)) continue
            el.style.textIndent = '0'
            el.style.marginLeft = '0'
            el.style.marginRight = '0'
          }
        }
      }

      if (sel && sel.rangeCount) savedRange.current = sel.getRangeAt(0).cloneRange()
      persist()
      refreshFmt()
    },
    [persist, refreshFmt],
  )

  const insertFieldAtRange = useCallback(
    (name: string, range: Range): HTMLElement | null => {
      const doc = editorDoc()
      const win = editorWin()
      const clean = name.trim()
      if (!doc || !win || !clean) return null
      range.deleteContents()
      const chip = makeFieldChip(clean, doc)
      const space = doc.createTextNode(' ')
      range.insertNode(space)
      range.insertNode(chip)
      range.setStartAfter(space)
      range.collapse(true)
      const sel = win.getSelection()
      sel?.removeAllRanges()
      sel?.addRange(range)
      savedRange.current = range.cloneRange()
      persist()
      return chip
    },
    [persist],
  )

  /** Top-level block (direct child of body) containing a node. */
  const topBlockOf = useCallback((start: Node | null): HTMLElement | null => {
    const doc = editorDoc()
    if (!doc || !start) return null
    let node: Node | null = start
    while (node && node.parentNode !== doc.body) node = node.parentNode
    return node && node.nodeType === 1 ? (node as HTMLElement) : null
  }, [])

  /**
   * The node a range boundary points at. Clicks in contenteditable sometimes
   * leave the caret at BODY level (container = body, offset = child index) —
   * descend to the child so the block walk works.
   */
  const boundaryNode = useCallback((container: Node, offset: number, end = false): Node | null => {
    const doc = editorDoc()
    if (!doc || container !== doc.body) return container
    const kids = doc.body.childNodes
    if (kids.length === 0) return null
    const idx = end && offset > 0 ? offset - 1 : Math.min(offset, kids.length - 1)
    return kids[idx] ?? null
  }, [])

  /** Top-level block holding the cursor. */
  const cursorBlock = useCallback((): HTMLElement | null => {
    const range = cursorRange()
    if (!range) return null
    return topBlockOf(boundaryNode(range.startContainer, range.startOffset))
  }, [cursorRange, topBlockOf, boundaryNode])

  const toggleRepeat = useCallback(() => {
    const doc = editorDoc()
    const range = cursorRange()
    if (!doc || !range) return
    const startBlock = topBlockOf(boundaryNode(range.startContainer, range.startOffset))
    const endBlock = topBlockOf(boundaryNode(range.endContainer, range.endOffset, true))
    if (!startBlock) return
    useWorkspace.getState().checkpoint('Sección repetible')

    // Repeating only has meaning when several rows feed one document. If the
    // user MARKS a section while in per-row mode, ask to switch to per-group
    // instead of silently marking something the engine would ignore.
    // (Un-marking is always allowed.)
    const marksNew =
      startBlock.getAttribute('data-ttg-repeat') !== 'true' ||
      (endBlock && endBlock !== startBlock)

    if (endBlock && endBlock !== startBlock) {
      // Selection spans several blocks -> wrap the contiguous run in ONE
      // repeatable section.
      const wrapper = doc.createElement('div')
      wrapper.setAttribute('data-ttg-repeat', 'true')
      doc.body.insertBefore(wrapper, startBlock)
      let node: Node | null = startBlock
      while (node) {
        const next: Node | null = node === endBlock ? null : node.nextSibling
        wrapper.appendChild(node)
        node = next
      }
      persist()
    } else {
      const el = startBlock
      if (el.getAttribute('data-ttg-repeat') === 'true') {
        if (el.tagName === 'DIV' && el.children.length > 0 && !el.getAttribute('data-cond')) {
          // A wrapper section: unwrap its blocks back into the body.
          while (el.firstChild) doc.body.insertBefore(el.firstChild, el)
          el.remove()
        } else {
          el.removeAttribute('data-ttg-repeat')
        }
      } else {
        el.setAttribute('data-ttg-repeat', 'true')
      }
      persist()
    }

    if (marksNew && useWorkspace.getState().group.mode === 'per_row') {
      setAskGroupMode(true)
    }
  }, [cursorRange, topBlockOf, boundaryNode, persist])

  const freshRule = useCallback((): ConditionalRule => {
    const columns = useWorkspace.getState().data?.columns ?? []
    return {
      id: uid(),
      label: 'Texto condicional',
      branches: [{ id: uid(), column: columns[0] ?? '', operator: 'equals', value: '', text: '' }],
      defaultText: '',
    }
  }, [])

  /** Insert a new conditional block after `after` (or at the end) and edit it. */
  const insertCondAfter = useCallback(
    (after: HTMLElement | null) => {
      const doc = editorDoc()
      if (!doc) return
      useWorkspace.getState().checkpoint('Texto condicional añadido')
      const rule = freshRule()
      const el = makeCondElement(rule, doc)
      if (after) after.insertAdjacentElement('afterend', el)
      else doc.body.appendChild(el)
      persist()
      setEditingCond({ el, rule })
    },
    [freshRule, persist],
  )

  useImperativeHandle(
    ref,
    (): DocCanvasHandle => ({
      insertField: (name) => {
        editorWin()?.focus()
        editorDoc()?.body.focus()
        useWorkspace.getState().checkpoint(`Campo «${name.trim()}»`)
        // With no saved cursor the range falls back to the END of the doc,
        // possibly out of view — scroll there and say so (N1 feedback).
        const hadCursor = !!savedRange.current
        const range = cursorRange()
        if (!range) return
        const chip = insertFieldAtRange(name, range)
        if (chip && !hadCursor) {
          chip.scrollIntoView({ block: 'center' })
          useWorkspace.getState().notify('No había cursor en el documento: campo añadido al final.')
        }
      },
      toggleRepeat,
      insertConditional: () => insertCondAfter(cursorBlock()),
    }),
    [cursorRange, insertFieldAtRange, toggleRepeat, insertCondAfter, cursorBlock],
  )

  // (Re)write the iframe whenever a new source doc is loaded, and on mount.
  useEffect(() => {
    const doc = editorDoc()
    if (!doc) return
    doc.open()
    doc.write(buildEditorDocument(editorCss, editorBodyClass, decorateFields(editorHtml || '')))
    doc.close()
    const body = doc.body

    // Inline styles (like Google's export) instead of <b>/<font> wrappers.
    try {
      doc.execCommand('styleWithCSS', false, 'true')
    } catch {
      /* non-blocking */
    }

    // History checkpoint at the START of a typing burst: beforeinput fires
    // BEFORE the DOM mutates, so the store still holds the pre-change state
    // (bursts coalesce in the store; see pushHistory).
    body.addEventListener('beforeinput', () => {
      useWorkspace.getState().checkpoint('Escritura')
    })
    // Native contenteditable undo cannot see our programmatic mutations
    // (chips, wrappers, margins), so route Ctrl+Z/Y to OUR history instead.
    doc.addEventListener('keydown', (e) => {
      const k = e.key.toLowerCase()
      if (!(e.ctrlKey || e.metaKey) || (k !== 'z' && k !== 'y')) return
      e.preventDefault()
      const st = useWorkspace.getState()
      const label = k === 'y' || (k === 'z' && e.shiftKey) ? st.redo() : st.undo()
      if (label) st.notify(`${k === 'y' || e.shiftKey ? 'Rehecho' : 'Deshecho'}: ${label}`)
    })

    body.addEventListener('input', persist)
    body.addEventListener('keyup', saveSelection)
    body.addEventListener('mouseup', saveSelection)
    body.addEventListener('focusout', persist)
    doc.addEventListener('selectionchange', refreshFmt)

    // Clicks: a field chip opens the binding popover; an inline conditional
    // opens its editor.
    body.addEventListener('click', (e) => {
      const target = e.target as HTMLElement | null
      const cond = target?.closest?.('.ttg-cond') as HTMLElement | null
      if (cond) {
        const rule = decodeCond(cond.getAttribute('data-cond') ?? '')
        if (rule) setEditingCond({ el: cond, rule })
        return
      }
      const chip = target?.closest?.('.ttg-chip') as HTMLElement | null
      if (chip?.dataset.field) setBindTag(chip.dataset.field)
    })

    // Native drag & drop from the palette into the document.
    body.addEventListener('dragover', (e) => {
      const types = e.dataTransfer?.types ?? []
      if (!types.includes(DRAG_MIME) && !types.includes(COND_MIME)) return
      e.preventDefault()
      e.dataTransfer!.dropEffect = 'copy'
      // Move the caret with the pointer so the insertion point is visible.
      const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY)
      if (r) {
        const sel = doc.defaultView?.getSelection()
        sel?.removeAllRanges()
        sel?.addRange(r)
      }
    })
    body.addEventListener('drop', (e) => {
      const dt = e.dataTransfer
      if (!dt) return
      if (dt.types.includes(COND_MIME)) {
        e.preventDefault()
        const r = doc.caretRangeFromPoint?.(e.clientX, e.clientY)
        let block: HTMLElement | null = null
        let node: Node | null = r ? r.commonAncestorContainer : null
        while (node && node.parentNode !== doc.body) node = node.parentNode
        if (node && node.nodeType === 1) block = node as HTMLElement
        insertCondAfter(block)
        return
      }
      const column = dt.getData(DRAG_MIME) || dt.getData('text/plain')
      if (!column) return
      e.preventDefault()
      const range = doc.caretRangeFromPoint?.(e.clientX, e.clientY)
      if (range) {
        useWorkspace.getState().checkpoint(`Campo «${column.trim()}»`)
        insertFieldAtRange(column, range)
      }
    })

    refreshBindings()
    // NO cleanup persisting the body here: on a docToken change the cleanup
    // runs BEFORE the new document is written, so it would overwrite the
    // freshly loaded editorHtml with the PREVIOUS iframe content (empty on
    // first load). Edits are already persisted by the input/focusout listeners.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docToken])

  // Re-evaluate chip binding marks when data or explicit bindings change.
  useEffect(() => {
    refreshBindings()
  }, [data, mapping, refreshBindings])

  const columns = data?.columns ?? []

  const showBlankHelp = !editorHtml.trim()

  return (
    <div className={`flex flex-col gap-1.5 ${className === 'hidden' ? 'hidden' : className}`}>
      <FormatToolbar fmt={fmt} onCommand={execFormat} />
      {editorHtml.trim() ? (
        <MarginRuler
          iframeRef={iframeRef}
          docToken={docToken}
          onCommit={(l, r, w) => useWorkspace.getState().setPageMargins(l, r, w)}
        />
      ) : null}

      <div className="relative min-h-0 flex-1">
      <iframe
        ref={iframeRef}
        title="Editor de plantilla"
        className="h-full w-full rounded-lg border border-hairline bg-[#eceae7]"
      />

      {showBlankHelp ? (
        <div className="absolute inset-0 z-10 flex items-center justify-center rounded-lg bg-canvas-soft/95 p-6">
          <div className="max-w-md">
            <h2 className="text-base font-semibold text-ink">Tres pasos para tus PDF</h2>
            <ol className="mt-3 space-y-2 text-sm text-ink-muted">
              <li>
                <strong className="text-ink">1.</strong> Pega arriba el enlace de tu documento
                de Google y pulsa <strong>Cargar</strong>.
              </li>
              <li>
                <strong className="text-ink">2.</strong> Carga tus datos (enlace de la hoja de
                Google).
              </li>
              <li>
                <strong className="text-ink">3.</strong> Arrastra las columnas de la izquierda
                al documento y pulsa <strong>Generar PDF</strong>.
              </li>
            </ol>
            <Button variant="secondary" className="mt-4" onClick={startBlankDocument}>
              O empieza con un documento en blanco (A4)
            </Button>
          </div>
        </div>
      ) : null}

      {bindTag ? (
        <BindFieldPopover
          tag={bindTag}
          columns={columns}
          onAssign={(c) => {
            assign(bindTag, c)
            setBindTag(null)
          }}
          onClose={() => setBindTag(null)}
        />
      ) : null}

      {editingCond ? (
        <CondEditor
          key={editingCond.rule.id}
          initial={editingCond.rule}
          columns={columns}
          onSave={(rule) => {
            useWorkspace.getState().checkpoint('Condición editada')
            applyCondToElement(editingCond.el, rule)
            persist()
            setEditingCond(null)
          }}
          onDelete={() => {
            useWorkspace.getState().checkpoint('Condición eliminada')
            editingCond.el.remove()
            persist()
            setEditingCond(null)
          }}
          onClose={() => setEditingCond(null)}
        />
      ) : null}
      </div>

      {askGroupMode ? (
        <ConfirmDialog
          title="Repetir necesita agrupar filas"
          body='Una sección repetible se repite por cada fila que entra en el mismo documento. En «un documento por fila» cada documento lleva una sola fila, así que no se repetiría. ¿Cambiar a «un documento por grupo»?'
          confirmLabel="Sí, agrupar filas"
          onConfirm={() => {
            const s = useWorkspace.getState()
            s.setGroup({
              mode: 'per_group',
              groupByColumn: s.group.groupByColumn ?? s.data?.columns[0] ?? null,
            })
            setAskGroupMode(false)
            s.notify('Modo cambiado a «un documento por grupo». Elige arriba la columna que agrupa.')
          }}
          onCancel={() => setAskGroupMode(false)}
        />
      ) : null}
    </div>
  )
})

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

/** CSS px per pt inside the iframe (96 dpi), and pt per centimetre. */
const PX_PER_PT = 4 / 3
const CM_TO_PT = 28.3465

/**
 * Google-Docs-style horizontal ruler over the canvas. The two draggable
 * triangles set the document's PAGE side margins — i.e. the body padding,
 * which is what the whole pipeline treats as the page margin (server/pdf.ts
 * turns it into real @page margins; Google re-lays it out the same).
 *
 * While dragging, the padding is applied inline on the iframe body (with
 * !important, to beat the stored override) for live feedback; on release the
 * value is committed to the document CSS via setPageMargins, which is what
 * previews, PDFs and saved templates read.
 */
function MarginRuler({
  iframeRef,
  docToken,
  onCommit,
}: {
  iframeRef: React.RefObject<HTMLIFrameElement | null>
  docToken: number
  onCommit: (leftPt: number, rightPt: number, contentWidthPt: number) => void
}) {
  const rulerRef = useRef<HTMLDivElement>(null)
  const [geom, setGeom] = useState<{
    pageLeft: number
    pageWidth: number
    padL: number
    padR: number
  } | null>(null)
  const dragSide = useRef<'left' | 'right' | null>(null)
  /**
   * Page box frozen at drag start. The page width must stay CONSTANT while a
   * margin moves (the content narrows instead, via max-width) — recomputing
   * the reference mid-drag would chase the re-centred page and amplify the
   * movement.
   */
  const dragBase = useRef<{ pageLeft: number; pageWidth: number } | null>(null)

  const measure = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    const body = doc?.body
    const win = doc?.defaultView
    if (!doc || !body || !win) return
    const rect = body.getBoundingClientRect()
    const cs = win.getComputedStyle(body)
    setGeom({
      pageLeft: rect.left,
      pageWidth: rect.width,
      padL: parseFloat(cs.paddingLeft) || 0,
      padR: parseFloat(cs.paddingRight) || 0,
    })
  }, [iframeRef])

  // The iframe loads/relayouts outside React's knowledge: poll cheaply.
  useEffect(() => {
    measure()
    const t = setInterval(measure, 500)
    window.addEventListener('resize', measure)
    return () => {
      clearInterval(t)
      window.removeEventListener('resize', measure)
    }
  }, [measure, docToken])

  const roundPt = (px: number) => Math.round((px / PX_PER_PT) * 2) / 2

  /** Apply a margin (ruler px) live: pad grows, content narrows, page fixed. */
  const applyPad = useCallback(
    (side: 'left' | 'right', padPx: number) => {
      const doc = iframeRef.current?.contentDocument
      const body = doc?.body
      const win = doc?.defaultView
      if (!body || !win || !geom) return
      const base = dragBase.current ?? { pageLeft: geom.pageLeft, pageWidth: geom.pageWidth }
      const clamped = Math.max(0, Math.min(padPx, base.pageWidth / 2 - 40))
      const cs = win.getComputedStyle(body)
      const otherPadPx = parseFloat(side === 'left' ? cs.paddingRight : cs.paddingLeft) || 0
      const padPt = roundPt(clamped)
      const contentPt = Math.max(60, roundPt(base.pageWidth) - padPt - roundPt(otherPadPx))
      body.style.setProperty(
        side === 'left' ? 'padding-left' : 'padding-right',
        `${padPt}pt`,
        'important',
      )
      body.style.setProperty('max-width', `${contentPt}pt`, 'important')
      measure()
    },
    [iframeRef, geom, measure],
  )

  const commit = useCallback(() => {
    const doc = iframeRef.current?.contentDocument
    const body = doc?.body
    const win = doc?.defaultView
    if (!body || !win) return
    const cs = win.getComputedStyle(body)
    const padL = roundPt(parseFloat(cs.paddingLeft) || 0)
    const padR = roundPt(parseFloat(cs.paddingRight) || 0)
    const contentPt = Math.max(60, roundPt(body.getBoundingClientRect().width) - padL - padR)
    onCommit(padL, padR, contentPt)
  }, [iframeRef, onCommit])

  if (!geom || geom.pageWidth === 0) {
    return <div className="h-5 shrink-0" aria-hidden />
  }

  const halfCmPx = (CM_TO_PT * PX_PER_PT) / 2
  const ticks: { x: number; label: number | null }[] = []
  for (let i = 0; i * halfCmPx <= geom.pageWidth; i++) {
    ticks.push({ x: geom.pageLeft + i * halfCmPx, label: i % 2 === 0 && i > 0 ? i / 2 : null })
  }
  const leftX = geom.pageLeft + geom.padL
  const rightX = geom.pageLeft + geom.pageWidth - geom.padR
  const cm = (px: number) => (px / PX_PER_PT / CM_TO_PT).toFixed(1)

  const markerHandlers = (side: 'left' | 'right') => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      dragSide.current = side
      dragBase.current = { pageLeft: geom.pageLeft, pageWidth: geom.pageWidth }
      // Snapshot BEFORE the live inline changes: undo restores the old margin.
      useWorkspace.getState().checkpoint('Márgenes de página')
      e.currentTarget.setPointerCapture(e.pointerId)
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      if (dragSide.current !== side || !rulerRef.current || !dragBase.current) return
      const base = dragBase.current
      const x = e.clientX - rulerRef.current.getBoundingClientRect().left
      applyPad(side, side === 'left' ? x - base.pageLeft : base.pageLeft + base.pageWidth - x)
    },
    onPointerUp: () => {
      dragSide.current = null
      dragBase.current = null
      commit()
    },
    onKeyDown: (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      e.preventDefault()
      useWorkspace.getState().checkpoint('Márgenes de página')
      // 0.25 cm per keypress; the outer edge grows the margin on each side.
      const step = (CM_TO_PT / 4) * PX_PER_PT * (e.key === 'ArrowRight' ? 1 : -1)
      const pad = side === 'left' ? geom.padL + step : geom.padR - step
      applyPad(side, pad)
      commit()
    },
  })

  const marker = (side: 'left' | 'right', x: number, padPx: number) => (
    <div
      role="slider"
      tabIndex={0}
      aria-label={side === 'left' ? 'Margen izquierdo' : 'Margen derecho'}
      aria-valuenow={Number(cm(padPx))}
      aria-valuetext={`${cm(padPx)} cm`}
      aria-valuemin={0}
      aria-valuemax={Number(cm(geom.pageWidth / 2))}
      title={`${side === 'left' ? 'Margen izquierdo' : 'Margen derecho'}: ${cm(padPx)} cm — arrastra para cambiarlo`}
      className="absolute top-0 z-10 h-0 w-0 cursor-ew-resize touch-none border-l-[7px] border-r-[7px] border-t-[10px] border-l-transparent border-r-transparent border-t-primary outline-none focus-visible:border-t-accent-sky"
      style={{ left: x - 7 }}
      {...markerHandlers(side)}
    />
  )

  return (
    <div
      ref={rulerRef}
      className="relative h-5 shrink-0 select-none overflow-hidden rounded-md border border-hairline bg-surface"
      aria-label="Regla de márgenes (centímetros)"
    >
      {/* Page area + shaded margin zones */}
      <div
        className="absolute inset-y-0 bg-canvas-soft"
        style={{ left: geom.pageLeft, width: geom.pageWidth }}
      />
      <div className="absolute inset-y-0 bg-primary/10" style={{ left: geom.pageLeft, width: geom.padL }} />
      <div
        className="absolute inset-y-0 bg-primary/10"
        style={{ left: rightX, width: geom.padR }}
      />
      {ticks.map((t, i) => (
        <div key={i} className="absolute bottom-0" style={{ left: t.x }}>
          <div className={`w-px bg-ink-faint ${t.label !== null ? 'h-2.5' : 'h-1.5'}`} />
          {t.label !== null ? (
            <span className="absolute bottom-2 left-0 -translate-x-1/2 text-[9px] leading-none text-ink-muted">
              {t.label}
            </span>
          ) : null}
        </div>
      ))}
      {marker('left', leftX, geom.padL)}
      {marker('right', rightX, geom.padR)}
    </div>
  )
}

/** Bold/italic/underline + alignment over the selection in the editor iframe,
 * plus undo/redo and the change-history panel. */
function FormatToolbar({
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
  useDialogChrome(onClose)
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

/** Popover to bind a clicked field chip to a data column. */
function BindFieldPopover({
  tag,
  columns,
  onAssign,
  onClose,
}: {
  tag: string
  columns: string[]
  onAssign: (column: string) => void
  onClose: () => void
}) {
  useDialogChrome(onClose)
  return (
    <div
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
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cerrar
        </Button>
      </div>
    </div>
  )
}
