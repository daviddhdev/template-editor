import { describe, expect, it } from 'vitest'
import { extractGoogleFolderId } from './url'

describe('extractGoogleFolderId', () => {
  const id = '1AbCdEfGhIjKlMnOpQrStUvWxYz012345'

  it('extracts from a plain folder link', () => {
    expect(extractGoogleFolderId(`https://drive.google.com/drive/folders/${id}`)).toBe(id)
  })

  it('extracts from account-scoped and shared links', () => {
    expect(extractGoogleFolderId(`https://drive.google.com/drive/u/0/folders/${id}`)).toBe(id)
    expect(extractGoogleFolderId(`https://drive.google.com/drive/folders/${id}?usp=sharing`)).toBe(id)
  })

  it('accepts a bare id', () => {
    expect(extractGoogleFolderId(`  ${id}  `)).toBe(id)
  })

  it('rejects non-folder links and garbage', () => {
    expect(extractGoogleFolderId('https://docs.google.com/document/d/' + id + '/edit')).toBe(null)
    expect(extractGoogleFolderId('not a url')).toBe(null)
    expect(extractGoogleFolderId('')).toBe(null)
  })
})
