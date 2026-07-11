// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { fingerprintCss, fingerprintHtml, hashString, normalizeBodyHtml } from './fingerprint'
import { buildNativeJobs, decideNativeRoute, tagLiterals, type SourceFileMeta } from './nativeMerge'
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

const meta = (over: Partial<SourceFileMeta> = {}): SourceFileMeta => ({
  id: 'file-id',
  fingerprint: fingerprintHtml('<p>{{TAG}}</p>'),
  cssFingerprint: fingerprintCss('p{color:red}'),
  tagLiterals: { TAG: ['{{TAG}}'] },
  ...over,
})

describe('decideNativeRoute', () => {
  it('is eligible when nothing changed (even after editor canonicalisation)', () => {
    expect(
      decideNativeRoute({ sourceFile: meta(), editorHtml: '<p>{{TAG}}</p>', editorCss: 'p{color:red}' }),
    ).toEqual({ eligible: true })
    // Same doc imported with spaced tags: the fingerprint is whitespace-canonical.
    expect(
      decideNativeRoute({
        sourceFile: meta({ fingerprint: fingerprintHtml('<p>{{ TAG }}</p>') }),
        editorHtml: '<p>{{TAG}}</p>',
        editorCss: 'p{color:red}',
      }),
    ).toEqual({ eligible: true })
  })

  it('falls back with a reason on divergence', () => {
    expect(
      decideNativeRoute({ sourceFile: null, editorHtml: '<p></p>', editorCss: '' }),
    ).toEqual({ eligible: false, reason: 'no_source' })
    expect(
      decideNativeRoute({ sourceFile: meta(), editorHtml: '<p>{{TAG}}!</p>', editorCss: 'p{color:red}' }),
    ).toEqual({ eligible: false, reason: 'edited' })
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
    const jobs = buildNativeJobs(plan, { NOMBRE: ['{{ NOMBRE }}'] })
    expect(jobs.map((j) => j.name)).toEqual(['ACME', 'Otra'])
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
