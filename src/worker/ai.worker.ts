/**
 * AI worker — owns the WebLLM engine, the embedding pipeline, the
 * cross-encoder reranker, and the dense index.
 *
 * Why a worker: WebGPU shader compile, weight load, embedding forward passes,
 * and token generation are all CPU/GPU heavy. Running them here keeps the React
 * UI responsive (scrolling, typing, progress bars) during multi-second loads.
 *
 * Nothing in this file ever POSTs document text, prompts, or embeddings to a
 * server. Network use is limited to the one-time download of model weights
 * (cached thereafter by the browser Cache API / Transformers.js cache).
 */
import {
  MLCEngine,
  type CompletionUsage,
  type InitProgressCallback,
} from '@mlc-ai/web-llm'
import {
  AutoModelForSequenceClassification,
  AutoTokenizer,
  env,
  pipeline,
  type FeatureExtractionPipeline,
  type PreTrainedModel,
  type PreTrainedTokenizer,
} from '@huggingface/transformers'
import { EMBED_BATCH_SIZE, planBatches } from '../lib/batching'
import { statsFromTimers } from '../lib/stats'
import {
  EMBED_MODEL_ID,
  MAX_NEW_TOKENS,
  RERANK_MODEL_ID,
  type ChatMessage,
  type GenerateOptions,
  type GenerationStats,
  type RerankPair,
  type WorkerEvent,
  type WorkerRequest,
} from '../lib/types'
import { VectorIndex } from '../lib/vectorIndex'

// Prefer browser cache so the models work offline after first fetch.
env.allowLocalModels = false
env.useBrowserCache = true
// ONNX Runtime's WebAssembly is served from this origin (vite.config.ts copies
// the files to /ort/), so no third-party script host is ever contacted. The
// variant mirrors Transformers.js's own default: asyncify, plain for Safari.
// The wasm cache is off because it would re-import the loader via a blob URL,
// which the CSP forbids; same-origin files are HTTP-cached anyway.
const ortVariant = /^((?!chrome|android).)*safari/i.test(self.navigator.userAgent)
  ? 'ort-wasm-simd-threaded'
  : 'ort-wasm-simd-threaded.asyncify'
env.useWasmCache = false
if (env.backends.onnx.wasm) {
  env.backends.onnx.wasm.wasmPaths = {
    mjs: `${self.location.origin}/ort/${ortVariant}.mjs`,
    wasm: `${self.location.origin}/ort/${ortVariant}.wasm`,
  }
}

type Reranker = { tokenizer: PreTrainedTokenizer; model: PreTrainedModel }

let engine: MLCEngine | null = null
let loadedModelId: string | null = null
let embedder: FeatureExtractionPipeline | null = null
let reranker: Reranker | null = null
let generating = false
/** Set by `abort`; the generate loop reports what it has and stops. */
let abortRequested = false
/** Deduplicate concurrent initLLM calls (React StrictMode remounts). */
let llmInitPromise: Promise<void> | null = null
let llmInitTarget: string | null = null
let embedInitPromise: Promise<FeatureExtractionPipeline> | null = null
let rerankInitPromise: Promise<Reranker> | null = null
/** Request ids that should receive LLM load progress (handles StrictMode double-mount). */
const llmProgressSubs = new Set<string>()
const embedProgressSubs = new Map<string, (p: number, text: string) => void>()

/** The active chat's vectors, loaded once per library change. */
const index = new VectorIndex()

function reply(msg: WorkerEvent) {
  self.postMessage(msg)
}

type ProgressData = { status: string; file?: string; progress?: number }

async function loadEmbedder(
  requestId?: string,
  onProgress?: (p: number, text: string) => void,
): Promise<FeatureExtractionPipeline> {
  if (onProgress && requestId) embedProgressSubs.set(requestId, onProgress)
  if (embedder) {
    if (requestId) embedProgressSubs.delete(requestId)
    return embedder
  }

  if (!embedInitPromise) {
    embedInitPromise = (async () => {
      broadcastEmbedProgress(0.05, 'Loading embedding model…')

      // dtype q8 keeps MiniLM small; device defaults to wasm so we do not fight the
      // LLM for WebGPU VRAM (the Q4 model already owns most of the GPU budget).
      embedder = await pipeline('feature-extraction', EMBED_MODEL_ID, {
        dtype: 'q8',
        progress_callback: (data: ProgressData) => {
          if (data.status === 'progress' && data.progress != null) {
            broadcastEmbedProgress(
              Math.min(0.95, data.progress / 100),
              `Embedding weights: ${data.file ?? ''} ${data.progress.toFixed(0)}%`,
            )
          }
        },
      })

      broadcastEmbedProgress(1, 'Embedding model ready')
      return embedder
    })()
  }

  try {
    const pipe = await embedInitPromise
    if (requestId) embedProgressSubs.delete(requestId)
    return pipe
  } catch (err) {
    embedInitPromise = null
    if (requestId) embedProgressSubs.delete(requestId)
    throw err
  }
}

function broadcastEmbedProgress(progress: number, text: string) {
  for (const cb of embedProgressSubs.values()) cb(progress, text)
}

/**
 * Embed in length-sorted batches: one forward pass per EMBED_BATCH_SIZE texts
 * instead of one per text, with little padding waste. Results come back in
 * the caller's order.
 */
async function embedTexts(
  texts: string[],
  onProgress?: (done: number, total: number) => void,
): Promise<number[][]> {
  const pipe = await loadEmbedder()
  const out: number[][] = new Array(texts.length)
  let done = 0

  for (const batch of planBatches(texts.map((t) => t.length), EMBED_BATCH_SIZE)) {
    const result = await pipe(
      batch.map((i) => texts[i]!),
      { pooling: 'mean', normalize: true },
    )
    const rows = result.tolist() as number[][]
    batch.forEach((i, k) => {
      out[i] = rows[k] ?? []
    })
    done += batch.length
    onProgress?.(done, texts.length)
  }
  return out
}

async function loadReranker(onProgress?: (p: number, text: string) => void): Promise<Reranker> {
  if (reranker) return reranker
  if (!rerankInitPromise) {
    rerankInitPromise = (async () => {
      const progress_callback = (data: ProgressData) => {
        if (data.status === 'progress' && data.progress != null) {
          onProgress?.(Math.min(0.95, data.progress / 100), `Reranker weights ${data.progress.toFixed(0)}%`)
        }
      }
      const tokenizer = await AutoTokenizer.from_pretrained(RERANK_MODEL_ID, { progress_callback })
      const model = await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL_ID, {
        dtype: 'q8',
        progress_callback,
      })
      reranker = { tokenizer, model }
      return reranker
    })().catch((err) => {
      rerankInitPromise = null
      throw err
    })
  }
  return rerankInitPromise
}

/** One logit per (question, chunk) pair; higher means more relevant. */
async function scorePairs(pairs: RerankPair[], onProgress?: (p: number, text: string) => void) {
  if (pairs.length === 0) return []
  const { tokenizer, model } = await loadReranker(onProgress)
  const inputs = tokenizer(
    pairs.map((p) => p.query),
    { text_pair: pairs.map((p) => p.text), padding: true, truncation: true },
  )
  const { logits } = (await model(inputs)) as { logits: { dims: number[]; data: ArrayLike<number> } }
  const cols = logits.dims[1] ?? 1
  const col = cols === 2 ? 1 : 0
  return pairs.map((_, i) => Number(logits.data[i * cols + col]))
}

async function initLLM(id: string, modelId: string, contextWindow: number) {
  llmProgressSubs.add(id)

  // Already hot on the requested weights — skip reload.
  if (engine && loadedModelId === modelId) {
    llmProgressSubs.delete(id)
    reply({ id, type: 'llmReady', modelId })
    return
  }

  // Another init in flight for the same model — await it.
  if (llmInitPromise && llmInitTarget === modelId) {
    try {
      await llmInitPromise
      llmProgressSubs.delete(id)
      reply({ id, type: 'llmReady', modelId })
    } catch (err) {
      llmProgressSubs.delete(id)
      throw err
    }
    return
  }

  llmInitTarget = modelId
  llmInitPromise = (async () => {
    const initProgressCallback: InitProgressCallback = (report) => {
      for (const sid of llmProgressSubs) {
        reply({
          id: sid,
          type: 'progress',
          progress: report.progress,
          text: report.text,
        })
      }
    }

    // MLCEngine lives in this worker. reload() swaps weights in place when
    // switching models — still fully on-device.
    if (!engine) {
      engine = new MLCEngine({ initProgressCallback })
    } else {
      engine.setInitProgressCallback(initProgressCallback)
    }

    await engine.reload(modelId, { context_window_size: contextWindow })
    loadedModelId = modelId
  })()

  try {
    await llmInitPromise
    llmProgressSubs.delete(id)
    reply({ id, type: 'llmReady', modelId })
  } catch (err) {
    llmInitPromise = null
    llmInitTarget = null
    loadedModelId = null
    llmProgressSubs.delete(id)
    throw err
  }
}

/**
 * Prefer the engine's own accounting (prefill/decode rates measured on the GPU
 * timeline); fall back to wall-clock timers when usage is unavailable.
 */
function buildStats(
  usage: CompletionUsage | undefined,
  timers: { startedAt: number; firstTokenAt: number | null; finishedAt: number; tokens: number },
): GenerationStats {
  const fallback = statsFromTimers({
    startedAt: timers.startedAt,
    firstTokenAt: timers.firstTokenAt,
    finishedAt: timers.finishedAt,
    completionTokens: usage?.completion_tokens ?? timers.tokens,
  })
  const extra = usage?.extra
  return {
    ttftMs: extra ? extra.time_to_first_token_s * 1000 : fallback.ttftMs,
    decodeTokPerS: extra?.decode_tokens_per_s ?? fallback.decodeTokPerS,
    prefillTokPerS: extra?.prefill_tokens_per_s ?? null,
    promptTokens: usage?.prompt_tokens ?? null,
    completionTokens: usage?.completion_tokens ?? timers.tokens,
    totalMs: extra ? extra.e2e_latency_s * 1000 : fallback.totalMs,
  }
}

async function generate(
  id: string,
  messages: ChatMessage[],
  stream: boolean,
  options: GenerateOptions = {},
) {
  if (!engine) {
    reply({ id, type: 'error', error: 'LLM not initialized. Call initLLM first.' })
    return
  }

  generating = true
  abortRequested = false
  const startedAt = performance.now()
  let firstTokenAt: number | null = null
  let tokens = 0
  try {
    // max_tokens caps decode time; temperature slightly below 1 reduces waffle.
    const genOpts = {
      messages,
      max_tokens: options.maxTokens ?? MAX_NEW_TOKENS,
      // Lower temp → less parroting of table soup; still some variety.
      temperature: options.temperature ?? 0.4,
      top_p: 0.85,
      // Grammar-constrained decoding for structured extraction.
      ...(options.jsonSchema
        ? { response_format: { type: 'json_object' as const, schema: options.jsonSchema } }
        : {}),
    }

    let content = ''
    let usage: CompletionUsage | undefined
    if (stream) {
      const completion = await engine.chat.completions.create({
        ...genOpts,
        stream: true,
        stream_options: { include_usage: true },
      })

      // interruptGenerate() ends this stream on the engine side; the flag check
      // is only a guard against a chunk already in flight.
      for await (const chunk of completion) {
        if (abortRequested) break
        if (chunk.usage) usage = chunk.usage
        const token = chunk.choices[0]?.delta?.content ?? ''
        if (token) {
          if (firstTokenAt == null) firstTokenAt = performance.now()
          tokens += 1
          content += token
          reply({ id, type: 'token', token })
        }
      }
    } else {
      const completion = await engine.chat.completions.create({ ...genOpts, stream: false })
      content = completion.choices[0]?.message?.content ?? ''
      usage = completion.usage
      tokens = usage?.completion_tokens ?? 0
      if (content) firstTokenAt = performance.now()
    }

    const stats = buildStats(usage, {
      startedAt,
      firstTokenAt,
      finishedAt: performance.now(),
      tokens,
    })
    reply({ id, type: abortRequested ? 'aborted' : 'done', content, stats })
  } catch (err) {
    reply({
      id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    generating = false
    abortRequested = false
  }
}

async function search(id: string, query: string, topK: number) {
  const [queryVec] = await embedTexts([query])
  if (!queryVec) {
    reply({ id, type: 'error', error: 'Failed to embed query' })
    return
  }
  reply({ id, type: 'searchResult', results: index.search(queryVec, topK) })
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const msg = ev.data

  try {
    switch (msg.type) {
      case 'initLLM':
        await initLLM(msg.id, msg.modelId, msg.contextWindow)
        break

      case 'initEmbedder': {
        await loadEmbedder(msg.id, (progress, text) => {
          reply({ id: msg.id, type: 'progress', progress, text })
        })
        reply({ id: msg.id, type: 'embedderReady', modelId: EMBED_MODEL_ID })
        // Warm the reranker in the background; the first question should not
        // pay for its download. Failure just means fused order is used.
        void loadReranker().catch(() => {})
        break
      }

      case 'embed': {
        const embeddings = await embedTexts(msg.texts, (done, total) => {
          reply({ id: msg.id, type: 'progress', progress: done / total, text: `Embedding ${done}/${total}` })
        })
        reply({ id: msg.id, type: 'embeddings', embeddings })
        break
      }

      case 'setIndex':
        index.load({ ids: msg.ids, dim: msg.dim, vectors: msg.vectors })
        reply({ id: msg.id, type: 'indexed', size: index.size })
        break

      case 'search':
        await search(msg.id, msg.query, msg.topK)
        break

      case 'rerank': {
        const scores = await scorePairs(msg.pairs, (progress, text) => {
          reply({ id: msg.id, type: 'progress', progress, text })
        })
        reply({ id: msg.id, type: 'rerankResult', scores })
        break
      }

      case 'generate':
        await generate(msg.id, msg.messages, msg.stream, msg.options)
        break

      case 'abort':
        if (generating) {
          abortRequested = true
          // Stops decoding at the next step; the open completion stream ends.
          await engine?.interruptGenerate()
        }
        break
    }
  } catch (err) {
    reply({
      id: msg.id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

export {}
