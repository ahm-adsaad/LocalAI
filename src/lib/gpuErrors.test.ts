import { describe, expect, it } from 'vitest'
import { isGpuMemoryFailure, SIMULATED_OOM_MESSAGE } from './gpuErrors'

describe('isGpuMemoryFailure', () => {
  it('recognises the ways WebGPU and WebLLM report running out of memory', () => {
    for (const msg of [
      'Insufficient GPU memory to load Qwen2.5-3B',
      'Out of memory: failed to allocate buffer',
      'Device lost: reason=unknown',
      'Requested size exceeds maxStorageBufferBindingSize',
      SIMULATED_OOM_MESSAGE,
    ]) {
      expect(isGpuMemoryFailure(new Error(msg)), msg).toBe(true)
    }
  })

  it('leaves other failures alone', () => {
    expect(isGpuMemoryFailure(new Error('Failed to fetch'))).toBe(false)
    expect(isGpuMemoryFailure(new Error('Model not found: foo'))).toBe(false)
    expect(isGpuMemoryFailure(undefined)).toBe(false)
  })
})
