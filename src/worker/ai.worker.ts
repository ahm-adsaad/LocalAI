/**
 * AI worker — owns both the WebLLM engine and the embedding pipeline.
 *
 * Why a worker: WebGPU shader compile, weight load, embedding forward passes,
 * and token generation are all CPU/GPU heavy. Running them here keeps the React
 * UI responsive (scrolling, typing, progress bars) during multi-second loads.
 *
 * Nothing in this file ever POSTs document text, prompts, or embeddings to a
 * server. Network use is limited to the one-time download of model weights
 * (cached thereafter by the browser Cache API / Transformers.js cache).
 */
import { MLCEngine, type InitProgressCallback } from '@mlc-ai/web-llm'
import {
  env,
  pipeline,
  type FeatureExtractionPipeline,
} from '@huggingface/transformers'
import {
  EMBED_MODEL_ID,
  MAX_NEW_TOKENS,
  type ChatMessage,
  type ScoredChunkId,
  type WorkerEvent,
  type WorkerRequest,
} from '../lib/types'

// Prefer browser cache so the embedding model works offline after first fetch.
env.allowLocalModels = false
env.useBrowserCache = true

let engine: MLCEngine | null = null
let loadedModelId: string | null = null
let embedder: FeatureExtractionPipeline | null = null
let generating = false
/** Deduplicate concurrent initLLM calls (React StrictMode remounts). */
let llmInitPromise: Promise<void> | null = null
let llmInitTarget: string | null = null
let embedInitPromise: Promise<FeatureExtractionPipeline> | null = null
/** Request ids that should receive LLM load progress (handles StrictMode double-mount). */
const llmProgressSubs = new Set<string>()
const embedProgressSubs = new Map<string, (p: number, text: string) => void>()

function reply(msg: WorkerEvent) {
  self.postMessage(msg)
}

/** Cosine similarity — both vectors should already be L2-normalized. */
function cosine(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!
  return dot
}

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
      // LLM for WebGPU VRAM (the 1B Q4 model already owns most of the GPU budget).
      embedder = await pipeline('feature-extraction', EMBED_MODEL_ID, {
        dtype: 'q8',
        progress_callback: (data) => {
          if (data.status === 'progress') {
            broadcastEmbedProgress(
              Math.min(0.95, data.progress / 100),
              `Embedding weights: ${data.file} ${data.progress.toFixed(0)}%`,
            )
          } else if (data.status === 'progress_total') {
            broadcastEmbedProgress(
              Math.min(0.95, data.progress / 100),
              `Embedding weights ${data.progress.toFixed(0)}%`,
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

async function embedTexts(texts: string[]): Promise<number[][]> {
  const pipe = await loadEmbedder()
  const out: number[][] = []

  // One text at a time to bound peak memory in the worker.
  for (const text of texts) {
    const result = await pipe(text, { pooling: 'mean', normalize: true })
    const arr = result.tolist() as number[][]
    out.push(arr[0] ?? [])
  }
  return out
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
    // switching Fast/Balanced/Quality — still fully on-device.
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

async function generate(id: string, messages: ChatMessage[], stream: boolean) {
  if (!engine) {
    reply({ id, type: 'error', error: 'LLM not initialized. Call initLLM first.' })
    return
  }

  generating = true
  try {
    // max_tokens caps decode time; temperature slightly below 1 reduces waffle.
    const genOpts = {
      messages,
      max_tokens: MAX_NEW_TOKENS,
      // Lower temp → less parroting of table soup; still some variety.
      temperature: 0.4,
      top_p: 0.85,
    } as const

    if (stream) {
      let full = ''
      const completion = await engine.chat.completions.create({
        ...genOpts,
        stream: true,
        stream_options: { include_usage: false },
      })

      for await (const chunk of completion) {
        if (!generating) {
          reply({ id, type: 'aborted' })
          return
        }
        const token = chunk.choices[0]?.delta?.content ?? ''
        if (token) {
          full += token
          reply({ id, type: 'token', token })
        }
      }
      reply({ id, type: 'done', content: full })
    } else {
      const completion = await engine.chat.completions.create({
        ...genOpts,
        stream: false,
      })
      const content = completion.choices[0]?.message?.content ?? ''
      reply({ id, type: 'done', content })
    }
  } catch (err) {
    reply({
      id,
      type: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    generating = false
  }
}

async function search(
  id: string,
  query: string,
  chunks: Array<{ id: string; embedding: number[] }>,
  topK: number,
) {
  const [queryVec] = await embedTexts([query])
  if (!queryVec) {
    reply({ id, type: 'error', error: 'Failed to embed query' })
    return
  }

  // Brute-force cosine — vectors only; main thread rehydrates chunk text.
  const scored: ScoredChunkId[] = chunks.map((c) => ({
    id: c.id,
    score: cosine(queryVec, c.embedding),
  }))

  scored.sort((a, b) => b.score - a.score)
  reply({ id, type: 'searchResult', results: scored.slice(0, topK) })
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
        break
      }

      case 'embed': {
        const embeddings = await embedTexts(msg.texts)
        reply({ id: msg.id, type: 'embeddings', embeddings })
        break
      }

      case 'search':
        await search(msg.id, msg.query, msg.chunks, msg.topK)
        break

      case 'generate':
        await generate(msg.id, msg.messages, msg.stream)
        break

      case 'abort':
        // Soft abort: the generate loop checks `generating` between tokens.
        generating = false
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
