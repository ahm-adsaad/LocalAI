import { describe, expect, it } from 'vitest'
import { planBatches } from './batching'

describe('planBatches', () => {
  it('groups indices by ascending length so each batch pads as little as possible', () => {
    // Lengths 10 and 20 are short, 480 and 500 are long: batching the shorts
    // together avoids padding a 10-char text out to 500 tokens.
    expect(planBatches([10, 500, 20, 480], 2)).toEqual([
      [0, 2],
      [3, 1],
    ])
  })

  it('covers every index exactly once', () => {
    const batches = planBatches([5, 4, 3, 2, 1], 2)
    expect(batches.flat().sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4])
    for (const b of batches) expect(b.length).toBeLessThanOrEqual(2)
  })

  it('returns no batches for no texts', () => {
    expect(planBatches([], 8)).toEqual([])
  })
})
