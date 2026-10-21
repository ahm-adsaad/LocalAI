import { describe, expect, it } from 'vitest'
import { bm25Scores, tokenize } from './bm25'

describe('tokenize', () => {
  it('lowercases and keeps codes joined by . % / -', () => {
    expect(tokenize('IgE 10.65% penicillin-allergy A/B')).toEqual([
      'ige',
      '10.65',
      'penicillin-allergy',
      'a/b',
    ])
  })

  it('drops single-character tokens', () => {
    expect(tokenize('a b cd')).toEqual(['cd'])
  })
})

describe('bm25Scores', () => {
  const docs = [
    { id: 'a', text: 'The patient is allergic to penicillin.' },
    { id: 'b', text: 'Blood pressure was normal at the last visit.' },
    { id: 'c', text: 'Penicillin penicillin penicillin is mentioned often here.' },
  ]

  it('scores zero for documents with no query-term overlap', () => {
    const scores = bm25Scores('penicillin', docs)
    expect(scores.get('b')).toBe(0)
  })

  it('ranks documents containing the rare query term above those without it', () => {
    const scores = bm25Scores('penicillin', docs)
    expect(scores.get('a')!).toBeGreaterThan(scores.get('b')!)
    expect(scores.get('c')!).toBeGreaterThan(scores.get('b')!)
  })

  it('returns all zeros for an empty query', () => {
    const scores = bm25Scores('', docs)
    expect([...scores.values()]).toEqual([0, 0, 0])
  })
})
