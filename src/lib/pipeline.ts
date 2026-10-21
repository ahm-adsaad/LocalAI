import { buildCondenseMessages, cleanCondensed, needsCondensing } from './condense'
import {
  buildExtractMessages,
  buildExtractionSchema,
  extractionQuery,
  parseExtractCommand,
  parseExtractionResult,
} from './extract'
import { buildPlainChatMessages, buildRagMessages } from './prompt'
import { embeddingQueryFor, hybridRank, selectRagSources } from './rag'
import { mergeRerank, RERANK_POOL } from './rerank'
import type {
  ChatMessage,
  ExtractedField,
  GenerateOptions,
  RankedChunk,
  StoredChunk,
  TurnStats,
} from './types'
import { HYBRID_CANDIDATE_POOL, TOP_K_EXTRACT } from './types'
import type { WorkerClient } from './workerClient'

/**
 * The whole ask path in one place, independent of React, so the chat UI and
 * the in-browser bench run byte-for-byte the same pipeline:
 *
 *   question → (rewrite follow-up) → embed → cosine ⊕ BM25 → RRF → rerank
 *            → select → prompt (+history) → generate (streamed, or JSON-constrained)
 */

export interface AskInput {
  worker: WorkerClient
  /** Chunks of every PDF attached to the current chat (empty = plain chat). */
  chunks: StoredChunk[]
  /** Prior completed turns, oldest first. */
  history: ChatMessage[]
  text: string
  modelId: string
  onToken?: (token: string) => void
  onActivity?: (activity: string) => void
}

export interface AskResult {
  content: string
  sources: RankedChunk[]
  stats: TurnStats
  /** Present only when the question was rewritten before retrieval. */
  retrievalQuery?: string
  extraction?: ExtractedField[]
  /** The user stopped generation part-way; `content` is what was produced. */
  aborted?: boolean
}

export async function answerQuestion(input: AskInput): Promise<AskResult> {
  const { worker, chunks, history, text, modelId, onToken, onActivity } = input
  const extractFields = parseExtractCommand(text)

  if (extractFields && chunks.length === 0) {
    throw new Error('Add a PDF to this chat first, then use /extract field, field, …')
  }

  let sources: RankedChunk[] = []
  let messages: ChatMessage[]
  let generateOptions: GenerateOptions | undefined
  let retrievalQuery: string | undefined
  let retrievalMs: number | null = null
  let rerankMs: number | null = null
  let condenseMs: number | null = null

  if (chunks.length > 0) {
    let query = text
    if (extractFields) {
      query = extractionQuery(extractFields)
    } else if (needsCondensing(text, history)) {
      // Follow-ups ("when does her lease end?") embed badly on their own:
      // rewrite into a standalone question before retrieval.
      onActivity?.('Rewriting question…')
      const t0 = performance.now()
      try {
        const rewrite = await worker.generate(buildCondenseMessages(history, text), {
          stream: false,
          options: { maxTokens: 48, temperature: 0 },
        })
        query = cleanCondensed(rewrite.content, text)
      } catch {
        query = text
      }
      condenseMs = performance.now() - t0
      if (query !== text) retrievalQuery = query
    }

    onActivity?.('Retrieving…')
    const t1 = performance.now()
    const pool = Math.min(HYBRID_CANDIDATE_POOL, chunks.length)
    // The worker holds the library's vectors; only the query text crosses over.
    const scored = await worker.search(embeddingQueryFor(query), chunks, pool)
    // Cosine (worker) + BM25 (main thread) → RRF fuse.
    let ranked = hybridRank(query, chunks, scored)
    retrievalMs = performance.now() - t1

    // Cross-encoder pass over the fused head. It reads question and chunk
    // together, so it bridges paraphrases ("blood pressure" → "hypertension")
    // that neither cosine nor BM25 can. If the reranker is unavailable, the
    // fused order stands.
    onActivity?.('Reranking…')
    const t2 = performance.now()
    try {
      const scores = await worker.rerank(query, ranked, RERANK_POOL, (p) => onActivity?.(p.text))
      if (scores.length > 0) {
        ranked = mergeRerank(ranked, scores)
        rerankMs = performance.now() - t2
      }
    } catch {
      rerankMs = null
    }

    sources = extractFields ? ranked.slice(0, TOP_K_EXTRACT) : selectRagSources(query, chunks, ranked)

    if (extractFields) {
      messages = buildExtractMessages(extractFields, sources)
      generateOptions = {
        jsonSchema: JSON.stringify(buildExtractionSchema(extractFields)),
        temperature: 0,
        maxTokens: 320,
      }
    } else {
      messages = buildRagMessages(query, sources, history)
    }
  } else {
    messages = buildPlainChatMessages(history, text)
  }

  onActivity?.(extractFields ? 'Extracting…' : 'Generating…')
  if (import.meta.env.DEV) {
    // Dev-only: the exact prompt is the first thing to look at when an answer is wrong.
    console.debug(
      `[localai] prompt\n${messages.map((m) => `--- ${m.role} ---\n${m.content}`).join('\n')}`,
    )
  }
  const result = await worker.generate(messages, {
    stream: !extractFields,
    onToken,
    options: generateOptions,
  })

  const stats: TurnStats = { ...result.stats, modelId, retrievalMs, rerankMs, condenseMs }
  const extraction =
    extractFields && !result.aborted
      ? parseExtractionResult(result.content, extractFields, sources.length)
      : undefined

  return {
    content: result.content,
    sources,
    stats,
    retrievalQuery,
    extraction,
    aborted: result.aborted,
  }
}
