import { describe, expect, it } from 'vitest'
import { canonicalPickedUrl, type PickedFile } from './googlePicker'
import { extractGoogleFolderId, extractGoogleId } from './url'

// The picker plugs into the same load path as a pasted link, so every
// canonical URL must round-trip through the URL parsers the app already uses.
describe('canonicalPickedUrl', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'
  const file = (mimeType: string): PickedFile => ({ id, name: 'Archivo', mimeType })

  it('native Google Doc → docs.google.com editor URL', () => {
    const url = canonicalPickedUrl('document', file('application/vnd.google-apps.document'))
    expect(url).toBe(`https://docs.google.com/document/d/${id}/edit`)
    expect(extractGoogleId(url)).toBe(id)
  })

  it('.docx stored in Drive → drive.google.com file URL', () => {
    const url = canonicalPickedUrl(
      'document',
      file('application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
    )
    expect(url).toBe(`https://drive.google.com/file/d/${id}/view`)
    expect(extractGoogleId(url)).toBe(id)
  })

  it('spreadsheet → sheets editor URL without gid (first tab)', () => {
    const url = canonicalPickedUrl('spreadsheet', file('application/vnd.google-apps.spreadsheet'))
    expect(url).toBe(`https://docs.google.com/spreadsheets/d/${id}/edit`)
    expect(extractGoogleId(url)).toBe(id)
    expect(url).not.toContain('gid=')
  })

  it('folder → drive folder URL', () => {
    const url = canonicalPickedUrl('folder', file('application/vnd.google-apps.folder'))
    expect(url).toBe(`https://drive.google.com/drive/folders/${id}`)
    expect(extractGoogleFolderId(url)).toBe(id)
  })
})
