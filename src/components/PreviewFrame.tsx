/**
 * Renders resolved document HTML inside a sandboxed iframe. Because we feed it
 * the exact same HTML the PDF is made from, what the user sees here is what the
 * PDF will contain.
 */
export function PreviewFrame({ html, className = '' }: { html: string; className?: string }) {
  return (
    <iframe
      title="Vista previa del documento"
      // Allow same-origin so the document's own CSS applies; no scripts.
      sandbox="allow-same-origin"
      srcDoc={html}
      className={`w-full rounded-lg border border-hairline bg-white ${className}`}
    />
  )
}
