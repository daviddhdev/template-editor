// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ConditionalRule } from '../types'
import { CondEditor, type RichTextSelection } from './CondEditor'

const initial: ConditionalRule = {
  id: 'r',
  label: 'Aviso',
  branches: [
    {
      id: 'b',
      column: 'Provincia',
      operator: 'equals',
      value: 'Madrid',
      text: 'Hola {{NOMBRE}}',
    },
  ],
  defaultText: '',
  textStyle: { fontFamily: 'Arial', fontSize: '11pt' },
}

afterEach(cleanup)

describe('CondEditor rich fields', () => {
  it('publishes its selection and saves the canonical plain/rich pair', () => {
    const onSave = vi.fn()
    const selections: RichTextSelection[] = []
    render(
      <CondEditor
        initial={initial}
        columns={['Provincia', 'NOMBRE']}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={vi.fn()}
        onRichSelection={(selection) => selection && selections.push(selection)}
      />,
    )

    const field = screen.getByRole('textbox', { name: 'Texto a mostrar cuando se cumpla' })
    expect(field.tagName).toBe('DIV')
    expect(field.getAttribute('contenteditable')).toBe('true')
    expect((field as HTMLElement).style.fontFamily).toBe('Arial')

    const text = field.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.selectNodeContents(text)
    const selection = window.getSelection()!
    selection.removeAllRanges()
    selection.addRange(range)
    fireEvent.mouseUp(field)
    expect(selections.at(-1)?.element).toBe(field)

    // This mirrors the top toolbar: execCommand mutates the active DOM and
    // then calls sync so the dialog's local rule state follows it.
    field.innerHTML = '<p style="text-align:center"><b>Hola {{NOMBRE}}</b></p>'
    act(() => selections.at(-1)!.sync())
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }))

    const saved = onSave.mock.calls[0][0] as ConditionalRule
    expect(saved.branches[0].text).toBe('Hola {{NOMBRE}}')
    expect(saved.branches[0].textHtml).toBe(
      '<p style="text-align:center"><span style="font-weight:bold">Hola {{NOMBRE}}</span></p>',
    )
  })

  it('does not persist local rich edits when cancelled', () => {
    const onSave = vi.fn()
    const onClose = vi.fn()
    render(
      <CondEditor
        initial={initial}
        columns={['Provincia']}
        onSave={onSave}
        onDelete={vi.fn()}
        onClose={onClose}
      />,
    )
    const field = screen.getByRole('textbox', { name: 'Texto a mostrar cuando se cumpla' })
    field.innerHTML = '<p><b>Cambio local</b></p>'
    fireEvent.input(field)
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }))
    expect(onSave).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('inserts pasted content through the plain-text path', () => {
    const execCommand = vi.fn()
    Object.defineProperty(document, 'execCommand', {
      configurable: true,
      value: execCommand,
    })
    render(
      <CondEditor
        initial={initial}
        columns={['Provincia']}
        onSave={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    )
    const field = screen.getByRole('textbox', { name: 'Texto a mostrar cuando se cumpla' })
    fireEvent.paste(field, {
      clipboardData: {
        getData: (type: string) => (type === 'text/plain' ? '<b>solo texto</b>' : '<b>html</b>'),
      },
    })
    expect(execCommand).toHaveBeenCalledWith('insertText', false, '<b>solo texto</b>')
    Reflect.deleteProperty(document, 'execCommand')
  })
})
