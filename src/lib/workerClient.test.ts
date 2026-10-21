import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { WorkerEvent, WorkerRequest } from './types'

/** Minimal stand-in for the browser Worker: records posts, lets tests emit events. */
class FakeWorker {
  static last: FakeWorker | null = null
  onmessage: ((ev: MessageEvent<WorkerEvent>) => void) | null = null
  onerror: ((ev: unknown) => void) | null = null
  posted: WorkerRequest[] = []
  constructor() {
    FakeWorker.last = this
  }
  postMessage(msg: WorkerRequest) {
    this.posted.push(msg)
  }
  terminate() {}
  emit(event: WorkerEvent) {
    this.onmessage?.({ data: event } as MessageEvent<WorkerEvent>)
  }
}

const stats = {
  ttftMs: 10,
  decodeTokPerS: 5,
  prefillTokPerS: null,
  promptTokens: null,
  completionTokens: 2,
  totalMs: 400,
}

describe('WorkerClient abort', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', FakeWorker)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    FakeWorker.last = null
  })

  it('posts an abort request and resolves the in-flight generation with the partial text', async () => {
    const { WorkerClient } = await import('./workerClient')
    const client = new WorkerClient()
    const worker = FakeWorker.last!
    const tokens: string[] = []

    const pending = client.generate([{ role: 'user', content: 'hi' }], {
      stream: true,
      onToken: (t) => tokens.push(t),
    })
    const id = worker.posted[0]!.id
    worker.emit({ id, type: 'token', token: 'Hel' })
    worker.emit({ id, type: 'token', token: 'lo' })

    client.abort()
    expect(worker.posted.some((m) => m.type === 'abort')).toBe(true)

    // The worker interrupts the engine and reports what was produced so far.
    worker.emit({ id, type: 'aborted', content: 'Hello', stats })
    await expect(pending).resolves.toEqual({ content: 'Hello', stats, aborted: true })
    expect(tokens).toEqual(['Hel', 'lo'])
  })
})
