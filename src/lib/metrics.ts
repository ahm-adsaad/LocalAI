/**
 * Retrieval quality metrics shared by the Node eval script and the in-browser bench.
 * Ranks are 1-based; `null` means no relevant item was retrieved for that query.
 */

export function firstRelevantRank(
  rankedIds: string[],
  isRelevant: (id: string) => boolean,
): number | null {
  const i = rankedIds.findIndex(isRelevant)
  return i === -1 ? null : i + 1
}

/** Fraction of queries whose first relevant hit lands within the top k. */
export function hitRateAtK(ranks: Array<number | null>, k: number): number {
  if (ranks.length === 0) return 0
  const hits = ranks.filter((r) => r != null && r <= k).length
  return hits / ranks.length
}

/** Mean reciprocal rank; misses contribute 0. */
export function meanReciprocalRank(ranks: Array<number | null>): number {
  if (ranks.length === 0) return 0
  const sum = ranks.reduce<number>((s, r) => s + (r == null ? 0 : 1 / r), 0)
  return sum / ranks.length
}
