/**
 * Retrieval-quality eval over the golden set. Runs in Node with the same
 * chunking, BM25, RRF fusion, cross-encoder reranking, and source selection
 * the browser uses, and the same ONNX models via Transformers.js, so the
 * numbers transfer.
 *
 *   npm run eval:pdfs        # once, to render the corpus to PDFs
 *   npm run eval:retrieval   # prints a table and writes eval/results/retrieval.{md,json}
 *
 * Reports hit rate at k and MRR per stage so each stage of the pipeline is
 * justified by a number rather than a hunch:
 *   dense       — MiniLM cosine only
 *   bm25        — Okapi BM25 only
 *   hybrid      — RRF fusion of the two (the candidate pool)
 *   reranked    — hybrid head re-scored by the cross-encoder (the order the app uses)
 *   selected    — reranked + prose-aware selection (the chunks that go to the prompt)
 *   excerptHead — selected chunks clipped from the head to the prompt budget
 *                 (the original behaviour): does the fact survive into the prompt?
 *   excerptLexical — selected chunks clipped to the window with the most question terms
 *   excerpt     — selected chunks clipped around the sentence the cross-encoder
 *                 rates most relevant (the shipped behaviour)
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline, env } from '@huggingface/transformers'
import { bm25Scores } from '../src/lib/bm25'
import { chunkPages } from '../src/lib/chunking'
import { applyFocus, focusPairs } from '../src/lib/focus'
import { firstRelevantRank, hitRateAtK, meanReciprocalRank } from '../src/lib/metrics'
import { clipExcerpt } from '../src/lib/prompt'
import { embeddingQueryFor, hybridRank, isOverviewQuery, selectRagSources } from '../src/lib/rag'
import { mergeRerank, rerankPairs, RERANK_POOL } from '../src/lib/rerank'
import {
  EMBED_MODEL_ID,
  EXCERPT_MAX_CHARS,
  HYBRID_CANDIDATE_POOL,
  RERANK_MODEL_ID,
  type StoredChunk,
} from '../src/lib/types'
import {
  cosine,
  extractPdfPages,
  loadGolden,
  loadReranker,
  MODEL_CACHE,
  pct,
  RESULTS,
  SAMPLES,
  textIsRelevant,
  type GoldenItem,
} from './corpus'

type Strategy =
  | 'dense'
  | 'bm25'
  | 'hybrid'
  | 'reranked'
  | 'selected'
  | 'excerptHead'
  | 'excerptLexical'
  | 'excerpt'
const STRATEGIES: Strategy[] = [
  'dense',
  'bm25',
  'hybrid',
  'reranked',
  'selected',
  'excerptHead',
  'excerptLexical',
  'excerpt',
]
const KS = [1, 3, 5]
type Group = 'single' | 'followup'

env.cacheDir = MODEL_CACHE

function isRelevant(item: GoldenItem, chunk: StoredChunk): boolean {
  return textIsRelevant(item, chunk.documentId, chunk.text)
}

function emptyRanks(): Record<Strategy, Array<number | null>> {
  return Object.fromEntries(STRATEGIES.map((s) => [s, []])) as Record<Strategy, Array<number | null>>
}

async function main() {
  const golden = loadGolden()

  console.log(`Loading ${EMBED_MODEL_ID}…`)
  const embed = await pipeline('feature-extraction', EMBED_MODEL_ID, { dtype: 'q8' })
  const embedAll = async (texts: string[]): Promise<number[][]> => {
    const out: number[][] = []
    for (const t of texts) {
      const r = await embed(t, { pooling: 'mean', normalize: true })
      out.push((r.tolist() as number[][])[0] ?? [])
    }
    return out
  }
  console.log(`Loading ${RERANK_MODEL_ID}…`)
  const score = await loadReranker(RERANK_MODEL_ID)

  // Index the corpus exactly like the app: PDF → pages → page-tagged chunks → vectors.
  const chunks: StoredChunk[] = []
  for (const doc of golden.documents) {
    const pages = await extractPdfPages(join(SAMPLES, `${doc}.pdf`))
    const parts = chunkPages(pages)
    const vectors = await embedAll(parts.map((p) => p.text))
    parts.forEach((part, i) =>
      chunks.push({
        id: `${doc}-${i}`,
        documentId: doc,
        documentName: `${doc}.pdf`,
        index: i,
        text: part.text,
        embedding: vectors[i] ?? [],
        pageStart: part.pageStart,
        pageEnd: part.pageEnd,
      }),
    )
    console.log(`${doc}: ${parts.length} chunks over ${pages.length} pages`)
  }

  // Sanity checks: every golden item must have at least one relevant chunk
  // (otherwise the item, not the retriever, is broken), and every chunk must
  // know its page (page-level citations depend on it).
  const unreachable = golden.items.filter((it) => !chunks.some((c) => isRelevant(it, c)))
  if (unreachable.length > 0) {
    console.error('Golden items with no matching chunk:', unreachable.map((i) => i.id).join(', '))
    process.exit(1)
  }
  const unpaged = chunks.filter((c) => c.pageStart == null || c.pageEnd == null)
  if (unpaged.length > 0) {
    console.error('Chunks without a page range:', unpaged.map((c) => c.id).join(', '))
    process.exit(1)
  }

  const ranks: Record<Group, Record<Strategy, Array<number | null>>> = {
    single: emptyRanks(),
    followup: emptyRanks(),
  }
  const misses: string[] = []
  // Prompt cost of each clipping policy, so a quality gain is never free by accident.
  const excerptChars = { lexical: 0, shipped: 0, count: 0 }
  const byId = new Map(chunks.map((c) => [c.id, c]))

  for (const item of golden.items) {
    const group: Group = item.history ? 'followup' : 'single'
    const question = item.question
    const [qVec] = await embedAll([embeddingQueryFor(question)])

    const dense = chunks
      .map((c) => ({ id: c.id, score: cosine(qVec!, c.embedding) }))
      .sort((a, b) => b.score - a.score)
    const denseIds = dense.map((d) => d.id)

    const sparse = bm25Scores(
      question,
      chunks.map((c) => ({ id: c.id, text: c.text })),
    )
    const bm25Ids = [...sparse.entries()]
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)

    const pool = Math.min(HYBRID_CANDIDATE_POOL, chunks.length)
    const hybrid = hybridRank(question, chunks, dense.slice(0, pool))
    const reranked = mergeRerank(hybrid, await score(rerankPairs(question, hybrid, RERANK_POOL)))
    const selected = selectRagSources(question, chunks, reranked)
    const selectedIds = selected.map((s) => s.id)
    // Sentence-level focus for the excerpts that will be clipped, exactly as the
    // app does it (pipeline.ts skips it for overview questions).
    const overview = isOverviewQuery(question)
    const focus = overview ? { pairs: [], spans: [] } : focusPairs(question, selected)
    const focused =
      focus.pairs.length > 0 ? applyFocus(selected, focus.spans, await score(focus.pairs)) : selected
    const focusStart = new Map(focused.map((s) => [s.id, s.focusStart]))
    // Overview excerpts keep the head of the chunk, as buildRagMessages does.
    const clipFocus = overview ? undefined : question

    const rel = (id: string) => isRelevant(item, byId.get(id)!)
    // Same chunks, but judged on the clipped text the prompt will contain.
    const excerptHeadRel = (id: string) => {
      const c = byId.get(id)!
      return textIsRelevant(item, c.documentId, clipExcerpt(c.text, EXCERPT_MAX_CHARS))
    }
    const excerptLexicalRel = (id: string) => {
      const c = byId.get(id)!
      return textIsRelevant(item, c.documentId, clipExcerpt(c.text, EXCERPT_MAX_CHARS, clipFocus))
    }
    const excerptRel = (id: string) => {
      const c = byId.get(id)!
      return textIsRelevant(
        item,
        c.documentId,
        clipExcerpt(c.text, EXCERPT_MAX_CHARS, clipFocus, focusStart.get(id)),
      )
    }
    for (const s of selected) {
      excerptChars.lexical += clipExcerpt(s.text, EXCERPT_MAX_CHARS, clipFocus).length
      excerptChars.shipped += clipExcerpt(s.text, EXCERPT_MAX_CHARS, clipFocus, focusStart.get(s.id)).length
      excerptChars.count += 1
    }
    const r: Record<Strategy, number | null> = {
      dense: firstRelevantRank(denseIds, rel),
      bm25: firstRelevantRank(bm25Ids, rel),
      hybrid: firstRelevantRank(hybrid.map((h) => h.id), rel),
      reranked: firstRelevantRank(reranked.map((h) => h.id), rel),
      selected: firstRelevantRank(selectedIds, rel),
      excerptHead: firstRelevantRank(selectedIds, excerptHeadRel),
      excerptLexical: firstRelevantRank(selectedIds, excerptLexicalRel),
      excerpt: firstRelevantRank(selectedIds, excerptRel),
    }
    for (const s of STRATEGIES) ranks[group][s].push(r[s])
    if (r.excerpt == null) {
      misses.push(
        `${item.id} (${group}): dense=${r.dense ?? '-'} bm25=${r.bm25 ?? '-'} hybrid=${r.hybrid ?? '-'} reranked=${r.reranked ?? '-'} selected=${r.selected ?? '-'}`,
      )
    }
  }

  const table = (group: Group) => {
    const n = ranks[group].dense.length
    const header = `| Strategy | ${KS.map((k) => `hit@${k}`).join(' | ')} | MRR |`
    const sep = `| --- | ${KS.map(() => '---').join(' | ')} | --- |`
    const rows = STRATEGIES.map((s) => {
      const rs = ranks[group][s]
      const hits = KS.map((k) => pct(hitRateAtK(rs, k))).join(' | ')
      return `| ${s} | ${hits} | ${meanReciprocalRank(rs).toFixed(3)} |`
    })
    return { n, md: [header, sep, ...rows].join('\n') }
  }

  const single = table('single')
  const followup = table('followup')
  const md = [
    `# Retrieval eval`,
    ``,
    `Corpus: ${golden.documents.length} PDFs, ${chunks.length} chunks. Embedder: ${EMBED_MODEL_ID}. Reranker: ${RERANK_MODEL_ID} over the top ${RERANK_POOL} fused candidates. Candidate pool: ${HYBRID_CANDIDATE_POOL}.`,
    ``,
    `## Single-turn questions (n=${single.n})`,
    ``,
    single.md,
    ``,
    `## Follow-up questions asked verbatim, without rewriting (n=${followup.n})`,
    ``,
    `These depend on earlier turns ("when does *her* lease end?"). This is the baseline the in-app question rewriting is measured against.`,
    ``,
    followup.md,
    ``,
    `Mean excerpt length: lexical window ${(excerptChars.lexical / excerptChars.count).toFixed(0)} chars, shipped (window + anchored sentence on disagreement) ${(excerptChars.shipped / excerptChars.count).toFixed(0)} chars.`,
    ``,
    misses.length
      ? `## Misses at the excerpt level\n\n${misses.map((m) => `- ${m}`).join('\n')}`
      : `No misses in the selected set.`,
    ``,
  ].join('\n')

  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(join(RESULTS, 'retrieval.md'), md)
  writeFileSync(
    join(RESULTS, 'retrieval.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), chunks: chunks.length, ranks }, null, 2),
  )
  console.log(`\n${md}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
