import { describe, expect, it } from 'vitest'
import { pageItemsToText } from './pdfText'

function item(str: string, x: number, y: number) {
  return { str, transform: [1, 0, 0, 1, x, y] }
}

describe('pageItemsToText', () => {
  it('rebuilds reading order top-to-bottom, left-to-right from glyph positions', () => {
    const items = [
      item('world', 60, 700),
      item('Hello', 10, 700),
      item('Second line', 10, 680),
    ]
    expect(pageItemsToText(items)).toBe('Hello world\nSecond line')
  })

  it('merges items whose baselines differ by less than the row tolerance', () => {
    const items = [item('10.65%', 10, 500), item('6.63%', 80, 500.9)]
    expect(pageItemsToText(items)).toBe('10.65% 6.63%')
  })

  it('drops empty items and collapses internal whitespace', () => {
    const items = [item('  ', 10, 400), item('a   b', 10, 390)]
    expect(pageItemsToText(items)).toBe('a b')
  })
})
