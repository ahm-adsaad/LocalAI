import { describe, expect, it } from 'vitest'
import { buildPlainChatMessages, buildRagMessages, clipExcerpt, formatExcerpts } from './prompt'
import type { RankedChunk } from './types'

const sources: RankedChunk[] = [
  {
    id: '1',
    documentId: 'd',
    documentName: 'lease.pdf',
    text: 'Rent is $1,200 per month.',
    score: 0.9,
  },
  { id: '2', documentId: 'd', documentName: 'lease.pdf', text: 'The lease ends in June.', score: 0.8 },
]

describe('clipExcerpt', () => {
  const header = 'Patient details. Name: Jordan Lee. Record number RFC-204817. Visit type: annual physical. '
  const filler = 'Routine notes about scheduling and parking follow here for a while. '.repeat(4)
  const fact = 'Jordan Lee has a documented allergy to penicillin with hives in 2016.'
  const chunk = `${header}${filler}${fact}`

  it('keeps the start of the chunk when no focus is given', () => {
    const out = clipExcerpt(chunk, 120)
    expect(out.startsWith('Patient details')).toBe(true)
    expect(out).not.toContain('penicillin')
  })

  it('moves the window to the part of the chunk that matches the question', () => {
    const out = clipExcerpt(chunk, 120, 'What allergy does Jordan Lee have?')
    expect(out).toContain('penicillin')
    expect(out.length).toBeLessThanOrEqual(124)
  })

  it('weights rare query terms over ones that appear throughout the chunk', () => {
    const intro = 'Northwind Analytics review. Prepared for the board. Northwind closed the quarter well. '
    const pad = 'Revenue and retention commentary continues for several sentences here. '.repeat(3)
    const cashFact = 'The company ended the quarter with $21.3 million in cash on hand.'
    const text = `${intro}${pad}${cashFact}`
    const out = clipExcerpt(text, 140, 'How much cash does Northwind have?')
    expect(out).toContain('$21.3 million')
  })

  it('returns short chunks untouched regardless of focus', () => {
    expect(clipExcerpt('short', 120, 'anything')).toBe('short')
  })
})

describe('buildRagMessages', () => {
  it('numbers each excerpt and ends with the question', () => {
    const msgs = buildRagMessages('What is the rent?', sources)
    const user = msgs.at(-1)!.content
    expect(user).toContain('[1] lease.pdf')
    expect(user).toContain('[2] lease.pdf')
    expect(user).toContain('Question: What is the rent?')
  })

  it('carries recent user questions for context but not prior answers', () => {
    // A small model copies its own earlier answer when it sees it again, so a
    // previous "The fact is not there." must not be fed back into the prompt.
    const history = [
      { role: 'user' as const, content: 'Who is the tenant?' },
      { role: 'assistant' as const, content: 'The fact is not there.' },
    ]
    const msgs = buildRagMessages('When does her lease end?', sources, history)
    const joined = msgs.map((m) => m.content).join('\n')
    expect(joined).toContain('Who is the tenant?')
    expect(joined).not.toContain('The fact is not there.')
    expect(msgs.every((m) => m.role !== 'assistant')).toBe(true)
  })
})

describe('buildPlainChatMessages', () => {
  it('keeps only the last four history turns', () => {
    const history = Array.from({ length: 10 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `turn ${i}`,
    }))
    const msgs = buildPlainChatMessages(history, 'hi')
    expect(msgs).toHaveLength(6)
    expect(msgs[1]!.content).toBe('turn 6')
  })
})

describe('formatExcerpts', () => {
  it('labels each excerpt with its page so the model can say where a fact lives', () => {
    const out = formatExcerpts([{ ...sources[0]!, pageStart: 3, pageEnd: 3 }, sources[1]!])
    expect(out).toContain('[1] lease.pdf (p. 3)\n')
    expect(out).toContain('[2] lease.pdf\n')
  })
})
