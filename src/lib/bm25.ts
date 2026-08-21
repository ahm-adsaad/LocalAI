/**
 * Lightweight Okapi BM25 over in-memory chunk text.
 * Complements MiniLM cosine: exact names, codes, and rare tokens that embeddings miss.
 */

const TOKEN_RE = /[a-z0-9]+(?:[.%/\-][a-z0-9]+)*/g

/** Lowercase alphanumerics; keeps codes like "IgE", "10.65%", "penicillin-allergy". */
export function tokenize(text: string): string[] {
  const matches = text.toLowerCase().match(TOKEN_RE)
  if (!matches) return []
  return matches.filter((t) => t.length > 1)
}

export interface Bm25Doc {
  id: string
  text: string
}

/**
 * Returns BM25 scores keyed by doc id. Zero for docs with no query-term overlap.
 */
export function bm25Scores(
  query: string,
  docs: Bm25Doc[],
  k1 = 1.5,
  b = 0.75,
): Map<string, number> {
  const qTokens = tokenize(query)
  const scores = new Map<string, number>()
  if (qTokens.length === 0 || docs.length === 0) {
    for (const d of docs) scores.set(d.id, 0)
    return scores
  }

  const tokenized = docs.map((d) => ({ id: d.id, tokens: tokenize(d.text) }))
  const N = tokenized.length
  const avgdl = tokenized.reduce((s, d) => s + d.tokens.length, 0) / Math.max(N, 1)

  const df = new Map<string, number>()
  for (const d of tokenized) {
    for (const t of new Set(d.tokens)) {
      df.set(t, (df.get(t) ?? 0) + 1)
    }
  }

  for (const d of tokenized) {
    const tf = new Map<string, number>()
    for (const t of d.tokens) tf.set(t, (tf.get(t) ?? 0) + 1)

    let score = 0
    const dl = d.tokens.length || 1
    for (const qt of qTokens) {
      const f = tf.get(qt) ?? 0
      if (f === 0) continue
      const n = df.get(qt) ?? 0
      const idf = Math.log(1 + (N - n + 0.5) / (n + 0.5))
      score += idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + b * (dl / avgdl))))
    }
    scores.set(d.id, score)
  }

  return scores
}
