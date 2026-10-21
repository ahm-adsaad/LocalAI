import { describe, expect, it } from 'vitest'
import { embeddingQueryFor, hybridRank, isOverviewQuery, selectRagSources } from './rag'
import type { StoredChunk } from './types'

function chunk(id: string, text: string, index = 0): StoredChunk {
  return { id, documentId: 'doc', documentName: 'doc.pdf', index, text, embedding: [] }
}

describe('isOverviewQuery', () => {
  it('detects summary and what-is-this intents', () => {
    expect(isOverviewQuery("What's this document about?")).toBe(true)
    expect(isOverviewQuery('Give me a summary')).toBe(true)
    expect(isOverviewQuery('tl;dr')).toBe(true)
  })

  it('does not flag specific factual questions', () => {
    expect(isOverviewQuery('What allergy does Jordan Lee have?')).toBe(false)
  })
})

describe('hybridRank', () => {
  const chunks = [
    chunk('a', 'Jordan Lee is allergic to penicillin.', 0),
    chunk('b', 'The clinic opens at nine in the morning.', 1),
    chunk('c', 'Follow-up appointment scheduled for March.', 2),
  ]

  it('returns an empty list when there are no chunks', () => {
    expect(hybridRank('q', [], [])).toEqual([])
  })

  it('surfaces a chunk found only by BM25 even when cosine missed it', () => {
    const cosineHits = [
      { id: 'b', score: 0.5 },
      { id: 'c', score: 0.4 },
    ]
    const ranked = hybridRank('penicillin', chunks, cosineHits)
    expect(ranked.map((r) => r.id)).toContain('a')
  })

  it('ranks a chunk found by both signals above one found by only one', () => {
    const cosineHits = [
      { id: 'a', score: 0.6 },
      { id: 'b', score: 0.5 },
    ]
    const ranked = hybridRank('penicillin', chunks, cosineHits)
    expect(ranked[0]!.id).toBe('a')
  })
})

describe('selectRagSources', () => {
  it('never returns duplicate chunks and respects the top-k budget', () => {
    const all = Array.from({ length: 10 }, (_, i) => chunk(`c${i}`, `prose chunk number ${i}`, i))
    const ranked = all.map((c) => ({ ...c, score: 0.5 }))
    const picked = selectRagSources('specific question', all, ranked)
    expect(new Set(picked.map((p) => p.id)).size).toBe(picked.length)
    expect(picked.length).toBeLessThanOrEqual(3)
  })

  it('keeps the top fused hit even when it is number-heavy', () => {
    const numeric = chunk('vitals', 'BP 128/82 HR 68 BMI 25.7 SpO2 98% 36.7', 3)
    const prose = chunk('plan', 'Continue the current medication and diet plan.', 4)
    // Fused rank 1 but a weak display score: rank must win over score.
    const ranked = [
      { ...numeric, score: 0.3 },
      { ...prose, score: 0.9 },
    ]
    const picked = selectRagSources('what was the blood pressure?', [numeric, prose], ranked)
    expect(picked[0]!.id).toBe('vitals')
  })

  it('defers lower-ranked number-heavy chunks below prose chunks, preserving fused order', () => {
    const p1 = chunk('p1', 'First prose paragraph about the tenant.', 0)
    const n2 = chunk('n2', '14 90 220 60 3 24 16 2500 4 100000', 1)
    const p3 = chunk('p3', 'Third prose paragraph about the deposit.', 2)
    const p4 = chunk('p4', 'Fourth prose paragraph about parking.', 3)
    const all = [p1, n2, p3, p4]
    // Deliberately inconsistent display scores: fused order must win, not score.
    const ranked = [
      { ...p1, score: 0.3 },
      { ...n2, score: 0.95 },
      { ...p3, score: 0.5 },
      { ...p4, score: 0.9 },
    ]
    const picked = selectRagSources('who pays the deposit?', all, ranked)
    expect(picked.map((p) => p.id)).toEqual(['p1', 'p3', 'p4'])
  })

  it('pins the opening chunks of each document for overview questions', () => {
    const all = [chunk('intro', 'Title page intro text', 0), chunk('mid', 'Mid document detail', 5)]
    const ranked = [{ ...all[1]!, score: 0.9 }]
    const picked = selectRagSources('what is this document about?', all, ranked)
    expect(picked[0]!.id).toBe('intro')
  })
})

describe('embeddingQueryFor', () => {
  it('returns the question unchanged for specific questions', () => {
    expect(embeddingQueryFor('What is the rent?')).toBe('What is the rent?')
  })

  it('expands overview questions with generic summary terms only', () => {
    const expanded = embeddingQueryFor('what is this about?')
    expect(expanded.toLowerCase()).toContain('summary')
    expect(expanded.toLowerCase()).not.toContain('linkedin')
  })
})
