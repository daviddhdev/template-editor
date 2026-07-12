/**
 * Pure mapping from the generate dialog's per-document progress to the audit
 * record stored in generation_runs.docs. Structural input type so the dialog's
 * private DocProgress is assignable without importing it.
 */

export interface GenerationDoc {
  name: string
  status: 'ok' | 'error' | 'pending'
  /** True when the document was produced through the HTML fallback route. */
  viaHtml?: boolean
  /** Present only when a Drive upload finished (or failed). */
  uploaded?: 'done' | 'error'
}

interface DocProgressLike {
  name: string
  status: 'pending' | 'running' | 'done' | 'error'
  viaHtml?: boolean
  upload?: { status: 'uploading' | 'done' | 'error' }
}

export function toGenerationDocs(docs: DocProgressLike[]): GenerationDoc[] {
  return docs.map((d) => {
    const doc: GenerationDoc = {
      name: d.name,
      // 'running' can only be observed if the batch was interrupted mid-doc.
      status: d.status === 'done' ? 'ok' : d.status === 'error' ? 'error' : 'pending',
    }
    if (d.viaHtml) doc.viaHtml = true
    if (d.upload?.status === 'done' || d.upload?.status === 'error') {
      doc.uploaded = d.upload.status
    }
    return doc
  })
}

export function countDocs(docs: GenerationDoc[]): { ok: number; error: number; pending: number } {
  const counts = { ok: 0, error: 0, pending: 0 }
  for (const d of docs) counts[d.status]++
  return counts
}
