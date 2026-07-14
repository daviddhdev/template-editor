// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fingerprintCss, fingerprintHtml, hashString, normalizeBodyHtml } from './fingerprint'
import {
  buildNativeJobs,
  decideNativeRoute,
  nativeTextSegments,
  extractNativeFieldStyles,
  sourceFieldOccurrences,
  tagLiterals,
  upgradeSourceFileMeta,
  type SourceFileMeta,
} from './nativeMerge'
import type { GenerationPlan } from '../types'

describe('hashString', () => {
  it('is deterministic and collision-free for near-identical inputs', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
    expect(hashString('')).toHaveLength(16)
  })
})

describe('normalizeBodyHtml', () => {
  it('is idempotent', () => {
    const html = '<p class="a">Hola {{ NOMBRE }} y {{OTRO}}</p><table><tr><td>x</td></tr></table>'
    const once = normalizeBodyHtml(html)
    expect(normalizeBodyHtml(once)).toBe(once)
  })

  it('canonicalises tag whitespace the way the editor does', () => {
    expect(normalizeBodyHtml('<p>{{ TAG }}</p>')).toBe(normalizeBodyHtml('<p>{{TAG}}</p>'))
  })

  it('still detects real text edits', () => {
    expect(fingerprintHtml('<p>Hola</p>')).not.toBe(fingerprintHtml('<p>Hola!</p>'))
  })
})

describe('tagLiterals', () => {
  it('captures exact literals including internal whitespace and NBSP', () => {
    const html = '<p><span>{{ RAZON&nbsp;SOCIAL }}</span> y {{NIF}} otra vez {{ NIF }}</p>'
    const lits = tagLiterals(html)
    expect(lits['RAZON SOCIAL']).toEqual(['{{ RAZON SOCIAL }}'])
    expect(lits['NIF']).toEqual(['{{NIF}}', '{{ NIF }}'])
  })

  it('captures a tag split across inline spans as one literal', () => {
    const lits = tagLiterals('<p>{{<span>NOMBRE</span>}}</p>')
    expect(lits['NOMBRE']).toEqual(['{{NOMBRE}}'])
  })
})

describe('native field styles', () => {
  it('extracts occurrence-specific wrappers and restores comparable HTML', () => {
    const html = '<p>{{TAG}} y <span data-ttg-field-style style="font-size:14pt;color:#aabbcc">{{TAG}}</span></p>'
    expect(extractNativeFieldStyles(html)).toEqual({
      html: '<p>{{TAG}} y {{TAG}}</p>',
      styles: [{ tag: 'TAG', occurrence: 1, fontSizePt: 14, colorHex: '#AABBCC' }],
    })
    expect(sourceFieldOccurrences('<p>{{ TAG }} {{TAG}}</p>')).toEqual([
      { tag: 'TAG', literal: '{{ TAG }}', occurrence: 0 },
      { tag: 'TAG', literal: '{{TAG}}', occurrence: 1 },
    ])
  })

  it('rejects wrappers containing unrelated formatting', () => {
    expect(extractNativeFieldStyles('<p><span data-ttg-field-style style="font-weight:bold">{{TAG}}</span></p>')).toBeNull()
  })

  it('keeps the native route for a supported field style', () => {
    const source = '<p>{{TAG}} y {{TAG}}</p>'
    const decision = decideNativeRoute({
      sourceFile: meta({ fingerprint: fingerprintHtml(source), textSegments: nativeTextSegments(source) }),
      editorHtml: '<p><span data-ttg-field-style style="color:#123456">{{TAG}}</span> y {{TAG}}</p>',
      editorCss: 'p{color:red}',
    })
    expect(decision).toEqual({
      eligible: true,
      edits: [],
      styles: [{ tag: 'TAG', occurrence: 0, colorHex: '#123456' }],
    })
  })
})

describe('nativeTextSegments', () => {
  it('stores a compact structure hash instead of duplicating inline image data', () => {
    const [segment] = nativeTextSegments(
      `<p>Texto<img src="data:image/png;base64,${'A'.repeat(10_000)}"></p>`,
    )
    expect(segment.text).toBe('Texto')
    expect(segment.structure).toMatch(/^[0-9a-f]{16}$/)
  })
})

describe('upgradeSourceFileMeta', () => {
  it('upgrades an unchanged old recipe but never blesses already-edited HTML', () => {
    const old = meta({ textSegments: undefined })
    expect(upgradeSourceFileMeta(old, '<p>{{TAG}}</p>')?.textSegments).toHaveLength(1)
    expect(upgradeSourceFileMeta(old, '<p>{{TAG}} cambiado</p>')?.textSegments).toBeUndefined()
  })
})

const meta = (over: Partial<SourceFileMeta> = {}): SourceFileMeta => ({
  id: 'file-id',
  fingerprint: fingerprintHtml('<p>{{TAG}}</p>'),
  cssFingerprint: fingerprintCss('p{color:red}'),
  tagLiterals: { TAG: ['{{TAG}}'] },
  textSegments: nativeTextSegments('<p>{{TAG}}</p>'),
  ...over,
})

describe('decideNativeRoute', () => {
  it('is eligible when nothing changed (even after editor canonicalisation)', () => {
    expect(
      decideNativeRoute({ sourceFile: meta(), editorHtml: '<p>{{TAG}}</p>', editorCss: 'p{color:red}' }),
    ).toEqual({ eligible: true, edits: [] })
    // Same doc imported with spaced tags: the fingerprint is whitespace-canonical.
    expect(
      decideNativeRoute({
        sourceFile: meta({ fingerprint: fingerprintHtml('<p>{{ TAG }}</p>') }),
        editorHtml: '<p>{{TAG}}</p>',
        editorCss: 'p{color:red}',
      }),
    ).toEqual({ eligible: true, edits: [] })
  })

  it('falls back with a reason on divergence', () => {
    expect(
      decideNativeRoute({ sourceFile: null, editorHtml: '<p></p>', editorCss: '' }),
    ).toEqual({ eligible: false, reason: 'no_source' })
    expect(
      decideNativeRoute({ sourceFile: meta(), editorHtml: '<p>{{TAG}}!</p>', editorCss: 'p{color:red}' }),
    ).toEqual({ eligible: true, edits: [{ find: '}}', replace: '}}!' }] })
    expect(
      decideNativeRoute({
        sourceFile: meta(),
        editorHtml: '<p><span class="ttg-chip">{{TAG}}</span></p>',
        editorCss: 'p{color:red}',
      }),
    ).toEqual({ eligible: false, reason: 'inline_blocks' })
    expect(
      decideNativeRoute({
        sourceFile: meta(),
        editorHtml: '<p>{{TAG}}</p>',
        editorCss: 'p{color:red}\n/*ttg-margins*/body{padding-left:10pt !important;}',
      }),
    ).toEqual({ eligible: false, reason: 'css_changed' })
  })

  it('falls back only while an anchored rule contains explicit rich formatting', () => {
    const plainRule = {
      id: 'r',
      label: 'R',
      branches: [],
      defaultText: 'Texto',
    }
    const base = { sourceFile: meta(), editorHtml: '<p>{{TAG}}</p>', editorCss: 'p{color:red}' }
    expect(
      decideNativeRoute({
        ...base,
        ruleBindings: { TAG: { rule: plainRule, perRow: false } },
      }),
    ).toEqual({ eligible: true, edits: [] })
    expect(
      decideNativeRoute({
        ...base,
        ruleBindings: {
          TAG: {
            rule: {
              ...plainRule,
              defaultTextHtml: '<p><span style="font-weight:bold">Texto</span></p>',
            },
            perRow: false,
          },
        },
      }),
    ).toEqual({ eligible: false, reason: 'formatted_rule' })
  })

  it('keeps native output for unique text edits inside the same element', () => {
    expect(
      decideNativeRoute({
        sourceFile: meta({
          fingerprint: fingerprintHtml('<p>Texto original {{TAG}}</p>'),
          textSegments: nativeTextSegments('<p>Texto original {{TAG}}</p>'),
        }),
        editorHtml: '<p>Texto corregido {{TAG}}</p>',
        editorCss: 'p{color:red}',
      }),
    ).toEqual({
      eligible: true,
      edits: [{ find: 'original', replace: 'corregido' }],
    })
  })

  it('does not rebuild or target an unchanged positioned header when the body is edited', () => {
    const before =
      '<div style="position:relative"><p>Cabecera</p><img src="logo.png" style="position:absolute;right:0"></div><p>Texto anterior</p>'
    const after =
      '<div style="position:relative"><p>Cabecera</p><img src="logo.png" style="position:absolute;right:0"></div><p>Texto nuevo</p>'
    const decision = decideNativeRoute({
      sourceFile: meta({
        fingerprint: fingerprintHtml(before),
        textSegments: nativeTextSegments(normalizeBodyHtml(before)),
      }),
      editorHtml: after,
      editorCss: 'p{color:red}',
    })
    expect(decision).toEqual({
      eligible: true,
      edits: [{ find: 'anterior', replace: 'nuevo' }],
    })
    expect(JSON.stringify(decision)).not.toContain('logo.png')
  })

  it('falls back for formatting, structural and ambiguous repeated-text edits', () => {
    const source = '<p>Repetido</p><p>Repetido</p>'
    expect(
      decideNativeRoute({
        sourceFile: meta({
          fingerprint: fingerprintHtml('<p>Hola</p>'),
          textSegments: nativeTextSegments('<p>Hola</p>'),
        }),
        editorHtml: '<p><strong>Hola</strong></p>',
        editorCss: 'p{color:red}',
      }),
    ).toEqual({ eligible: false, reason: 'edited' })
    expect(
      decideNativeRoute({
        sourceFile: meta({
          fingerprint: fingerprintHtml('<p>Hola</p>'),
          textSegments: nativeTextSegments('<p>Hola</p>'),
        }),
        editorHtml: '<p>Hola</p><p>Nuevo</p>',
        editorCss: 'p{color:red}',
      }),
    ).toEqual({ eligible: false, reason: 'edited' })
    expect(
      decideNativeRoute({
        sourceFile: meta({
          fingerprint: fingerprintHtml(source),
          textSegments: nativeTextSegments(source),
        }),
        editorHtml: '<p>Cambiado</p><p>Repetido</p>',
        editorCss: 'p{color:red}',
      }),
    ).toEqual({ eligible: false, reason: 'edited' })
  })
})

describe('buildNativeJobs', () => {
  const plan: GenerationPlan = {
    template: {
      sourceUrl: '',
      title: 't',
      css: '',
      bodyClass: '',
      blocks: [],
      tags: ['NOMBRE', 'NIF'],
    },
    data: {
      kind: 'google_sheet',
      origin: '',
      columns: ['Empresa', 'Nombre', 'Nif'],
      rows: [
        { Empresa: 'ACME', Nombre: 'Ana', Nif: '1A' },
        { Empresa: 'ACME', Nombre: 'Luis', Nif: '2B' },
        { Empresa: 'Otra', Nombre: 'Eva', Nif: '3C' },
      ],
    },
    mapping: { NOMBRE: 'Nombre', NIF: 'Nif' },
    ruleBindings: {},
    group: { mode: 'per_group', groupByColumn: 'Empresa' },
  }

  it('builds one job per group, first-row values, literal + canonical finds', () => {
    const edits = [{ find: 'Antes', replace: 'Después' }]
    const jobs = buildNativeJobs(plan, { NOMBRE: ['{{ NOMBRE }}'] }, edits)
    expect(jobs.map((j) => j.name)).toEqual(['ACME', 'Otra'])
    expect(jobs[0].edits).toEqual(edits)
    const nombre = jobs[0].replacements.find((r) => r.tag === 'NOMBRE')!
    expect(nombre.replace).toBe('Ana')
    expect(nombre.finds).toEqual(['{{ NOMBRE }}', '{{NOMBRE}}'])
    const nif = jobs[1].replacements.find((r) => r.tag === 'NIF')!
    expect(nif.replace).toBe('3C')
    expect(nif.finds).toEqual(['{{NIF}}', '{{ NIF }}'])
  })

  it('substitutes empty string for unmapped tags', () => {
    const jobs = buildNativeJobs({ ...plan, mapping: { NOMBRE: 'Nombre', NIF: null } }, {})
    expect(jobs[0].replacements.find((r) => r.tag === 'NIF')!.replace).toBe('')
  })

  it('applies per-tag display formats to the replacement text', () => {
    const jobs = buildNativeJobs({ ...plan, tagFormats: { NOMBRE: 'mayusculas' } }, {})
    expect(jobs[0].replacements.find((r) => r.tag === 'NOMBRE')!.replace).toBe('ANA')
  })

  it('resolves rule-bound tags: conditional once per doc, repeat once per row', () => {
    const rule = {
      id: 'r',
      label: 'Persona',
      branches: [
        { id: 'b', column: 'Nif', operator: 'contains' as const, value: 'A', text: 'DNI de {{NOMBRE}}' },
      ],
      defaultText: '{{NOMBRE}} sin DNI',
    }
    const withRules = {
      ...plan,
      template: { ...plan.template, tags: ['NOMBRE', 'SECCION', 'AVISO'] },
      ruleBindings: { SECCION: { rule, perRow: true }, AVISO: { rule, perRow: false } },
    }
    const jobs = buildNativeJobs(withRules, {})
    const acme = jobs[0].replacements
    expect(acme.find((r) => r.tag === 'AVISO')!.replace).toBe('DNI de Ana')
    expect(acme.find((r) => r.tag === 'SECCION')!.replace).toBe('DNI de Ana\n\nLuis sin DNI')
    expect(acme.find((r) => r.tag === 'NOMBRE')!.replace).toBe('Ana')
  })
})
