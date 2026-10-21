import { describe, expect, it } from 'vitest'
import { applyFocus, focusPairs, sentenceEndAt, sentenceSpans } from './focus'
import type { RankedChunk } from './types'

const chunk = (id: string, text: string): RankedChunk => ({
  id,
  documentId: 'd',
  documentName: 'd.pdf',
  text,
  score: 1,
})

describe('sentenceSpans', () => {
  it('splits on line breaks and sentence ends and keeps character offsets', () => {
    const spans = sentenceSpans('Current medications\nLisinopril 10 mg, for hypertension. Started in 2024.')
    expect(spans.map((s) => s.text)).toEqual([
      'Current medications',
      'Lisinopril 10 mg, for hypertension.',
      'Started in 2024.',
    ])
    expect(spans.map((s) => s.start)).toEqual([0, 20, 56])
  })
})

describe('focusPairs', () => {
  it('pairs the question with every sentence of sources that exceed the budget only', () => {
    const long = chunk('a', 'One sentence here. Another sentence there.')
    const short = chunk('b', 'Fits.')
    const { pairs, spans } = focusPairs('q?', [long, short], 30)
    expect(pairs).toEqual([
      { query: 'q?', text: 'One sentence here.' },
      { query: 'q?', text: 'Another sentence there.' },
    ])
    expect(spans).toEqual([
      { source: 0, start: 0 },
      { source: 0, start: 19 },
    ])
  })
})

describe('applyFocus', () => {
  it('anchors each clipped source at its best-scoring sentence and leaves the rest untouched', () => {
    const long = chunk('a', 'One sentence here. Another sentence there.')
    const short = chunk('b', 'Fits.')
    const spans = [
      { source: 0, start: 0 },
      { source: 0, start: 19 },
    ]
    const out = applyFocus([long, short], spans, [-2.5, 1.5])
    expect(out[0]!.focusStart).toBe(19)
    expect(out[1]!.focusStart).toBeUndefined()
  })
})

describe('sentenceSpans on PDF text', () => {
  it('joins lines that wrap mid-sentence and splits only at punctuation or heading-sized lines', () => {
    const text = [
      'Maintain the reduced-sodium diet discussed in September. A flu vaccine',
      'was administered at this visit in the left deltoid, lot number FL24-0931. The tetanus booster is due in',
      '2027.',
      'Follow-up',
      'Next appointment: 16 September 2025 with Dr. Natarajan.',
    ].join('\n')
    const spans = sentenceSpans(text)
    expect(spans.map((s) => s.text)).toEqual([
      'Maintain the reduced-sodium diet discussed in September.',
      'A flu vaccine was administered at this visit in the left deltoid, lot number FL24-0931.',
      'The tetanus booster is due in 2027.',
      'Follow-up',
      'Next appointment: 16 September 2025 with Dr. Natarajan.',
    ])
    expect(spans[1]!.start).toBe(text.indexOf('A flu vaccine'))
    expect(spans[2]!.start).toBe(text.indexOf('The tetanus'))
    expect(spans[3]!.start).toBe(text.indexOf('Follow-up'))
  })
})

describe('sentenceSpans edge cases', () => {
  it('does not split after abbreviations in brackets or quotes, or inside dotted tokens', () => {
    expect(sentenceSpans('Use tools (e.g. hammers) often. Next.').map((s) => s.text)).toEqual([
      'Use tools (e.g. hammers) often.',
      'Next.',
    ])
    expect(sentenceSpans('He said "Dr. Lee is in." Then left.').map((s) => s.text)).toEqual([
      'He said "Dr. Lee is in."',
      'Then left.',
    ])
    expect(sentenceSpans('Based in the U.S. since 2020. Next.').map((s) => s.text)).toEqual([
      'Based in the U.S. since 2020.',
      'Next.',
    ])
  })

  it('keeps numbered list markers with their items but still ends a sentence on "no."', () => {
    expect(sentenceSpans('Steps:\n10. Open the valve slowly. 11. Close it.').map((s) => s.text)).toEqual([
      'Steps:',
      '10. Open the valve slowly.',
      '11. Close it.',
    ])
    expect(sentenceSpans('The answer is no. Next sentence.').map((s) => s.text)).toEqual([
      'The answer is no.',
      'Next sentence.',
    ])
  })

  it('joins narrow-column lines when the next line continues in lowercase', () => {
    const text = 'Short lines wrap a\nsingle sentence into\nmany fragments without\npunctuation at all.'
    expect(sentenceSpans(text).map((s) => s.text)).toEqual([
      'Short lines wrap a single sentence into many fragments without punctuation at all.',
    ])
  })

  it('reports where the sentence starting at an offset ends', () => {
    const text = 'One here. Two there.'
    expect(text.slice(0, sentenceEndAt(text, 0)).trimEnd()).toBe('One here.')
    expect(sentenceEndAt(text, 10)).toBe(text.length)
  })
})

describe('focusPairs and applyFocus edge cases', () => {
  it('skips sources with a single sentence: nothing to choose', () => {
    const one = chunk('a', 'x'.repeat(50))
    expect(focusPairs('q?', [one], 10).pairs).toEqual([])
  })

  it('ignores non-finite scores', () => {
    const long = chunk('a', 'One sentence here. Another sentence there.')
    const spans = [
      { source: 0, start: 0 },
      { source: 0, start: 19 },
    ]
    expect(applyFocus([long], spans, [Number.NaN, 0.5])[0]!.focusStart).toBe(19)
    expect(applyFocus([long], spans, [Number.NaN, Number.NaN])[0]!.focusStart).toBeUndefined()
  })
})

describe('sentenceSpans digits and markers', () => {
  it('ends a sentence after a lone digit that is not a list marker', () => {
    expect(sentenceSpans('It cost 5. Next sentence.').map((s) => s.text)).toEqual(['It cost 5.', 'Next sentence.'])
    expect(sentenceSpans('The score was 7. The team won.').map((s) => s.text)).toEqual([
      'The score was 7.',
      'The team won.',
    ])
  })

  it('keeps a list marker with its item after a colon', () => {
    expect(sentenceSpans('Steps: 10. Open the valve.').map((s) => s.text)).toEqual(['Steps: 10. Open the valve.'])
  })
})
