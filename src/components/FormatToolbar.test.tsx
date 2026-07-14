// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FormatToolbar } from './FormatToolbar'

describe('FormatToolbar appearance controls', () => {
  it('applies a free font size and a template colour', () => {
    const onFontSize = vi.fn()
    const onColor = vi.fn()
    render(
      <FormatToolbar
        fmt={{}}
        textStyle={{ fontSizePt: 11, colorHex: '#000000' }}
        templateColors={['#000000', '#AA0000']}
        onCommand={() => undefined}
        onFontSize={onFontSize}
        onColor={onColor}
      />,
    )

    const size = screen.getByLabelText('Tamaño de fuente en puntos')
    fireEvent.change(size, { target: { value: '18.5' } })
    expect(onFontSize).toHaveBeenCalledWith(18.5)

    fireEvent.click(screen.getByRole('button', { name: 'Color del texto' }))
    fireEvent.click(screen.getByRole('button', { name: 'Color #AA0000' }))
    expect(onColor).toHaveBeenCalledWith('#AA0000')
  })
})
