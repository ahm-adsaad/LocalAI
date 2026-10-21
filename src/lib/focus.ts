import type { RankedChunk, RerankPair } from './types'
import { EXCERPT_MAX_CHARS } from './types'

/**
 * Sentence-level focus for excerpts that must be clipped.
 *
 * A 700-character chunk goes into the prompt as a 360-character excerpt. The
 * lexical window picker (prompt.ts) counts literal question terms, so when the
 * answering sentence paraphrases the question ("Lisinopril … for hypertension"
 * for "medication for blood pressure") while another sentence in the same chunk
 * contains the literal phrase, the literal sentence wins. Scoring whole 360-char
 * windows with the cross-encoder does not fix it either: a window mixes several
 * sentences and the literal match still dominates by a hair. Scoring single
 * sentences removes the dilution; on the case that motivated this, the
 * cross-encoder preferred the answering sentence by more than three logits.
 *
 * The cross-encoder has its own blind spots (it liked a revenue sentence over
 * "$21.3 million in cash"), so the result is not a replacement for the lexical
 * window: `focusStart` names a sentence the excerpt must *contain*, and
 * `clipExcerpt` keeps the lexical window and adds that sentence only when the
 * two disagree.
 *
 * This module is the pure half: which sentences to score, and how to turn the
 * scores into an anchor. The worker does the scoring. All offsets are into
 * `text.trim()`, which is also what `clipExcerpt` works on.
 */

export interface SentenceSpan {
  start: number
  end: number
  text: string
}

/**
 * Sentence ends: a line break, or `. ` / `; ` / `? ` / `! ` (optionally before
 * a closing quote or bracket). PDF text wraps lines mid-sentence, so a line
 * break only ends a sentence when the line ends in punctuation, or is short
 * enough to be a heading and the next line does not continue in lowercase.
 * A period after an abbreviation ("Dr.", "e.g.", "U.S."), a single letter or
 * a list marker ("10. ") does not end one.
 */
const BOUNDARY_RE = /\n|[.!?]["')\]]* |; /g
const HEADING_MAX_CHARS = 60
const TERMINAL_RE = /[.!?:;)"']$/
const ABBREVIATIONS = new Set([
  'dr', 'mr', 'mrs', 'ms', 'prof', 'st', 'vs', 'etc', 'inc', 'ltd', 'co', 'jr', 'sr',
  'approx', 'dept', 'fig', 'vol',
])
/** A 1–3 digit token at line start, after a colon, or right after a sentence end is a list marker. */
const LIST_MARKER_RE = /(?:^|\n|[.!?;:]\s+)\s*\d{1,3}$/

function lineEndsSentence(line: string, nextLine: string): boolean {
  const t = line.trimEnd()
  if (TERMINAL_RE.test(t)) return true
  return t.length <= HEADING_MAX_CHARS && !/^\s*\p{Ll}/u.test(nextLine)
}

function periodEndsSentence(text: string, periodAt: number, after: string): boolean {
  const before = text.slice(0, periodAt)
  const raw = /(\S+)$/.exec(before)?.[1] ?? ''
  const word = raw.replace(/^[^\p{L}\p{N}]+/u, '').toLowerCase()
  if (/^\p{L}$/u.test(word)) return false
  if (/\p{L}\.\p{L}/u.test(word)) return false
  if (ABBREVIATIONS.has(word)) return false
  if (LIST_MARKER_RE.test(before)) return false
  if (word === 'no' && /^\d/.test(after)) return false
  return true
}

export function sentenceSpans(text: string): SentenceSpan[] {
  const spans: SentenceSpan[] = []
  let start = 0
  let lineStart = 0
  const push = (end: number) => {
    const t = text.slice(start, end).replace(/\s+/g, ' ').trim()
    if (t) spans.push({ start, end, text: t })
    start = end
  }
  for (const m of text.matchAll(BOUNDARY_RE)) {
    const end = m.index + m[0].length
    if (m[0] === '\n') {
      const line = text.slice(lineStart, m.index)
      lineStart = end
      const nextBreak = text.indexOf('\n', end)
      const nextLine = text.slice(end, nextBreak === -1 ? text.length : nextBreak)
      if (!lineEndsSentence(line, nextLine)) continue
    } else if (m[0].startsWith('.') && !periodEndsSentence(text, m.index, text.slice(end))) {
      continue
    }
    push(end)
  }
  push(text.length)
  return spans
}

/** End offset of the sentence that starts at `start` (the text length if none does). */
export function sentenceEndAt(text: string, start: number): number {
  return sentenceSpans(text).find((s) => s.start === start)?.end ?? text.length
}

/** Which source a scored pair belongs to, and where its sentence starts. */
export interface FocusSpan {
  source: number
  start: number
}

/**
 * (question, sentence) pairs for every source longer than the excerpt budget
 * that has more than one sentence to choose from.
 */
export function focusPairs(
  question: string,
  sources: RankedChunk[],
  max = EXCERPT_MAX_CHARS,
): { pairs: RerankPair[]; spans: FocusSpan[] } {
  const pairs: RerankPair[] = []
  const spans: FocusSpan[] = []
  sources.forEach((s, i) => {
    const text = s.text.trim()
    if (text.length <= max) return
    const sentences = sentenceSpans(text)
    if (sentences.length < 2) return
    for (const span of sentences) {
      pairs.push({ query: question, text: span.text })
      spans.push({ source: i, start: span.start })
    }
  })
  return { pairs, spans }
}

/** Anchor each scored source on its best-scoring sentence; `scores[i]` belongs to `spans[i]`. */
export function applyFocus(sources: RankedChunk[], spans: FocusSpan[], scores: number[]): RankedChunk[] {
  const best = new Map<number, { start: number; score: number }>()
  spans.forEach((span, i) => {
    const score = scores[i]
    if (score == null || !Number.isFinite(score)) return
    const current = best.get(span.source)
    if (!current || score > current.score) best.set(span.source, { start: span.start, score })
  })
  return sources.map((s, i) => {
    const b = best.get(i)
    return b ? { ...s, focusStart: b.start } : s
  })
}
