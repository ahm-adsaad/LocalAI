import type {
  ChatMessage,
  InitProgress,
  ScoredChunkId,
  WorkerEvent,
  WorkerRequest,
} from './types'

type ProgressHandler = (p: InitProgress) => void

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

  private post(msg: WorkerRequest) {
    this.worker.postMessage(msg)
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
      case 'searchResult':
        this.pending.delete(event.id)
        slot.resolve(event.results)
        break
      case 'done':
        this.pending.delete(event.id)
        slot.resolve(event.content)
        break
      case 'aborted':
        this.pending.delete(event.id)
        slot.reject(new Error('Generation aborted'))
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
  ): Promise<T> {
    const id = this.nextId()
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
        onProgress: hooks?.onProgress,
        onToken: hooks?.onToken,
      })
      this.post({ ...body, id } as WorkerRequest)
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

  embed(texts: string[]) {
    return this.request<number[][]>({ type: 'embed', texts })
  }

  search(query: string, chunks: Array<{ id: string; embedding: number[] }>, topK: number) {
    return this.request<ScoredChunkId[]>({ type: 'search', query, chunks, topK })
  }

  generate(
    messages: ChatMessage[],
    opts: { stream: boolean; onToken?: (token: string) => void },
  ) {
    return this.request<string>(
      { type: 'generate', messages, stream: opts.stream },
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
  }
}

let singleton: WorkerClient | null = null

export function getWorkerClient(): WorkerClient {
  if (!singleton) singleton = new WorkerClient()
  return singleton
}
