/** Browser-side helpers to turn base64 payloads into file downloads. */

function base64ToBlob(base64: string, mime: string): Blob {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new Blob([bytes], { type: mime })
}

function triggerDownload(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Revoke on the next tick so the download has started.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
}

/** Download a generated document; MIME derived from the file extension. */
export function downloadDocument(fileName: string, base64: string): void {
  const ext = fileName.split('.').pop()?.toLowerCase() ?? ''
  triggerDownload(base64ToBlob(base64, MIME_BY_EXT[ext] ?? 'application/octet-stream'), fileName)
}

export function downloadZip(fileName: string, base64: string): void {
  triggerDownload(base64ToBlob(base64, 'application/zip'), fileName)
}
