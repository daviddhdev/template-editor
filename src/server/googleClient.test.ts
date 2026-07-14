import { describe, expect, it } from 'vitest'
import { docsTextSegments, locateFieldStyleRanges } from './googleClient'

const document = {
  body: {
    content: [
      { paragraph: { elements: [
        { startIndex: 1, textRun: { content: 'Primero {{TA' } },
        { startIndex: 13, textRun: { content: 'G}} y {{TAG}}\n' } },
      ] } },
    ],
  },
  headers: {
    headerA: { content: [{ paragraph: { elements: [{ startIndex: 1, textRun: { content: '{{TAG}}\n' } }] } }] },
  },
  footers: {
    footerA: { content: [{ paragraph: { elements: [{ startIndex: 1, textRun: { content: '{{TAG}}\n' } }] } }] },
  },
}

describe('Google Docs field style ranges', () => {
  it('flattens body, header and footer text runs with segment IDs', () => {
    expect(docsTextSegments(document).map((s) => s.segmentId)).toEqual([undefined, 'headerA', 'footerA'])
  })

  it('finds tags split across runs and selects the requested occurrence', () => {
    expect(locateFieldStyleRanges(
      document,
      [
        { tag: 'TAG', occurrence: 0, fontSizePt: 14 },
        { tag: 'TAG', occurrence: 2, colorHex: '#123456' },
        { tag: 'TAG', occurrence: 3, colorHex: '#654321' },
      ],
      [{ tag: 'TAG', finds: ['{{TAG}}'] }],
    )).toEqual([
      { tag: 'TAG', startIndex: 9, endIndex: 16, segmentId: undefined, tabId: undefined, fontSizePt: 14, colorHex: undefined },
      { tag: 'TAG', startIndex: 1, endIndex: 8, segmentId: 'headerA', tabId: undefined, fontSizePt: undefined, colorHex: '#123456' },
      { tag: 'TAG', startIndex: 1, endIndex: 8, segmentId: 'footerA', tabId: undefined, fontSizePt: undefined, colorHex: '#654321' },
    ])
  })

  it('returns null instead of styling a different occurrence', () => {
    expect(locateFieldStyleRanges(document, [{ tag: 'TAG', occurrence: 9, colorHex: '#000000' }], [{ tag: 'TAG', finds: ['{{TAG}}'] }])).toBeNull()
  })
})
