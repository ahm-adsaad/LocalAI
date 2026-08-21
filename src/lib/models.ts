/**
 * On-device model catalog for WebLLM/WebGPU.
 *
 * Choosing a model never leaves the device — we only match capability + VRAM.
 * Families differ by strength (same idea as a hosted model matrix): Qwen tends
 * to win doc Q&A per size; Phi is strong at careful instruction-following;
 * Llama is the industry-familiar generalist.
 *
 * IDs verified against @mlc-ai/web-llm prebuiltAppConfig.
 */

export type ModelOptionId =
  | 'qwen-fast'
  | 'qwen-balanced'
  | 'qwen-quality'
  | 'phi-careful'
  | 'llama-familiar'

export type ModelFamily = 'qwen' | 'phi' | 'llama'

export interface ModelOption {
  id: ModelOptionId
  family: ModelFamily
  label: string
  /** One-line positioning, Claude-matrix style */
  whenYouNeed: string
  examples: string[]
  /** WebLLM prebuilt model_id */
  modelId: string
  approxVramMb: number
  /** Soft gate: warn below this; still allow override */
  recommendAboveMb: number
  contextWindow: number
  speed: 'fastest' | 'fast' | 'moderate'
}

export const MODEL_OPTIONS: Record<ModelOptionId, ModelOption> = {
  'qwen-fast': {
    id: 'qwen-fast',
    family: 'qwen',
    label: 'Qwen 2.5 · 0.5B',
    whenYouNeed: 'Near-instant answers on modest GPUs',
    examples: [
      'Quick chat while models warm',
      'Low-VRAM laptops / integrated graphics',
      'High-volume short questions',
    ],
    modelId: 'Qwen2.5-0.5B-Instruct-q4f16_1-MLC',
    approxVramMb: 450,
    recommendAboveMb: 0,
    contextWindow: 1024,
    speed: 'fastest',
  },
  'qwen-balanced': {
    id: 'qwen-balanced',
    family: 'qwen',
    label: 'Qwen 2.5 · 1.5B',
    whenYouNeed: 'Best all-round document Q&A for most devices',
    examples: [
      'RAG over contracts / reports',
      'Summaries and “what is this about?”',
      'Default daily driver',
    ],
    modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
    approxVramMb: 1200,
    recommendAboveMb: 1536,
    contextWindow: 2048,
    speed: 'fast',
  },
  'qwen-quality': {
    id: 'qwen-quality',
    family: 'qwen',
    label: 'Qwen 2.5 · 3B',
    whenYouNeed: 'Highest available capability in-browser',
    examples: [
      'Harder multi-hop questions',
      'Richer synthesis from excerpts',
      'Stronger instruction following on dense PDFs',
    ],
    modelId: 'Qwen2.5-3B-Instruct-q4f16_1-MLC',
    approxVramMb: 2400,
    recommendAboveMb: 4096,
    contextWindow: 2048,
    speed: 'moderate',
  },
  'phi-careful': {
    id: 'phi-careful',
    family: 'phi',
    label: 'Phi-4 mini',
    whenYouNeed: 'Careful, structured extraction (Microsoft edge SLM)',
    examples: [
      'Cite-the-excerpt answers',
      'Field / metric pull from tables',
      'Less rambling, more precise wording',
    ],
    modelId: 'Phi-4-mini-instruct-q4f16_1-MLC',
    approxVramMb: 2600,
    recommendAboveMb: 4096,
    contextWindow: 2048,
    speed: 'moderate',
  },
  'llama-familiar': {
    id: 'llama-familiar',
    family: 'llama',
    label: 'Llama 3.2 · 3B',
    whenYouNeed: 'Industry-familiar Meta stack / general assistant',
    examples: [
      'Teams standardized on Llama tooling',
      'General chat + light RAG',
      'Ecosystem familiarity over peak tiny-model scores',
    ],
    modelId: 'Llama-3.2-3B-Instruct-q4f16_1-MLC',
    approxVramMb: 2400,
    recommendAboveMb: 4096,
    contextWindow: 2048,
    speed: 'moderate',
  },
}

/** Display order for picker + matrix (capability descending within families). */
export const MODEL_ORDER: ModelOptionId[] = [
  'qwen-quality',
  'phi-careful',
  'llama-familiar',
  'qwen-balanced',
  'qwen-fast',
]

export const DEFAULT_MODEL: ModelOptionId = 'qwen-balanced'

/** Claude-style matrix rows for the UI. */
export const MODEL_MATRIX: Array<{
  whenYouNeed: string
  modelId: ModelOptionId
}> = [
  {
    whenYouNeed: 'The highest available capability on-device',
    modelId: 'qwen-quality',
  },
  {
    whenYouNeed: 'Careful extraction and tight instruction following',
    modelId: 'phi-careful',
  },
  {
    whenYouNeed: 'A familiar Meta/Llama baseline teams already know',
    modelId: 'llama-familiar',
  },
  {
    whenYouNeed: 'Strong doc Q&A at a practical speed / VRAM point',
    modelId: 'qwen-balanced',
  },
  {
    whenYouNeed: 'Lightning-fast answers on limited GPUs',
    modelId: 'qwen-fast',
  },
]

/** Map legacy Fast/Balanced/Quality prefs from earlier builds. */
const LEGACY_TIER_MAP: Record<string, ModelOptionId> = {
  fast: 'qwen-fast',
  balanced: 'qwen-balanced',
  quality: 'qwen-quality',
}

export function resolveModelOptionId(raw: string | null | undefined): ModelOptionId | null {
  if (!raw) return null
  if (raw in MODEL_OPTIONS) return raw as ModelOptionId
  if (raw in LEGACY_TIER_MAP) return LEGACY_TIER_MAP[raw]!
  return null
}

export function isModelOptionId(v: string | null): v is ModelOptionId {
  return resolveModelOptionId(v) != null
}

/**
 * VRAM-aware default. Still only a recommendation — user can pick any row.
 * Prefers Qwen balanced/quality as the capability curve; never forces Llama/Phi.
 */
export function recommendModel(vramMb: number | undefined): ModelOptionId {
  if (vramMb == null || !Number.isFinite(vramMb) || vramMb <= 0) {
    return DEFAULT_MODEL
  }
  if (vramMb >= MODEL_OPTIONS['qwen-quality'].recommendAboveMb) return 'qwen-quality'
  if (vramMb >= MODEL_OPTIONS['qwen-balanced'].recommendAboveMb) return 'qwen-balanced'
  return 'qwen-fast'
}

export function modelFitsComfortably(
  id: ModelOptionId,
  vramMb: number | undefined,
): boolean {
  if (vramMb == null) return true
  return vramMb >= MODEL_OPTIONS[id].recommendAboveMb
}

/** @deprecated Use MODEL_OPTIONS / ModelOptionId — aliases for older imports. */
export type ModelTierId = ModelOptionId
export const MODEL_TIERS = MODEL_OPTIONS
export const DEFAULT_TIER = DEFAULT_MODEL
export const recommendTier = recommendModel
