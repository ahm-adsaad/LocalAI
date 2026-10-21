import type { ScoredChunkId } from './types'

/**
 * Dense index that lives inside the AI worker. The main thread sends the
 * library's vectors once (as one transferable Float32Array, not a JSON
 * number[] per query), and every search afterwards carries only the query
 * text. Brute-force dot product is the right tool at browser library sizes:
 * a few thousand 384-d vectors score in well under a millisecond.
 */

export interface PackedVectors {
  ids: string[]
  dim: number
  vectors: Float32Array
}

export function packVectors(entries: Array<{ id: string; embedding: ArrayLike<number> }>): PackedVectors {
  const dim = entries[0]?.embedding.length ?? 0
  const vectors = new Float32Array(entries.length * dim)
  entries.forEach((e, row) => vectors.set(e.embedding, row * dim))
  return { ids: entries.map((e) => e.id), dim, vectors }
}

export class VectorIndex {
  private ids: string[] = []
  private dim = 0
  private vectors: Float32Array = new Float32Array(0)

  get size(): number {
    return this.ids.length
  }

  /** Replace the whole index; the library for the active chat is the unit of change. */
  load(packed: PackedVectors): void {
    this.ids = packed.ids
    this.dim = packed.dim
    this.vectors = packed.vectors
  }

  /** Top-k by dot product (vectors are L2-normalised upstream, so this is cosine). */
  search(query: ArrayLike<number>, topK: number): ScoredChunkId[] {
    const n = this.ids.length
    if (n === 0 || topK <= 0) return []
    const dim = Math.min(this.dim, query.length)
    const scores = new Float32Array(n)
    const v = this.vectors
    for (let row = 0; row < n; row++) {
      const base = row * this.dim
      let dot = 0
      for (let j = 0; j < dim; j++) dot += v[base + j]! * query[j]!
      scores[row] = dot
    }
    const order = Array.from({ length: n }, (_, i) => i).sort((a, b) => scores[b]! - scores[a]!)
    return order.slice(0, Math.min(topK, n)).map((row) => ({ id: this.ids[row]!, score: scores[row]! }))
  }
}
