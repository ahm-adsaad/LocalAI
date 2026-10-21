import { describe, expect, it } from 'vitest'
import { mergeRerank, rerankPairs } from './rerank'
import type { RankedChunk } from './types'

function ranked(id: string, score: number): RankedChunk {
  return { id, documentId: 'd', documentName: 'd.pdf', text: `text ${id}`, score }
}

const fused = [ranked('a', 0.9), ranked('b', 0.8), ranked('c', 0.7), ranked('d', 0.6)]

describe('mergeRerank', () => {
  it('reorders the reranked pool by cross-encoder score and keeps the tail in fused order', () => {
    // Pool = first 3; the cross-encoder prefers c, then a, then b. d was not scored.
    const out = mergeRerank(fused, [1.2, -0.5, 4.1])
    expect(out.map((r) => r.id)).toEqual(['c', 'a', 'b', 'd'])
  })

  it('exposes the cross-encoder score on reranked chunks and leaves the tail untouched', () => {
    const out = mergeRerank(fused, [1.2, -0.5, 4.1])
    expect(out[0]!.rerankScore).toBeCloseTo(4.1)
    expect(out[3]!.rerankScore).toBeUndefined()
  })

  it('returns the fused list unchanged when no scores were produced', () => {
    expect(mergeRerank(fused, [])).toEqual(fused)
  })
})

describe('rerankPairs', () => {
  it('pairs the query with the first N candidate texts, in order', () => {
    expect(rerankPairs('q', fused, 2)).toEqual([
      { query: 'q', text: 'text a' },
      { query: 'q', text: 'text b' },
    ])
  })
})
