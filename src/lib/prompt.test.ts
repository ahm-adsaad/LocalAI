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

describe('clipExcerpt with a sentence anchor', () => {
  const chunk = [
    'There are no known food allergies and no latex sensitivity.',
    'Current medications',
    'Lisinopril 10 mg, one tablet by mouth every morning, for hypertension. Started in September 2024.',
    'Atorvastatin 20 mg, one tablet at bedtime, for elevated LDL cholesterol. Started in January 2025.',
    'Cetirizine 10 mg as needed for seasonal allergies. The patient reports using it roughly twice a week.',
    'Vital signs at this visit',
    'Blood pressure was 128/82 mmHg, down from 142/91 mmHg at the September 2024 visit. Heart rate was 68.',
  ].join('\n')
  const question = 'What medication does Jordan Lee take for blood pressure?'

  it('loses a paraphrased answer when only the literal question terms steer the window', () => {
    // The vitals line matches "blood pressure" literally; the answer says "hypertension".
    expect(clipExcerpt(chunk, 200, question)).not.toContain('Lisinopril 10 mg')
  })

  it('adds the anchored sentence, in document order, when it falls outside the lexical window', () => {
    const anchor = chunk.indexOf('Lisinopril')
    const out = clipExcerpt(chunk, 200, question, anchor)
    // Both signals survive: the literal vitals line and the paraphrased answer.
    expect(out).toContain('Lisinopril 10 mg, one tablet by mouth every morning, for hypertension.')
    expect(out).toContain('Blood pressure was 128/82')
    expect(out.indexOf('Lisinopril')).toBeLessThan(out.indexOf('Blood pressure'))
    expect(out).toContain('\n…\n')
    // One window plus one capped sentence, never a second window.
    expect(out.length).toBeLessThanOrEqual(200 + 160 + 8)
  })

  it('keeps a single window when the anchored sentence already sits inside it', () => {
    const anchor = chunk.indexOf('Blood pressure')
    expect(clipExcerpt(chunk, 200, question, anchor)).toBe(clipExcerpt(chunk, 200, question))
  })

  it('caps a long anchored sentence instead of adding a second window', () => {
    const long = `${'Alpha beta gamma delta '.repeat(20)}epsilon.`
    const text = `${long}\nUnrelated line about something else entirely that fills the budget. `.repeat(2)
    const anchor = 0
    const out = clipExcerpt(text, 120, 'unrelated something', anchor)
    expect(out.length).toBeLessThanOrEqual(120 + 160 + 8)
  })

  it('is used by formatExcerpts when a source carries focusStart', () => {
    const anchor = chunk.indexOf('Lisinopril')
    const out = formatExcerpts([{ ...sources[0]!, text: chunk, focusStart: anchor }], question)
    expect(out).toContain('Lisinopril 10 mg')
  })
})

/** Longest an anchored excerpt may grow: the capped sentence, the separator line, three ellipses. */
const ANCHOR_EXTRA = 160 + '\n…\n'.length + 3

describe('clipExcerpt never shows a sentence twice', () => {
  const collapse = (s: string) => s.replace(/\s+/g, ' ')
  /** Every piece of the excerpt maps to a strictly later, non-overlapping range of the source. */
  const noDuplicates = (out: string, source: string) => {
    const haystack = collapse(source)
    let cursor = 0
    for (const piece of out.split('\n…\n').map((p) => collapse(p.replace(/…/g, '')).trim())) {
      if (!piece) continue
      const at = haystack.indexOf(piece, cursor)
      expect(at, `piece not found after offset ${cursor}: "${piece.slice(0, 40)}"`).toBeGreaterThanOrEqual(0)
      cursor = at + piece.length
    }
  }
  const text =
    'Alpha sentence one is here. Beta sentence two is here. Gamma sentence three is here. Delta sentence four is here.'

  it('treats the last full sentence of a boundary-cut window as inside it', () => {
    const plain = clipExcerpt(text, 60, 'alpha beta')
    expect(plain).toBe('Alpha sentence one is here. Beta sentence two is here.…')
    expect(clipExcerpt(text, 60, 'alpha beta', text.indexOf('Beta'))).toBe(plain)
  })

  it('merges a sentence that overlaps the window into one contiguous excerpt', () => {
    // The window ends mid-way through Gamma; Gamma is the anchor.
    const out = clipExcerpt(text, 70, 'alpha beta', text.indexOf('Gamma'))
    expect(out).toContain('Gamma sentence three is here.')
    expect(out).not.toContain('\n…\n')
    noDuplicates(out, text)
  })

  it('joins an adjacent sentence without an ellipsis line', () => {
    const out = clipExcerpt(text, 60, 'alpha beta', text.indexOf('Gamma'))
    expect(out).toBe('Alpha sentence one is here. Beta sentence two is here. Gamma sentence three is here.…')
    noDuplicates(out, text)
  })

  it('separates a disjoint sentence with one ellipsis line and no doubled ellipses', () => {
    const out = clipExcerpt(text, 30, 'alpha', text.indexOf('Delta'))
    expect(out).toBe('Alpha sentence one is here.\n…\nDelta sentence four is here.')
    expect(out).not.toMatch(/…\n…|…\s*…/)
    noDuplicates(out, text)
  })

  it('caps a long anchored sentence at a word, marks the cut, and collapses its line breaks', () => {
    const long = `${'alphabet '.repeat(40)}end`
    const chunk = `Unrelated opening line about something else.\n${long.replace('alphabet alphabet', 'alphabet\nalphabet')}`
    const out = clipExcerpt(chunk, 40, 'unrelated opening', chunk.indexOf('alphabet'))
    expect(out).toContain('\n…\n')
    const sentence = out.split('\n…\n')[1]!
    expect(sentence.endsWith('alphabet…')).toBe(true)
    expect(sentence).not.toContain('\n')
    expect(out.length).toBeLessThanOrEqual(40 + ANCHOR_EXTRA)
    noDuplicates(out, chunk)
  })

  it('does not double the ellipsis when a capped sentence precedes the window', () => {
    const long = `${'alphabet '.repeat(40)}end.`
    const chunk = `${long} Alpha and beta close the chunk.`
    const out = clipExcerpt(chunk, 40, 'alpha beta', 0)
    expect(out).toContain('\n…\n')
    expect(out).not.toMatch(/…\n…|…\s*…/)
    expect(out.length).toBeLessThanOrEqual(40 + ANCHOR_EXTRA)
    noDuplicates(out, chunk)
  })

  it('shows a PDF-wrapped sentence once when the window starts inside it', () => {
    const chunk =
      'Maintain the reduced-sodium diet discussed in September. A flu vaccine\nwas administered at this visit in the left deltoid, lot number FL24-0931. The tetanus booster is due in\n2027.'
    const out = clipExcerpt(chunk, 90, 'administered visit deltoid', chunk.indexOf('A flu'))
    expect(out).toContain('A flu vaccine')
    expect(out).toContain('FL24-0931')
    noDuplicates(out, chunk)
  })
})
