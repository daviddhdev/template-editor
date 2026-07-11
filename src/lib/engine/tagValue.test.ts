import { describe, expect, it } from 'vitest'
import { resolveBoundTag, resolveRuleText, substitutePlainTags } from './tagValue'
import type { ConditionalRule, RuleBindings } from '../../types'

const opts = { mapping: { NOMBRE: 'Nombre', NIF: 'Nif', SUELTO: null }, onMissing: 'empty' as const }

const rule: ConditionalRule = {
  id: 'r1',
  label: 'Tipo persona',
  branches: [
    { id: 'b1', column: 'Tipo', operator: 'equals', value: 'PJ', text: 'La sociedad {{NOMBRE}} con NIF {{NIF}}.' },
    { id: 'b2', column: 'Tipo', operator: 'contains', value: 'PF', text: '{{NOMBRE}}, mayor de edad.' },
  ],
  defaultText: 'Sin tipo: {{NOMBRE}}.',
}

describe('substitutePlainTags', () => {
  it('substitutes mapped tags, tolerating {{ spaces }}', () => {
    expect(substitutePlainTags('Hola {{ NOMBRE }} ({{NIF}})', { Nombre: 'Ana', Nif: '1A' }, opts)).toBe(
      'Hola Ana (1A)',
    )
  })
  it('renders unmapped tags per onMissing', () => {
    expect(substitutePlainTags('x{{SUELTO}}y', {}, opts)).toBe('xy')
    expect(substitutePlainTags('x{{SUELTO}}y', {}, { ...opts, onMissing: 'placeholder' })).toBe('x[SUELTO]y')
  })
})

describe('resolveRuleText', () => {
  it('picks the first matching branch and substitutes its tags', () => {
    expect(resolveRuleText(rule, { Tipo: 'pj', Nombre: 'ACME SL', Nif: 'B1' }, opts)).toBe(
      'La sociedad ACME SL con NIF B1.',
    )
    expect(resolveRuleText(rule, { Tipo: 'PF casado', Nombre: 'Ana', Nif: '' }, opts)).toBe(
      'Ana, mayor de edad.',
    )
  })
  it('falls back to defaultText, empty when neither', () => {
    expect(resolveRuleText(rule, { Tipo: 'otro', Nombre: 'Eva' }, opts)).toBe('Sin tipo: Eva.')
    expect(resolveRuleText({ ...rule, defaultText: '' }, { Tipo: 'otro' }, opts)).toBe('')
  })
})

describe('resolveBoundTag', () => {
  const bindings: RuleBindings = {
    SECCION: { rule, perRow: true },
    AVISO: { rule, perRow: false },
  }
  const rows = [
    { Tipo: 'PJ', Nombre: 'ACME SL', Nif: 'B1' },
    { Tipo: 'otro', Nombre: 'Eva', Nif: '' },
    { Tipo: 'PF', Nombre: 'Luis', Nif: '' },
  ]

  it('returns null for tags without a rule binding', () => {
    expect(resolveBoundTag('NOMBRE', rows, bindings, opts)).toBeNull()
  })
  it('perRow joins one resolved text per row with blank lines', () => {
    expect(resolveBoundTag('SECCION', rows, bindings, opts)).toBe(
      'La sociedad ACME SL con NIF B1.\n\nSin tipo: Eva.\n\nLuis, mayor de edad.',
    )
  })
  it('perRow skips rows resolving to empty text', () => {
    const silent: RuleBindings = { S: { rule: { ...rule, defaultText: '' }, perRow: true } }
    expect(resolveBoundTag('S', rows, silent, opts)).toBe(
      'La sociedad ACME SL con NIF B1.\n\nLuis, mayor de edad.',
    )
  })
  it('per-document rules use the first row only', () => {
    expect(resolveBoundTag('AVISO', rows, bindings, opts)).toBe('La sociedad ACME SL con NIF B1.')
    expect(resolveBoundTag('AVISO', [], bindings, opts)).toBe('Sin tipo: .')
  })
})
