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
          push({
            id: c.id,
            documentId: c.documentId,
            documentName: c.documentName,
            text: c.text,
            score: Math.max(c.index === 0 ? 0.99 : 0.9 - c.index * 0.05, 0.8),
          }),
        )
    }
  }

  // Soft-rerank fused hits: blend similarity with prose density.
  const reranked = ranked
    .slice()
    .sort(
      (a, b) =>
        b.score * 0.7 +
        proseDensity(b.text) * 0.3 -
        (a.score * 0.7 + proseDensity(a.text) * 0.3),
    )

  for (const r of reranked) {
    if (selected.length >= budget) break
    // Skip almost-pure numeric scraps unless we have nothing else.
    if (proseDensity(r.text) < 0.35 && selected.length > 0) continue
    push(r)
  }

  // If filters left us short, fill with remaining ranked regardless of density.
  if (selected.length < Math.min(2, budget)) {
    for (const r of ranked) {
      if (selected.length >= budget) break
      push(r)
    }
  }

  return selected.slice(0, budget)
}

/** Expanded embedding query for overview intents — pulls summary-like chunks. */
export function embeddingQueryFor(question: string): string {
  if (!isOverviewQuery(question)) return question
  return (
    `${question}. Document overview summary introduction title purpose ` +
    `executive summary LinkedIn performance report`
  )
}
