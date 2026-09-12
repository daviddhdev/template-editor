export function PreviewFrame({ html, className = '' }: { html: string; className?: string }) {
  return (
    <iframe
      title="Vista previa del documento"
      sandbox="allow-same-origin"
      srcDoc={html}
      className={`w-full rounded-lg border border-hairline bg-white ${className}`}
    />
  )
}
