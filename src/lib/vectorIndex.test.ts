import { describe, expect, it } from 'vitest'
import { packVectors, VectorIndex } from './vectorIndex'

describe('packVectors', () => {
  it('flattens embeddings into one Float32Array with their ids and dimension', () => {
    const packed = packVectors([
      { id: 'a', embedding: [1, 0] },
      { id: 'b', embedding: [0, 1] },
    ])
    expect(packed.ids).toEqual(['a', 'b'])
    expect(packed.dim).toBe(2)
    expect(Array.from(packed.vectors)).toEqual([1, 0, 0, 1])
  })

  it('is empty for no entries', () => {
    const packed = packVectors([])
    expect(packed.ids).toEqual([])
    expect(packed.dim).toBe(0)
    expect(packed.vectors.length).toBe(0)
  })
})

describe('VectorIndex', () => {
  const index = new VectorIndex()
  index.load(
    packVectors([
      { id: 'x', embedding: [1, 0, 0] },
      { id: 'y', embedding: [0, 1, 0] },
      { id: 'z', embedding: [0.6, 0.8, 0] },
    ]),
  )

  it('returns the top-k ids by dot product, best first', () => {
    const hits = index.search(new Float32Array([0, 1, 0]), 2)
    expect(hits.map((h) => h.id)).toEqual(['y', 'z'])
    expect(hits[0]!.score).toBeCloseTo(1)
    expect(hits[1]!.score).toBeCloseTo(0.8)
  })

  it('never returns more hits than it holds and reports its size', () => {
    expect(index.size).toBe(3)
    expect(index.search(new Float32Array([1, 0, 0]), 10)).toHaveLength(3)
  })

  it('replaces its contents on load', () => {
    const fresh = new VectorIndex()
    fresh.load(packVectors([{ id: 'only', embedding: [1, 0] }]))
    fresh.load(packVectors([{ id: 'other', embedding: [0, 1] }]))
    expect(fresh.search(new Float32Array([0, 1]), 5).map((h) => h.id)).toEqual(['other'])
  })
})
