import type { RankedChunk, ScoredChunkId, StoredChunk } from './types'
import { HYBRID_CANDIDATE_POOL, TOP_K, TOP_K_OVERVIEW } from './types'
import { proseDensity } from './chunking'
import { bm25Scores } from './bm25'

/** RRF constant — standard Okapi/hybrid literature default. */
const RRF_K = 60

/**
 * Broad / meta questions ("what's this about?") barely match MiniLM embeddings of
 * metric-heavy report chunks — cosine often returns UI chrome at ~0.15–0.25.
 * For those intents we pin early document chunks (title/intro) into the context.
 */
export function isOverviewQuery(question: string): boolean {
  const q = question.toLowerCase().trim()
  return (
    /what(?:'s| is| does)?\s+(?:this|the)\s+(?:document|pdf|file|report|deck)/.test(q) ||
    /(?:about|regarding)\s+(?:this|the)\s+(?:document|pdf|file|report)/.test(q) ||
    /(?:summar(?:y|ise|ize)|overview|tl;?dr|describe)\b/.test(q) ||
    /^what\s+is\s+this\b/.test(q) ||
    /^whats?\s+this\b/.test(q)
  )
}

function toRanked(chunk: StoredChunk, score: number): RankedChunk {
  return {
    id: chunk.id,
    documentId: chunk.documentId,
    documentName: chunk.documentName,
    text: chunk.text,
    score,
    pageStart: chunk.pageStart,
    pageEnd: chunk.pageEnd,
  }
}

/**
 * Fuse MiniLM cosine ranks with BM25 keyword ranks via Reciprocal Rank Fusion.
 * Cosine uses the (possibly expanded) embedding query upstream; BM25 uses the
 * raw user question so overview fluff does not pollute exact-term matching.
 */
export function hybridRank(
  question: string,
  allChunks: StoredChunk[],
  cosineHits: ScoredChunkId[],
): RankedChunk[] {
  if (allChunks.length === 0) return []

  const byId = new Map(allChunks.map((c) => [c.id, c]))

  // Dense ranks (already sorted descending by cosine).
  const denseRank = new Map<string, number>()
  cosineHits.forEach((hit, i) => denseRank.set(hit.id, i + 1))

  // Sparse ranks from BM25 over full library text (main thread — texts stay local).
  const sparse = bm25Scores(
    question,
    allChunks.map((c) => ({ id: c.id, text: c.text })),
  )
  const sparseSorted = [...sparse.entries()]
    .filter(([, s]) => s > 0)
    .sort((a, b) => b[1] - a[1])
  const sparseRank = new Map<string, number>()
  sparseSorted.forEach(([id], i) => sparseRank.set(id, i + 1))

  const cosineById = new Map(cosineHits.map((h) => [h.id, h.score]))
  const ids = new Set<string>([...denseRank.keys(), ...sparseRank.keys()])

  const fused: Array<{ chunk: StoredChunk; rrf: number; display: number }> = []
  for (const id of ids) {
    const chunk = byId.get(id)
    if (!chunk) continue
    const rDense = denseRank.get(id)
    const rSparse = sparseRank.get(id)
    let rrf = 0
    if (rDense != null) rrf += 1 / (RRF_K + rDense)
    if (rSparse != null) rrf += 1 / (RRF_K + rSparse)

    const cosine = cosineById.get(id)
    const bm25 = sparse.get(id) ?? 0
    const display = cosine != null ? cosine : Math.min(0.99, bm25 / (bm25 + 1))
    fused.push({ chunk, rrf, display })
  }

  fused.sort((a, b) => b.rrf - a.rrf || b.display - a.display)

  return fused.slice(0, HYBRID_CANDIDATE_POOL).map(({ chunk, display }) => toRanked(chunk, display))
}

/**
 * Prefer opening chunks + prose-heavy hits. Pure number-dump chunks get deprioritized
 * so the 1B model is less tempted to parrot "10.65% 6.63% 9.30%".
 */
export function selectRagSources(
  question: string,
  allChunks: StoredChunk[],
  ranked: RankedChunk[],
): RankedChunk[] {
  const overview = isOverviewQuery(question)
  const budget = overview ? TOP_K_OVERVIEW : TOP_K
  const selected: RankedChunk[] = []
  const seen = new Set<string>()

  const push = (chunk: RankedChunk) => {
    if (seen.has(chunk.id) || !chunk.text.trim()) return
    seen.add(chunk.id)
    selected.push(chunk)
  }

  if (overview) {
    const byDoc = new Map<string, StoredChunk[]>()
    for (const c of allChunks) {
      const list = byDoc.get(c.documentId) ?? []
      list.push(c)
      byDoc.set(c.documentId, list)
    }

    for (const list of byDoc.values()) {
      list
        .slice()
        .sort((a, b) => a.index - b.index)
        .slice(0, 2)
        .forEach((c) =>
          push(toRanked(c, Math.max(c.index === 0 ? 0.99 : 0.9 - c.index * 0.05, 0.8))),
        )
    }
  }

  // Fused (RRF) order is the primary signal. `score` is only a display value
  // (cosine for dense hits, a squashed BM25 for sparse-only hits) and the two
  // are not comparable, so we never re-sort by it — the eval showed that
  // blending it with prose density dropped rank-1 hits out of the top 3.
  //
  // Number-soup chunks (dashboard tables) are deferred, not dropped: prose
  // chunks keep their fused order ahead of them, and the top fused hit is
  // always kept because for "what was the blood pressure?" the answer *is*
  // number-heavy.
  const top = ranked[0]
  const prose = ranked.filter((r) => r === top || proseDensity(r.text) >= NUMERIC_DENSITY_FLOOR)
  const numeric = ranked.filter((r) => !prose.includes(r))

  for (const r of [...prose, ...numeric]) {
    if (selected.length >= budget) break
    push(r)
  }

  return selected.slice(0, budget)
}

/** Below this letters-to-characters ratio a chunk is treated as a number dump. */
const NUMERIC_DENSITY_FLOOR = 0.35

/** Expanded embedding query for overview intents — pulls summary-like chunks. */
export function embeddingQueryFor(question: string): string {
  if (!isOverviewQuery(question)) return question
  return (
    `${question}. Document overview summary introduction title purpose ` +
    `executive summary abstract scope`
  )
}
