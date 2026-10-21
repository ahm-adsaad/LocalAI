import type { RankedChunk, RerankPair } from './types'

export type { RerankPair }

/**
 * Cross-encoder reranking of the fused candidate list. The worker scores
 * (question, chunk) pairs with a small MS MARCO cross-encoder; this module is
 * the pure half shared by the app, the Node eval, and the tests.
 *
 * Why only a pool: a cross-encoder reads the question and the chunk together,
 * so it bridges vocabulary gaps bi-encoders miss ("blood pressure" vs
 * "hypertension"), but it costs one forward pass per pair. Scoring the top
 * few fused candidates buys the accuracy at a fixed, small latency.
 */

/** How many fused candidates the cross-encoder re-scores per question. */
export const RERANK_POOL = 8

export function rerankPairs(query: string, ranked: RankedChunk[], pool = RERANK_POOL): RerankPair[] {
  return ranked.slice(0, pool).map((r) => ({ query, text: r.text }))
}

/**
 * Re-sort the scored head of `ranked` by cross-encoder score (descending) and
 * keep everything after it in fused order. `scores[i]` belongs to `ranked[i]`.
 */
export function mergeRerank(ranked: RankedChunk[], scores: number[]): RankedChunk[] {
  if (scores.length === 0) return ranked
  const n = Math.min(scores.length, ranked.length)
  const head = ranked.slice(0, n).map((r, i) => ({ ...r, rerankScore: scores[i]! }))
  head.sort((a, b) => b.rerankScore - a.rerankScore)
  return [...head, ...ranked.slice(n)]
}
