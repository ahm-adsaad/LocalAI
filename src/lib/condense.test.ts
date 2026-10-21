import { describe, expect, it } from 'vitest'
import { buildCondenseMessages, cleanCondensed, needsCondensing } from './condense'
import type { ChatMessage } from './types'

const history: ChatMessage[] = [
  { role: 'user', content: 'Who is the tenant on the lease?' },
  { role: 'assistant', content: 'The tenant is Maria Gomez.' },
]

describe('needsCondensing', () => {
  it('is false when there is no prior conversation', () => {
    expect(needsCondensing('When does her lease end?', [])).toBe(false)
  })

  it('is true for a follow-up that leans on a pronoun', () => {
    expect(needsCondensing('When does her lease end?', history)).toBe(true)
  })

  it('is true for a short "what about" style follow-up', () => {
    expect(needsCondensing('what about the deposit?', history)).toBe(true)
  })

  it('is false for a long self-contained question', () => {
    expect(
      needsCondensing('What is the monthly rent amount stated in the lease agreement?', history),
    ).toBe(false)
  })
})

describe('buildCondenseMessages', () => {
  it('includes the transcript and the follow-up and asks for a standalone question', () => {
    const msgs = buildCondenseMessages(history, 'When does her lease end?')
    const text = msgs.map((m) => m.content).join('\n')
    expect(text).toContain('Maria Gomez')
    expect(text).toContain('When does her lease end?')
    expect(text.toLowerCase()).toContain('standalone')
  })
})

describe('cleanCondensed', () => {
  it('strips surrounding quotes, labels, and extra lines', () => {
    const raw = 'Standalone question: "When does Maria Gomez\'s lease end?"\nExtra commentary.'
    expect(cleanCondensed(raw, 'fallback')).toBe("When does Maria Gomez's lease end?")
  })

  it('falls back to the original question when the rewrite is empty', () => {
    expect(cleanCondensed('   ', 'original')).toBe('original')
  })

  it('falls back when the rewrite is unreasonably long', () => {
    expect(cleanCondensed('x'.repeat(400), 'original')).toBe('original')
  })
})
