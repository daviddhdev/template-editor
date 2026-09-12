import { createServerFn } from '@tanstack/react-start'
import type { Result } from './fetch'
import { FORMAT_MIME, type GoogleFormat } from './googlePdf'
import { requireOneOf, requireRecord, requireString } from './validate'


export interface BatchFolder {
  folderId: string
  folderUrl: string
}

function asResultError(err: unknown, fallback: string): { ok: false; error: string; hint?: string } {
  const e = err as { message?: string; hint?: string }
  return { ok: false, error: e?.message || fallback, hint: e?.hint }
}

export const ensureBatchFolderFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return {
      parentFolderId: requireString(i.parentFolderId, 'parentFolderId'),
      batchName: requireString(i.batchName, 'batchName'),
    }
  })
  .handler(async ({ data }): Promise<Result<BatchFolder>> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    const g = await import('./googleClient')
    try {
      const token = await g.getAccessToken(user.id)
      if (!(await g.folderAlive(token, data.parentFolderId))) {
        return {
          ok: false,
          error: 'La carpeta de destino no existe o tu cuenta no tiene acceso a ella.',
          hint: 'Revisa la URL de la carpeta de Drive, o compártela con la cuenta conectada.',
        }
      }
      const folderId = await g.withRetry(() =>
        g.createFolder(token, data.batchName, data.parentFolderId),
      )
      return {
        ok: true,
        data: { folderId, folderUrl: `https://drive.google.com/drive/folders/${folderId}` },
      }
    } catch (err) {
      return asResultError(err, 'No se pudo preparar la carpeta de destino en Drive.')
    }
  })

export type UploadResult =
  | { ok: true; data: { fileId: string } }
  | { ok: false; error: string; hint?: string; code?: 'FOLDER_GONE' | 'AUTH' }

export const driveUploadFn = createServerFn({ method: 'POST' })
  .validator((input: unknown) => {
    const i = requireRecord(input, 'petición')
    return {
      name: requireString(i.name, 'name'),
      base64: requireString(i.base64, 'base64'),
      format: requireOneOf(i.format, ['pdf', 'docx'] as const, 'format') as GoogleFormat,
      folderId: requireString(i.folderId, 'folderId'),
    }
  })
  .handler(async ({ data }): Promise<UploadResult> => {
    const s = await import('./session')
    const user = await s.requireUser()
    if (!user) return s.AUTH_ERROR
    const g = await import('./googleClient')
    try {
      const token = await g.getAccessToken(user.id)
      const bytes = new Uint8Array(Buffer.from(data.base64, 'base64'))
      const fileId = await g.withRetry(() =>
        g.uploadBinary(token, data.name, bytes, FORMAT_MIME[data.format], data.folderId),
      )
      return { ok: true, data: { fileId } }
    } catch (err) {
      const base = asResultError(err, 'No se pudo subir el documento a Drive.')
      const code = err instanceof g.GoogleError && err.code === 'FOLDER_GONE' ? err.code : undefined
      return code ? { ...base, code } : base
    }
  })
