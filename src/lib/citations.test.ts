import { describe, expect, it } from 'vitest'
import { citationAnchor, linkifyCitations, pageLabel, sourceTitle } from './citations'

describe('linkifyCitations', () => {
  it('turns in-range [n] markers into markdown links to the source anchor', () => {
    const out = linkifyCitations('Rent is $1,200 [1]. Ends in June [2].', 2, 'turn-a')
    expect(out).toBe(
      'Rent is $1,200 [\\[1\\]](#src-turn-a-1). Ends in June [\\[2\\]](#src-turn-a-2).',
    )
  })

  it('leaves markers that exceed the source count untouched', () => {
    expect(linkifyCitations('See [3].', 2, 't')).toBe('See [3].')
  })

  it('expands comma-separated markers like [1, 2]', () => {
    expect(linkifyCitations('Both [1, 2].', 2, 't')).toBe(
      'Both [\\[1\\]](#src-t-1)[\\[2\\]](#src-t-2).',
    )
  })
})

describe('citationAnchor', () => {
  it('builds the same id the links point at', () => {
    expect(citationAnchor('turn-a', 1)).toBe('src-turn-a-1')
  })
})

describe('pageLabel', () => {
  it('renders a single page, a page range, or nothing', () => {
    expect(pageLabel({ pageStart: 3, pageEnd: 3 })).toBe('p. 3')
    expect(pageLabel({ pageStart: 3, pageEnd: 4 })).toBe('pp. 3–4')
    expect(pageLabel({})).toBe('')
  })
})

describe('linkifyCitations with source titles', () => {
  it('attaches a title so the chip can say which file and page it points at', () => {
    const out = linkifyCitations('Rent is $1,200 [1].', 1, 't', ['lease.pdf, p. 2'])
    expect(out).toBe('Rent is $1,200 [\\[1\\]](#src-t-1 "lease.pdf, p. 2").')
  })
})

describe('sourceTitle', () => {
  it('names the file and page for tooltips and exports', () => {
    expect(sourceTitle({ documentName: 'lease.pdf', pageStart: 2, pageEnd: 2 })).toBe('lease.pdf, p. 2')
    expect(sourceTitle({ documentName: 'lease.pdf' })).toBe('lease.pdf')
  })
})
