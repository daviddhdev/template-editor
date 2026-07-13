import { useEffect, useState } from 'react'
import type { NativeJob } from '../server/googleNative'
import { generateNativePdfFn } from '../server/googleNative'
import { PreviewFrame } from './PreviewFrame'
import { Spinner } from './ui'

function pdfUrl(base64: string): string {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return URL.createObjectURL(new Blob([bytes], { type: 'application/pdf' }))
}

/**
 * Faithful preview: materialise the original document, apply safe edits and
 * data, and show Google's PDF. If that transient generation fails, retain the
 * immediate HTML preview with a visible warning instead of a blank canvas.
 */
export function NativePreviewFrame({
  sourceFileId,
  job,
  fallbackHtml,
  className = '',
}: {
  sourceFileId: string
  job: NativeJob
  fallbackHtml: string
  className?: string
}) {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; url: string }
    | { status: 'error'; message: string }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    let objectUrl: string | null = null
    setState({ status: 'loading' })
    void generateNativePdfFn({
      data: { sourceFileId, jobs: [job], formats: ['pdf'] },
    })
      .then((result) => {
        if (cancelled) return
        if (!result.ok || !result.data.files[0]) {
          setState({
            status: 'error',
            message: result.ok ? 'Google no devolvió la vista previa.' : result.error,
          })
          return
        }
        objectUrl = pdfUrl(result.data.files[0].base64)
        setState({ status: 'ready', url: objectUrl })
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: 'error', message: 'No se pudo generar la vista fiel con Google Docs.' })
        }
      })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [sourceFileId, job])

  if (state.status === 'ready') {
    return (
      <iframe
        title="Vista previa fiel del documento"
        src={state.url}
        className={`w-full rounded-lg border border-hairline bg-white ${className}`}
      />
    )
  }

  if (state.status === 'loading') {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`flex items-center justify-center rounded-lg border border-hairline bg-canvas-soft ${className}`}
      >
        <div className="rounded-xl border border-hairline bg-surface px-8 py-6 text-center shadow-e1">
          <div className="flex justify-center text-primary">
            <Spinner />
          </div>
          <p className="mt-3 text-sm font-medium text-ink-secondary">
            Generando vista fiel con Google Docs…
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            Conservando cabecera, imágenes y paginación del original.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className={`relative ${className}`}>
      <PreviewFrame html={fallbackHtml} className="h-full" />
      <p
        role="status"
        className="absolute left-1/2 top-3 z-10 -translate-x-1/2 rounded-full border border-accent-orange/30 bg-white px-3 py-1.5 text-xs text-accent-orange shadow-e1"
      >
        {state.message} Mostrando la vista aproximada.
      </p>
    </div>
  )
}
