import { rerankPairs } from './rerank'
import type {
  ChatMessage,
  GenerateOptions,
  GenerationStats,
  InitProgress,
  RankedChunk,
  RerankPair,
  ScoredChunkId,
  StoredChunk,
  WorkerEvent,
  WorkerRequest,
} from './types'
import { packVectors } from './vectorIndex'

type ProgressHandler = (p: InitProgress) => void

export interface GenerateResult {
  content: string
  stats: GenerationStats
  /** True when the user stopped generation; `content` is the partial answer. */
  aborted?: boolean
}

/** Distributive Omit so discriminated union members keep their own fields. */
type WorkerRequestBody = WorkerRequest extends infer R
  ? R extends WorkerRequest
    ? Omit<R, 'id'>
    : never
  : never

/**
 * Typed facade over the AI worker. The React tree must never import WebLLM or
 * Transformers.js directly — only this client — so model weights and tensors
 * stay isolated in the worker thread.
 */
export class WorkerClient {
  private worker: Worker
  private pending = new Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (err: Error) => void
      onProgress?: ProgressHandler
      onToken?: (token: string) => void
    }
  >()
  private seq = 0
  /** Which chunk set the worker's dense index currently holds. */
  private indexedKey: string | null = null
  private indexing: Promise<void> | null = null

  constructor() {
    this.worker = new Worker(new URL('../worker/ai.worker.ts', import.meta.url), {
      type: 'module',
    })
    this.worker.onmessage = (ev: MessageEvent<WorkerEvent>) => {
      this.handleEvent(ev.data)
    }
    this.worker.onerror = (ev) => {
      console.error('AI worker error', ev)
    }
  }

  private nextId() {
    this.seq += 1
    return `req-${this.seq}`
  }

  private post(msg: WorkerRequest, transfer: Transferable[] = []) {
    this.worker.postMessage(msg, transfer)
  }

  private handleEvent(event: WorkerEvent) {
    const slot = this.pending.get(event.id)
    if (!slot) return

    switch (event.type) {
      case 'progress':
        slot.onProgress?.({ progress: event.progress, text: event.text })
        break
      case 'token':
        slot.onToken?.(event.token)
        break
      case 'llmReady':
      case 'embedderReady':
        this.pending.delete(event.id)
        slot.resolve(event)
        break
      case 'embeddings':
        this.pending.delete(event.id)
        slot.resolve(event.embeddings)
        break
      case 'indexed':
        this.pending.delete(event.id)
        slot.resolve(event.size)
        break
      case 'searchResult':
        this.pending.delete(event.id)
        slot.resolve(event.results)
        break
      case 'rerankResult':
        this.pending.delete(event.id)
        slot.resolve(event.scores)
        break
      case 'done':
        this.pending.delete(event.id)
        slot.resolve({ content: event.content, stats: event.stats })
        break
      case 'aborted':
        this.pending.delete(event.id)
        slot.resolve({ content: event.content, stats: event.stats, aborted: true })
        break
      case 'error':
        this.pending.delete(event.id)
        slot.reject(new Error(event.error))
        break
    }
  }

  private request<T>(
    body: WorkerRequestBody,
    hooks?: { onProgress?: ProgressHandler; onToken?: (token: string) => void },
    transfer: Transferable[] = [],
  ): Promise<T> {
    const id = this.nextId()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress: hooks?.onProgress,
        onToken: hooks?.onToken,
      })
      this.post({ ...body, id } as WorkerRequest, transfer)
    })
  }

  initLLM(
    opts: { modelId: string; contextWindow: number },
    onProgress?: ProgressHandler,
  ) {
    return this.request<{ type: 'llmReady'; modelId: string }>(
      { type: 'initLLM', modelId: opts.modelId, contextWindow: opts.contextWindow },
      { onProgress },
    )
  }

  initEmbedder(onProgress?: ProgressHandler) {
    return this.request<{ type: 'embedderReady'; modelId: string }>(
      { type: 'initEmbedder' },
      { onProgress },
    )
  }

  embed(texts: string[], onProgress?: ProgressHandler) {
    return this.request<number[][]>({ type: 'embed', texts }, { onProgress })
  }

  /**
   * Make sure the worker's index holds exactly these chunks. Vectors cross the
   * thread boundary once per library change as a single transferred buffer;
   * the per-query message is just the question.
   */
  private syncIndex(chunks: StoredChunk[]): Promise<void> {
    const key = chunks.map((c) => c.id).join('\n')
    if (key === this.indexedKey) return Promise.resolve()
    if (!this.indexing) {
      const packed = packVectors(chunks)
      this.indexing = this.request<number>(
        { type: 'setIndex', ids: packed.ids, dim: packed.dim, vectors: packed.vectors },
        undefined,
        [packed.vectors.buffer],
      )
        .then(() => {
          this.indexedKey = key
        })
        .finally(() => {
          this.indexing = null
        })
    }
    return this.indexing
  }

  async search(query: string, chunks: StoredChunk[], topK: number) {
    await this.syncIndex(chunks)
    return this.request<ScoredChunkId[]>({ type: 'search', query, topK })
  }

  /** Cross-encoder logits for arbitrary (query, text) pairs, in order. */
  scorePairs(pairs: RerankPair[], onProgress?: ProgressHandler) {
    if (pairs.length === 0) return Promise.resolve<number[]>([])
    return this.request<number[]>({ type: 'rerank', pairs }, { onProgress })
  }

  /** Cross-encoder scores for the first `pool` candidates, aligned with `ranked`. */
  rerank(query: string, ranked: RankedChunk[], pool: number, onProgress?: ProgressHandler) {
    return this.scorePairs(rerankPairs(query, ranked, pool), onProgress)
  }

  generate(
    messages: ChatMessage[],
    opts: { stream: boolean; onToken?: (token: string) => void; options?: GenerateOptions },
  ) {
    return this.request<GenerateResult>(
      { type: 'generate', messages, stream: opts.stream, options: opts.options },
      { onToken: opts.onToken },
    )
  }

  abort() {
    const id = this.nextId()
    this.post({ id, type: 'abort' })
  }

  terminate() {
    this.worker.terminate()
    this.pending.clear()
    this.indexedKey = null
  }
}

let singleton: WorkerClient | null = null

export function getWorkerClient(): WorkerClient {
  if (!singleton) singleton = new WorkerClient()
  return singleton
}
