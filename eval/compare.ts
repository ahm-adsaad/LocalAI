/**
 * Model comparison on the golden set: which sentence embedder, and does a
 * cross-encoder reranker pay for itself? Every candidate is an ONNX model
 * that runs in the browser through Transformers.js, so whatever wins here
 * can ship as-is. Run by hand (downloads ~0.5 GB of weights the first time):
 *
 *   npm run eval:models
 *   npm run eval:models -- --embedders Xenova/all-MiniLM-L6-v2 --rerankers Xenova/ms-marco-MiniLM-L-6-v2
 *
 * Writes eval/results/models.{md,json}. Timings are Node CPU and only
 * indicative of relative cost; the browser bench measures real latency.
 */
import { mkdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { env, pipeline, type FeatureExtractionPipeline } from '@huggingface/transformers'
import { bm25Scores } from '../src/lib/bm25'
import { chunkText } from '../src/lib/chunking'
import { firstRelevantRank, hitRateAtK, meanReciprocalRank } from '../src/lib/metrics'
import { clipExcerpt } from '../src/lib/prompt'
import { embeddingQueryFor, hybridRank, selectRagSources } from '../src/lib/rag'
import { mergeRerank, rerankPairs, RERANK_POOL } from '../src/lib/rerank'
import { EXCERPT_MAX_CHARS, HYBRID_CANDIDATE_POOL, type StoredChunk } from '../src/lib/types'
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
  type Scorer,
} from './corpus'

interface EmbedderSpec {
  id: string
  pooling: 'mean' | 'cls'
  /** Asymmetric models want a query-side instruction; passages get none (or their own). */
  queryPrefix?: string
  passagePrefix?: string
}

const QUERY_INSTRUCTION = 'Represent this sentence for searching relevant passages: '

const EMBEDDERS: EmbedderSpec[] = [
  { id: 'Xenova/all-MiniLM-L6-v2', pooling: 'mean' },
  { id: 'Xenova/bge-small-en-v1.5', pooling: 'cls', queryPrefix: QUERY_INSTRUCTION },
  { id: 'Xenova/gte-small', pooling: 'mean' },
  { id: 'Snowflake/snowflake-arctic-embed-xs', pooling: 'cls', queryPrefix: QUERY_INSTRUCTION },
  { id: 'mixedbread-ai/mxbai-embed-xsmall-v1', pooling: 'mean' },
  { id: 'Xenova/e5-small-v2', pooling: 'mean', queryPrefix: 'query: ', passagePrefix: 'passage: ' },
  {
    id: 'nomic-ai/nomic-embed-text-v1.5',
    pooling: 'mean',
    queryPrefix: 'search_query: ',
    passagePrefix: 'search_document: ',
  },
  { id: 'Xenova/bge-base-en-v1.5', pooling: 'cls', queryPrefix: QUERY_INSTRUCTION },
]

const RERANKERS = [
  'Xenova/ms-marco-TinyBERT-L-2-v2',
  'Xenova/ms-marco-MiniLM-L-4-v2',
  'Xenova/ms-marco-MiniLM-L-6-v2',
  'jinaai/jina-reranker-v1-tiny-en',
  'mixedbread-ai/mxbai-rerank-xsmall-v1',
]

const KS = [1, 3, 5]

env.cacheDir = MODEL_CACHE

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? undefined : process.argv[i + 1]
}

function list(name: string): string[] | undefined {
  const v = arg(name)
  return v ? v.split(',').map((s) => s.trim()).filter(Boolean) : undefined
}

/** Bytes of the quantized weights in the local cache, for the "download" column. */
function weightsMb(id: string): number | null {
  for (const file of ['onnx/model_quantized.onnx', 'onnx/model.onnx']) {
    try {
      return statSync(join(MODEL_CACHE, id, file)).size / 1e6
    } catch {
      // try the next candidate
    }
  }
  return null
}

interface Summary {
  hits: Record<string, number>
  mrr: number
}

function summarize(rs: Array<number | null>): Summary {
  return {
    hits: Object.fromEntries(KS.map((k) => [`hit@${k}`, hitRateAtK(rs, k)])),
    mrr: meanReciprocalRank(rs),
  }
}

interface EmbedderRow {
  embedder: string
  weightsMb: number | null
  embedMsPerChunk: number | null
  dense: Summary
  hybrid?: Summary
  excerpt?: Summary
}

interface RerankRow {
  embedder: string
  reranker: string
  weightsMb: number | null
  rerankMsP50: number | null
  reranked: Summary
  excerpt: Summary
}

async function main() {
  const golden = loadGolden()
  const items = golden.items.filter((it) => !it.history)
  const embedderIds = list('embedders') ?? EMBEDDERS.map((e) => e.id)
  const rerankerIds = list('rerankers') ?? RERANKERS
  const pool = Number(arg('pool') ?? RERANK_POOL)

  // Corpus text once; vectors per embedder.
  const baseChunks: StoredChunk[] = []
  for (const doc of golden.documents) {
    const pages = await extractPdfPages(join(SAMPLES, `${doc}.pdf`))
    chunkText(pages.join('\n\n')).forEach((part, i) =>
      baseChunks.push({
        id: `${doc}-${i}`,
        documentId: doc,
        documentName: `${doc}.pdf`,
        index: i,
        text: part,
        embedding: [],
      }),
    )
  }
  const isRelevant = (item: GoldenItem, c: StoredChunk) => textIsRelevant(item, c.documentId, c.text)
  const excerptRelevant = (item: GoldenItem, c: StoredChunk) =>
    textIsRelevant(item, c.documentId, clipExcerpt(c.text, EXCERPT_MAX_CHARS, item.question))

  const rerankers = new Map<string, Scorer>()
  for (const id of rerankerIds) {
    console.log(`Loading reranker ${id}…`)
    try {
      rerankers.set(id, await loadReranker(id))
    } catch (err) {
      console.error(`  skipped: ${err instanceof Error ? err.message : String(err)}`)
    }
  }

  const embedderRows: EmbedderRow[] = []
  const rerankRows: RerankRow[] = []
  const errors: string[] = []

  // Sparse signal is embedder-independent; one reference row.
  const bm25Ranks = items.map((item) => {
    const sparse = bm25Scores(item.question, baseChunks.map((c) => ({ id: c.id, text: c.text })))
    const ids = [...sparse.entries()]
      .filter(([, s]) => s > 0)
      .sort((a, b) => b[1] - a[1])
      .map(([id]) => id)
    return firstRelevantRank(ids, (id) => isRelevant(item, baseChunks.find((c) => c.id === id)!))
  })
  embedderRows.push({
    embedder: '(BM25 only, no embedder)',
    weightsMb: null,
    embedMsPerChunk: null,
    dense: summarize(bm25Ranks),
  })

  for (const embedderId of embedderIds) {
    const spec: EmbedderSpec = EMBEDDERS.find((e) => e.id === embedderId) ?? { id: embedderId, pooling: 'mean' }
    console.log(`\nEmbedder ${spec.id}…`)
    let embed: FeatureExtractionPipeline
    try {
      embed = await pipeline('feature-extraction', spec.id, { dtype: 'q8' })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      errors.push(`${spec.id}: ${msg}`)
      console.error(`  skipped: ${msg}`)
      continue
    }
    const vec = async (text: string): Promise<number[]> => {
      const r = await embed(text, { pooling: spec.pooling, normalize: true })
      return (r.tolist() as number[][])[0] ?? []
    }

    // Index like the app: one chunk per call (what the worker does today).
    const t0 = performance.now()
    const chunks: StoredChunk[] = []
    for (const c of baseChunks) {
      chunks.push({ ...c, embedding: await vec(`${spec.passagePrefix ?? ''}${c.text}`) })
    }
    const embedMsPerChunk = (performance.now() - t0) / chunks.length
    const byId = new Map(chunks.map((c) => [c.id, c]))

    const ranks = { dense: [] as Array<number | null>, hybrid: [] as Array<number | null>, excerpt: [] as Array<number | null> }
    const rr = new Map<string, { reranked: Array<number | null>; excerpt: Array<number | null>; ms: number[] }>()
    for (const id of rerankers.keys()) rr.set(id, { reranked: [], excerpt: [], ms: [] })

    for (const item of items) {
      const q = item.question
      const qVec = await vec(`${spec.queryPrefix ?? ''}${embeddingQueryFor(q)}`)
      const dense = chunks
        .map((c) => ({ id: c.id, score: cosine(qVec, c.embedding) }))
        .sort((a, b) => b.score - a.score)
      const rel = (id: string) => isRelevant(item, byId.get(id)!)
      const exRel = (id: string) => excerptRelevant(item, byId.get(id)!)

      const hybrid = hybridRank(q, chunks, dense.slice(0, Math.min(HYBRID_CANDIDATE_POOL, chunks.length)))
      const selected = selectRagSources(q, chunks, hybrid)
      ranks.dense.push(firstRelevantRank(dense.map((d) => d.id), rel))
      ranks.hybrid.push(firstRelevantRank(hybrid.map((h) => h.id), rel))
      ranks.excerpt.push(firstRelevantRank(selected.map((s) => s.id), exRel))

      for (const [id, score] of rerankers) {
        const slot = rr.get(id)!
        const t1 = performance.now()
        const scores = await score(rerankPairs(q, hybrid, pool))
        slot.ms.push(performance.now() - t1)
        const reranked = mergeRerank(hybrid, scores)
        const sel = selectRagSources(q, chunks, reranked)
        slot.reranked.push(firstRelevantRank(reranked.map((h) => h.id), rel))
        slot.excerpt.push(firstRelevantRank(sel.map((s) => s.id), exRel))
      }
    }

    embedderRows.push({
      embedder: spec.id,
      weightsMb: weightsMb(spec.id),
      embedMsPerChunk,
      dense: summarize(ranks.dense),
      hybrid: summarize(ranks.hybrid),
      excerpt: summarize(ranks.excerpt),
    })
    for (const [id, slot] of rr) {
      const sorted = [...slot.ms].sort((a, b) => a - b)
      rerankRows.push({
        embedder: spec.id,
        reranker: id,
        weightsMb: weightsMb(id),
        rerankMsP50: sorted[Math.floor(sorted.length / 2)] ?? null,
        reranked: summarize(slot.reranked),
        excerpt: summarize(slot.excerpt),
      })
    }
    await embed.dispose()
  }

  const cells = (s: Summary | undefined) =>
    s ? `${pct(s.hits['hit@1']!)} | ${pct(s.hits['hit@3']!)} | ${s.mrr.toFixed(3)}` : '— | — | —'
  const num = (x: number | null, d = 0) => (x == null ? '—' : x.toFixed(d))

  const embedderTable = [
    '| Embedder | q8 weights (MB) | embed ms/chunk (Node CPU) | dense hit@1 | dense hit@3 | dense MRR | hybrid hit@1 | hybrid hit@3 | hybrid MRR | excerpt hit@1 | excerpt hit@3 | excerpt MRR |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...embedderRows.map(
      (r) =>
        `| ${r.embedder} | ${num(r.weightsMb)} | ${num(r.embedMsPerChunk, 1)} | ${cells(r.dense)} | ${cells(r.hybrid)} | ${cells(r.excerpt)} |`,
    ),
  ].join('\n')

  const rerankTable = [
    `| Embedder | Reranker | q8 weights (MB) | rerank ms/query p50 (Node CPU, pool ${pool}) | reranked hit@1 | reranked hit@3 | reranked MRR | excerpt hit@1 | excerpt hit@3 | excerpt MRR |`,
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rerankRows.map(
      (r) =>
        `| ${r.embedder} | ${r.reranker} | ${num(r.weightsMb)} | ${num(r.rerankMsP50)} | ${cells(r.reranked)} | ${cells(r.excerpt)} |`,
    ),
  ].join('\n')

  const md = [
    '# Embedder and reranker comparison',
    '',
    `Golden set, single-turn questions (n=${items.length}) over ${golden.documents.length} PDFs / ${baseChunks.length} chunks. "excerpt" judges the top-3 excerpts after selection and query-focused clipping, i.e. what the model actually reads. Reranking re-scores the top ${pool} fused candidates with a cross-encoder. Timings are Node CPU (onnxruntime-node) and only indicative; the browser runs these on WASM.`,
    '',
    '## Embedders',
    '',
    embedderTable,
    '',
    '## Rerankers (on top of hybrid retrieval)',
    '',
    rerankTable,
    '',
    errors.length ? `## Skipped\n\n${errors.map((e) => `- ${e}`).join('\n')}\n` : '',
  ].join('\n')

  mkdirSync(RESULTS, { recursive: true })
  writeFileSync(join(RESULTS, 'models.md'), md)
  writeFileSync(
    join(RESULTS, 'models.json'),
    JSON.stringify({ generatedAt: new Date().toISOString(), pool, embedderRows, rerankRows, errors }, null, 2),
  )
  console.log(`\n${md}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
