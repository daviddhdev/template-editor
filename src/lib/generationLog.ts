
export interface GenerationDoc {
  name: string
  status: 'ok' | 'error' | 'pending'
  viaHtml?: boolean
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
