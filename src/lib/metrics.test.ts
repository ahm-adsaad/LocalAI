import { describe, expect, it } from 'vitest'
import { firstRelevantRank, hitRateAtK, meanReciprocalRank } from './metrics'

describe('firstRelevantRank', () => {
  it('returns the 1-based position of the first relevant id', () => {
    const rank = firstRelevantRank(['x', 'y', 'z'], (id) => id === 'y')
    expect(rank).toBe(2)
  })

  it('returns null when nothing relevant was retrieved', () => {
    expect(firstRelevantRank(['x', 'y'], () => false)).toBeNull()
  })
})

describe('hitRateAtK', () => {
  it('counts queries whose first relevant rank is within k', () => {
    expect(hitRateAtK([1, 3, null, 5], 3)).toBe(0.5)
  })

  it('is 0 for an empty run', () => {
    expect(hitRateAtK([], 3)).toBe(0)
  })
})

describe('meanReciprocalRank', () => {
  it('averages 1/rank, treating misses as 0', () => {
    expect(meanReciprocalRank([1, 2, null, 4])).toBeCloseTo((1 + 0.5 + 0 + 0.25) / 4, 6)
  })
})
