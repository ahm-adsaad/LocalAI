import { describe, expect, it } from 'vitest'
import { nextSmallerModel } from './models'

describe('nextSmallerModel', () => {
  it('steps down the VRAM ladder one model at a time', () => {
    expect(nextSmallerModel('qwen-quality')).toBe('qwen-balanced')
    expect(nextSmallerModel('phi-careful')).toBe('qwen-balanced')
    expect(nextSmallerModel('llama-familiar')).toBe('qwen-balanced')
    expect(nextSmallerModel('qwen-balanced')).toBe('qwen-fast')
  })

  it('has nowhere to go below the smallest model', () => {
    expect(nextSmallerModel('qwen-fast')).toBeNull()
  })
})
