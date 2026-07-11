import { useCallback, useEffect, useRef, useState } from 'react'
import { useWorkspace } from '../state/workspaceStore'

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
export function MarginRuler({
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
