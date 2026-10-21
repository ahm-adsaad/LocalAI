import { describe, expect, it } from 'vitest'
import { chunkPages, chunkText, proseDensity } from './chunking'

describe('chunkText', () => {
  it('returns a single chunk when text fits the size budget', () => {
    expect(chunkText('short text', 100, 10)).toEqual(['short text'])
  })

  it('returns no chunks for whitespace-only input', () => {
    expect(chunkText('  \n\n  ')).toEqual([])
  })

  it('keeps paragraphs together instead of cutting mid-paragraph', () => {
    const p1 = 'First paragraph with enough words to matter.'
    const p2 = 'Second paragraph that stands on its own.'
    const chunks = chunkText(`${p1}\n\n${p2}`, 60, 10)
    expect(chunks).toEqual([p1, p2])
  })

  it('splits an oversized paragraph with a sliding window and overlap', () => {
    const long = 'x'.repeat(250)
    const chunks = chunkText(long, 100, 20)
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(100)
    expect(chunks[1]!.length).toBe(100)
  })
})

describe('proseDensity', () => {
  it('is 1 for pure prose and 0 for number soup', () => {
    expect(proseDensity('plain english words')).toBe(1)
    expect(proseDensity('10.65% 6.63% 9.30%')).toBe(0)
  })
})

describe('chunkPages', () => {
  const p1 = 'Page one paragraph.'
  const p2 = 'Page two paragraph.'
  const p3 = 'Page three paragraph.'

  it('tags each chunk with the 1-based page range it was cut from', () => {
    // 45 chars fits p1+p2 (39 with the newline) but not p3 as well.
    expect(chunkPages([p1, p2, p3], 45, 5)).toEqual([
      { text: `${p1}\n${p2}`, pageStart: 1, pageEnd: 2 },
      { text: p3, pageStart: 3, pageEnd: 3 },
    ])
  })

  it('produces exactly the chunks chunkText produces on the joined text', () => {
    const pages = [p1, `${p2}\n\n${p3}`, '', p1]
    const texts = chunkPages(pages, 45, 5).map((c) => c.text)
    expect(texts).toEqual(chunkText(pages.join('\n\n'), 45, 5))
  })

  it('locates a chunk on the page after a blank page', () => {
    const out = chunkPages([p1, '', p3], 30, 5)
    expect(out.map((c) => [c.pageStart, c.pageEnd])).toEqual([
      [1, 1],
      [3, 3],
    ])
  })
})
