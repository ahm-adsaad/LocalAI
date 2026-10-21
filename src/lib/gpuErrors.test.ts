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

  it('recognises bare OOM, DeviceLost, plain strings and the simulated message alone', () => {
    expect(isGpuMemoryFailure(new Error('OOM when allocating'))).toBe(true)
    expect(isGpuMemoryFailure(new Error('DeviceLost'))).toBe(true)
    expect(isGpuMemoryFailure('Out of memory')).toBe(true)
    expect(isGpuMemoryFailure(new Error(SIMULATED_OOM_MESSAGE))).toBe(true)
  })

  it('does not mistake unrelated messages for memory failures', () => {
    expect(isGpuMemoryFailure(new Error('prompt exceeds the context window'))).toBe(false)
    expect(isGpuMemoryFailure(new Error('Insufficient storage quota'))).toBe(false)
    expect(isGpuMemoryFailure(new Error('No room for another tab'))).toBe(false)
    expect(isGpuMemoryFailure(null)).toBe(false)
  })

  it('leaves other failures alone', () => {
    expect(isGpuMemoryFailure(new Error('Failed to fetch'))).toBe(false)
    expect(isGpuMemoryFailure(new Error('Model not found: foo'))).toBe(false)
    expect(isGpuMemoryFailure(undefined)).toBe(false)
  })
})
