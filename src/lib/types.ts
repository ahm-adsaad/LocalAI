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
}

export interface RankedChunk {
  id: string
  documentId: string
  documentName: string
  text: string
  score: number
}

/** Worker returns scores; main thread rehydrates text for the prompt/UI. */
export interface ScoredChunkId {
  id: string
  score: number
}

export interface ChatTurn {
  id: string
  role: 'user' | 'assistant'
  content: string
  sources?: RankedChunk[]
  streaming?: boolean
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

/* ---------- Worker protocol ---------- */

export type WorkerRequest =
  | { id: string; type: 'initLLM'; modelId: string; contextWindow: number }
  | { id: string; type: 'initEmbedder' }
  | { id: string; type: 'embed'; texts: string[] }
  | {
      id: string
      type: 'search'
      query: string
      /** Vectors only — text stays on the main thread to keep postMessage light. */
      chunks: Array<{ id: string; embedding: number[] }>
      topK: number
    }
  | { id: string; type: 'generate'; messages: ChatMessage[]; stream: boolean }
  | { id: string; type: 'abort' }

export type WorkerEvent =
  | { id: string; type: 'progress'; progress: number; text: string }
  | { id: string; type: 'llmReady'; modelId: string }
  | { id: string; type: 'embedderReady'; modelId: string }
  | { id: string; type: 'embeddings'; embeddings: number[][] }
  | { id: string; type: 'searchResult'; results: ScoredChunkId[] }
  | { id: string; type: 'token'; token: string }
  | { id: string; type: 'done'; content: string }
  | { id: string; type: 'error'; error: string }
  | { id: string; type: 'aborted' }

/**
 * Small sentence embedding model for RAG. ONNX build via Transformers.js
 * entirely in the worker — never sent to a server.
 */
export const EMBED_MODEL_ID = 'Xenova/all-MiniLM-L6-v2'

export const TOP_K = 3
/** Overview still stays small — long prompts dominate WebGPU prefill time. */
export const TOP_K_OVERVIEW = 4
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
