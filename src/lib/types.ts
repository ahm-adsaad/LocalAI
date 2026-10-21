/** Chat roles match WebLLM's OpenAI-compatible message shape. */
export type ChatRole = 'system' | 'user' | 'assistant'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface DocumentMeta {
  id: string
  /** Each PDF belongs to one chat — switching chats switches the library. */
  chatId: string
  name: string
  /** 0 means unpaged (text and Markdown files). */
  pageCount: number
  chunkCount: number
  createdAt: number
  sizeBytes: number
}

export interface StoredChunk {
  id: string
  documentId: string
  documentName: string
  index: number
  text: string
  /** Float32 embedding vector produced by the on-device MiniLM pipeline. */
  embedding: number[]
  /** 1-based page range the chunk was cut from; absent on chunks indexed before pages were tracked. */
  pageStart?: number
  pageEnd?: number
}

export interface RankedChunk {
  id: string
  documentId: string
  documentName: string
  text: string
  score: number
  /** Cross-encoder relevance logit, present when this chunk was in the reranked pool. */
  rerankScore?: number
  /**
   * Offset into `text.trim()` of a sentence the excerpt must contain (the one
   * the cross-encoder rated most relevant); the lexical window is kept as well.
   */
  focusStart?: number
  pageStart?: number
  pageEnd?: number
}

/** Worker returns scores; main thread rehydrates text for the prompt/UI. */
export interface ScoredChunkId {
  id: string
  score: number
}

/** One (question, candidate text) pair for the cross-encoder. */
export interface RerankPair {
  query: string
  text: string
}

/** Engine-level timings for one generation, reported by the worker. */
export interface GenerationStats {
  /** Time to first token; null if nothing was produced. */
  ttftMs: number | null
  decodeTokPerS: number
  prefillTokPerS: number | null
  promptTokens: number | null
  completionTokens: number
  totalMs: number
}

/** Per-turn observability shown under each answer and persisted with the chat. */
export interface TurnStats extends GenerationStats {
  modelId: string
  retrievalMs: number | null
  /** Cross-encoder pass over the fused candidates; null when it did not run. */
  rerankMs: number | null
  /** Cross-encoder pass over the sentences of clipped excerpts; null when it did not run. */
  focusMs: number | null
  /** Time spent rewriting a follow-up into a standalone question. */
  condenseMs: number | null
}

/** One row of a structured extraction; `source` is the 1-based excerpt index. */
export interface ExtractedField {
  name: string
  value: string | null
  source: number | null
}

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: RankedChunk[]
  streaming?: boolean
  stats?: TurnStats
  /** The standalone question actually used for retrieval, if it was rewritten. */
  retrievalQuery?: string
  extraction?: ExtractedField[]
  /** The user stopped generation; `content` is what had been produced. */
  aborted?: boolean
}

export interface ChatSession {
  id: string
  title: string
  createdAt: number
  updatedAt: number
  turns: ChatTurn[]
}

export interface InitProgress {
  progress: number
  text: string
}

/** UI lifecycle for the on-device model boot. */
export type ModelPhase = 'idle' | 'loading-llm' | 'loading-embed' | 'ready' | 'error'

/* ---------- Worker protocol ---------- */

export type WorkerRequest =
  | {
      id: string
      type: 'initLLM'
      modelId: string
      contextWindow: number
      simulateFailure?: 'oom'
    }
  | { id: string; type: 'initEmbedder' }
  | { id: string; type: 'embed'; texts: string[] }
  | {
      id: string
      type: 'setIndex'
      /** Row-major, L2-normalised; transferred, not copied. */
      ids: string[]
      dim: number
      vectors: Float32Array
    }
  | { id: string; type: 'search'; query: string; topK: number }
  | { id: string; type: 'rerank'; pairs: RerankPair[] }
  | {
      id: string
      type: 'generate'
      messages: ChatMessage[]
      stream: boolean
      options?: GenerateOptions
    }
  | { id: string; type: 'abort' }

export interface GenerateOptions {
  maxTokens?: number
  temperature?: number
  /** JSON schema string; when set, decoding is grammar-constrained to match it. */
  jsonSchema?: string
}

export type WorkerEvent =
  | { id: string; type: 'progress'; progress: number; text: string }
  | { id: string; type: 'llmReady'; modelId: string }
  | { id: string; type: 'embedderReady'; modelId: string }
  | { id: string; type: 'embeddings'; embeddings: number[][] }
  | { id: string; type: 'indexed'; size: number }
  | { id: string; type: 'searchResult'; results: ScoredChunkId[] }
  | { id: string; type: 'rerankResult'; scores: number[] }
  | { id: string; type: 'token'; token: string }
  | { id: string; type: 'done'; content: string; stats: GenerationStats }
  | { id: string; type: 'aborted'; content: string; stats: GenerationStats }
  | { id: string; type: 'error'; error: string }

/**
 * Small sentence embedding model for RAG. ONNX build via Transformers.js
 * entirely in the worker — never sent to a server.
 */
export const EMBED_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'
/**
 * Cross-encoder that re-scores the fused candidates. Chosen by
 * `npm run eval:models` (see eval/results/models.md); also WASM, also on-device.
 */
export const RERANK_MODEL_ID = 'Xenova/ms-marco-MiniLM-L-6-v2'

export const TOP_K = 3
/** Overview still stays small — long prompts dominate WebGPU prefill time. */
export const TOP_K_OVERVIEW = 4
/** Structured extraction needs a little more coverage than a single-fact answer. */
export const TOP_K_EXTRACT = 5
/**
 * How many cosine hits to pull before fusing with BM25.
 * Wider pool → better hybrid recall; still cheap at browser library sizes.
 */
export const HYBRID_CANDIDATE_POOL = 24
/** Cap each excerpt in the LLM prompt (full text stays in IndexedDB / UI). */
export const EXCERPT_MAX_CHARS = 360
/** Decode budget: enough for a short prose answer without endless dumping. */
export const MAX_NEW_TOKENS = 180
/** Fallback KV window if a tier does not specify one. */
export const CONTEXT_WINDOW_SIZE = 2048
export const CHUNK_SIZE = 700
export const CHUNK_OVERLAP = 120
