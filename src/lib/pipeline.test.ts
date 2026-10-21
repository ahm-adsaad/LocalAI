import { describe, expect, it } from 'vitest'
import { answerQuestion } from './pipeline'
import type { GenerationStats, RankedChunk, RerankPair, StoredChunk } from './types'
import type { WorkerClient } from './workerClient'

/**
 * The pipeline against a stub worker: no models, just the contract. The
 * sentence-focus step must never break an answer, whatever the worker does.
 */

const stats: GenerationStats = {
  ttftMs: 5,
  decodeTokPerS: 10,
  prefillTokPerS: null,
  promptTokens: 100,
  completionTokens: 3,
  totalMs: 300,
}

const sentence = (n: number) => `Fact number ${n} is written on this line of the document.`
const longText = Array.from({ length: 10 }, (_, i) => sentence(i + 1)).join(' ')
const chunks: StoredChunk[] = [
  { id: 'a', documentId: 'd', documentName: 'd.pdf', index: 0, text: longText, embedding: [1] },
  { id: 'b', documentId: 'd', documentName: 'd.pdf', index: 1, text: 'Short chunk.', embedding: [1] },
]

function stubWorker(scorePairs: (pairs: RerankPair[]) => Promise<number[]>): WorkerClient {
  const stub = {
    search: async () => chunks.map((c) => ({ id: c.id, score: 1 })),
    rerank: async (_q: string, ranked: RankedChunk[]) => ranked.map(() => 0),
    scorePairs,
    generate: async () => ({ content: 'ok', stats }),
  }
  return stub as unknown as WorkerClient
}

describe('answerQuestion sentence focus', () => {
  it('anchors clipped sources on the best-scoring sentence and records the time', async () => {
    const worker = stubWorker(async (pairs) => pairs.map((p) => (p.text.includes('number 9') ? 5 : 0)))
    const res = await answerQuestion({ worker, chunks, history: [], text: 'Where is fact nine?', modelId: 'm' })
    const long = res.sources.find((s) => s.id === 'a')!
    expect(long.focusStart).toBe(longText.indexOf(sentence(9)))
    expect(res.stats.focusMs).toBeTypeOf('number')
  })

  it('falls back to the lexical window when scoring fails', async () => {
    const worker = stubWorker(async () => {
      throw new Error('reranker unavailable')
    })
    const res = await answerQuestion({ worker, chunks, history: [], text: 'Where is fact nine?', modelId: 'm' })
    expect(res.sources.every((s) => s.focusStart === undefined)).toBe(true)
    expect(res.stats.focusMs).toBeNull()
    expect(res.content).toBe('ok')
  })

  it('ignores a score list of the wrong length', async () => {
    const worker = stubWorker(async () => [1])
    const res = await answerQuestion({ worker, chunks, history: [], text: 'Where is fact nine?', modelId: 'm' })
    expect(res.sources.every((s) => s.focusStart === undefined)).toBe(true)
    expect(res.stats.focusMs).toBeNull()
  })
})
