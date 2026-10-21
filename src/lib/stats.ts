import type { GenerationStats, TurnStats } from './types'

/**
 * Fallback timing math for when the engine does not report usage. WebLLM
 * normally gives us `usage.extra` (TTFT, decode tok/s); these timers cover the
 * aborted / error paths and keep the UI honest either way.
 */
export function statsFromTimers(input: {
  startedAt: number
  firstTokenAt: number | null
  finishedAt: number
  completionTokens: number
}): Pick<GenerationStats, 'ttftMs' | 'decodeTokPerS' | 'totalMs'> {
  const { startedAt, firstTokenAt, finishedAt, completionTokens } = input
  const totalMs = Math.max(0, finishedAt - startedAt)
  if (firstTokenAt == null || completionTokens <= 0) {
    return { ttftMs: null, decodeTokPerS: 0, totalMs }
  }
  const decodeMs = Math.max(1, finishedAt - firstTokenAt)
  return {
    ttftMs: Math.max(0, firstTokenAt - startedAt),
    decodeTokPerS: completionTokens / (decodeMs / 1000),
    totalMs,
  }
}

/** One-line footer under an assistant turn: throughput first, then latencies. */
export function formatTurnStats(stats: TurnStats): string {
  const parts: string[] = [`${stats.decodeTokPerS.toFixed(1)} tok/s`]
  if (stats.ttftMs != null) parts.push(`TTFT ${(stats.ttftMs / 1000).toFixed(1)} s`)
  if (stats.promptTokens != null) parts.push(`${stats.promptTokens} prompt tok`)
  if (stats.retrievalMs != null) parts.push(`retrieval ${Math.round(stats.retrievalMs)} ms`)
  if (stats.rerankMs != null) parts.push(`rerank ${Math.round(stats.rerankMs)} ms`)
  if (stats.condenseMs != null) parts.push(`rewrite ${Math.round(stats.condenseMs)} ms`)
  return parts.join(' · ')
}
