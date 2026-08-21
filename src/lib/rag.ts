import type { RankedChunk, StoredChunk } from './types'
import { TOP_K, TOP_K_OVERVIEW } from './types'
import { proseDensity } from './chunking'

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

  // Soft-rerank cosine hits: blend similarity with prose density.
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
