import { describe, expect, it } from 'vitest'
import { answerMatches, normalizeAnswer, retrievalHit } from './grading'
import type { RankedChunk } from './types'

describe('normalizeAnswer', () => {
  it('lowercases, strips currency symbols and thousands separators, collapses spaces', () => {
    expect(normalizeAnswer('Rent is  $1,850.00 per Month')).toBe('rent is 1850.00 per month')
  })

  it('joins digit groups a model split with a space after the separator', () => {
    // Small models sometimes emit "$100, 000"; that is still 100000.
    expect(normalizeAnswer('at least $100, 000 in coverage')).toBe('at least 100000 in coverage')
  })
})

describe('answerMatches', () => {
  it('requires every entry, accepting any pipe-separated alternative', () => {
    expect(answerMatches('The lease ends on June 30, 2026.', ['30 june 2026|june 30'])).toBe(true)
    expect(answerMatches('Water and trash are covered.', ['water', 'trash'])).toBe(true)
    expect(answerMatches('Water is covered.', ['water', 'trash'])).toBe(false)
  })
})

describe('retrievalHit', () => {
  const sources: RankedChunk[] = [
    { id: 'a', documentId: 'x', documentName: 'residential-lease.pdf', text: 'Rent is $1,850.00.', score: 1 },
    { id: 'b', documentId: 'y', documentName: 'employee-handbook.pdf', text: 'Rent is $1,850.00.', score: 1 },
  ]

  it('is true only when a source from the expected document contains an expected substring', () => {
    expect(retrievalHit(sources, 'residential-lease', ['$1,850.00'])).toBe(true)
    expect(retrievalHit(sources.slice(1), 'residential-lease', ['$1,850.00'])).toBe(false)
    expect(retrievalHit(sources, 'residential-lease', ['$2,000.00'])).toBe(false)
  })
})
