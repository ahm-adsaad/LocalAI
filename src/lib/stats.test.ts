import { describe, expect, it } from 'vitest'
import { formatTurnStats, statsFromTimers } from './stats'

describe('statsFromTimers', () => {
  it('derives time to first token and decode throughput from timestamps', () => {
    const stats = statsFromTimers({
      startedAt: 1000,
      firstTokenAt: 1800,
      finishedAt: 3800,
      completionTokens: 40,
    })
    expect(stats.ttftMs).toBe(800)
    // 40 tokens over the 2 s decode window after the first token.
    expect(stats.decodeTokPerS).toBeCloseTo(20, 5)
    expect(stats.totalMs).toBe(2800)
  })

  it('reports zero throughput when no tokens were produced', () => {
    const stats = statsFromTimers({
      startedAt: 0,
      firstTokenAt: null,
      finishedAt: 500,
      completionTokens: 0,
    })
    expect(stats.ttftMs).toBeNull()
    expect(stats.decodeTokPerS).toBe(0)
  })
})

describe('formatTurnStats', () => {
  it('renders a compact one-line summary', () => {
    const line = formatTurnStats({
      modelId: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC',
      ttftMs: 912,
      decodeTokPerS: 18.26,
      prefillTokPerS: 310.4,
      promptTokens: 410,
      completionTokens: 62,
      totalMs: 4300,
      retrievalMs: 12,
      rerankMs: 41,
      condenseMs: null,
    })
    expect(line).toBe('18.3 tok/s · TTFT 0.9 s · 410 prompt tok · retrieval 12 ms · rerank 41 ms')
  })

  it('omits sections whose data is missing', () => {
    const line = formatTurnStats({
      modelId: 'm',
      ttftMs: null,
      decodeTokPerS: 5,
      prefillTokPerS: null,
      promptTokens: null,
      completionTokens: 3,
      totalMs: 1000,
      retrievalMs: null,
      rerankMs: null,
      condenseMs: 650,
    })
    expect(line).toBe('5.0 tok/s · rewrite 650 ms')
  })
})
