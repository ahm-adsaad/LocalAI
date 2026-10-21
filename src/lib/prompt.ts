import type { ChatMessage, RankedChunk } from './types'
import { EXCERPT_MAX_CHARS } from './types'
import { tokenize } from './bm25'
import { pageLabel } from './citations'
import { sentenceEndAt } from './focus'
import { isOverviewQuery } from './rag'

/** Prior *user* questions carried into the RAG prompt so follow-ups read naturally. */
const RAG_HISTORY_QUESTIONS = 2
/** Each carried question is clipped so history never dominates prefill time. */
const RAG_HISTORY_CLIP = 160

/**
 * Cut on a line/sentence boundary so we do not end mid-number-run, but never
 * cut away a query term we chose this window for (`keepThrough`).
 */
function cutAtBoundary(slice: string, max: number, keepThrough = 0): string {
  const breakAt = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf('; '))
  const ok = breakAt > max * 0.5 && breakAt + 1 >= keepThrough
  return (ok ? slice.slice(0, breakAt + 1) : slice).trimEnd()
}

/** Offsets where a line or sentence starts; candidate excerpt starts. */
function boundaryStarts(text: string): number[] {
  const starts = [0]
  for (const m of text.matchAll(/\n|\. |; /g)) {
    starts.push(m.index + m[0].length)
  }
  return starts
}

/** Question words carry no signal about *where* in a chunk the answer sits. */
const FOCUS_STOPWORDS = new Set([
  'the', 'and', 'for', 'are', 'was', 'were', 'does', 'did', 'has', 'have', 'had',
  'what', 'when', 'who', 'whom', 'which', 'where', 'why', 'how', 'much', 'many',
  'this', 'that', 'these', 'those', 'with', 'from', 'into', 'about', 'per',
  'can', 'could', 'should', 'would', 'will', 'there', 'their', 'they', 'its',
])

function distinctTerms(focus: string): string[] {
  return [...new Set(tokenize(focus).filter((t) => t.length > 2 && !FOCUS_STOPWORDS.has(t)))]
}

/**
 * Start offset of the `max`-wide window (beginning on a sentence/line
 * boundary) that holds the most distinct query terms. Terms are only counted
 * if they leave a tail of room after them, because the *value* we want
 * ("late fee of $75.00") follows the keyword and must not fall off the end.
 * Ties go to the window whose first matched term comes earliest, so the
 * answering sentence opens the excerpt.
 */
function bestWindowStart(text: string, max: number, terms: string[]): number {
  if (terms.length === 0) return 0
  const lower = text.toLowerCase()
  const tail = Math.min(80, Math.floor(max * 0.3))

  // A term that recurs through the chunk (the document's subject, say) tells
  // us little about where the answer is; weight each term by its rarity here.
  const weight = new Map<string, number>()
  for (const term of terms) {
    let n = 0
    for (let i = lower.indexOf(term); i !== -1; i = lower.indexOf(term, i + term.length)) n += 1
    if (n > 0) weight.set(term, 1 / n)
  }
  if (weight.size === 0) return 0

  let best = { start: 0, score: -1, lead: Number.POSITIVE_INFINITY }
  for (const start of boundaryStarts(lower)) {
    if (start >= lower.length) continue
    const window = lower.slice(start, start + max - tail)
    let score = 0
    let lead = Number.POSITIVE_INFINITY
    for (const [term, w] of weight) {
      const at = window.indexOf(term)
      if (at === -1) continue
      score += w
      lead = Math.min(lead, at)
    }
    if (score > best.score || (score === best.score && lead < best.lead)) {
      best = { start, score, lead }
    }
  }
  return best.start
}

/**
 * Clip a chunk for the prompt. With `focus` (the question), the clip window
 * slides to the span that mentions the question's terms — a chunk is 700
 * chars but the prompt budget is 360, and the eval showed that clipping from
 * the head silently dropped the answering sentence for facts late in a chunk.
 * With `anchor` (an offset into `text.trim()`, from focus.ts), the sentence at
 * that offset must survive too: it is merged into the window when they touch,
 * otherwise added as a capped second part.
 */
export function clipExcerpt(
  text: string,
  max = EXCERPT_MAX_CHARS,
  focus?: string,
  anchor?: number,
): string {
  const t = text.trim()
  if (t.length <= max) return t

  const terms = focus ? distinctTerms(focus) : []
  const start = bestWindowStart(t, max, terms)
  const slice = t.slice(start, start + max)

  // Last character of the last matched term inside this window.
  const lowerSlice = slice.toLowerCase()
  let keepThrough = 0
  for (const term of terms) {
    const at = lowerSlice.lastIndexOf(term)
    if (at !== -1) keepThrough = Math.max(keepThrough, at + term.length)
  }

  const kept = start + max >= t.length ? slice.trimEnd() : cutAtBoundary(slice, max, keepThrough)
  const windowEnd = start + kept.length

  // The lexical window and the semantic anchor (focus.ts) fail on different
  // questions: literal terms miss a paraphrased answer, the cross-encoder
  // misses a literal cue. Neither wins on the eval; showing the model both
  // when they disagree does. Agreement costs nothing extra.
  if (anchor == null || anchor < 0 || anchor >= t.length) return excerptOf(t, start, windowEnd)

  const sentenceEnd = anchor + t.slice(anchor, sentenceEndAt(t, anchor)).trimEnd().length
  const capped = capSentence(t, anchor, sentenceEnd)
  if (anchor >= start && sentenceEnd <= windowEnd) return excerptOf(t, start, windowEnd)

  // Overlapping or adjacent: one contiguous excerpt, so nothing is shown twice.
  const gap = anchor < start ? t.slice(capped, start) : t.slice(windowEnd, anchor)
  if (gap.trim() === '') {
    return excerptOf(t, Math.min(start, anchor), Math.max(windowEnd, capped))
  }

  // Disjoint: window plus the sentence, in document order, one ellipsis line
  // between them and no ellipsis on the sides that face it.
  const sentence = t.slice(anchor, capped).replace(/\s+/g, ' ').trim()
  if (anchor < start) {
    return `${anchor > 0 ? '…' : ''}${sentence}\n…\n${kept}${windowEnd < t.length ? '…' : ''}`
  }
  const tail = capped < sentenceEnd || sentenceEnd < t.length ? '…' : ''
  return `${start > 0 ? '…' : ''}${kept}\n…\n${sentence}${tail}`
}

/** Extra room an anchored sentence may add to a clipped excerpt. */
const ANCHOR_MAX_CHARS = 160

/** Where to cut an over-long anchored sentence: at a word, in the second half of the allowance. */
function capSentence(text: string, start: number, end: number): number {
  if (end - start <= ANCHOR_MAX_CHARS) return end
  const limit = start + ANCHOR_MAX_CHARS
  const space = text.lastIndexOf(' ', limit)
  return space > start + ANCHOR_MAX_CHARS / 2 ? space : limit
}

/** `text[from, to)` with an ellipsis on each side that is not the chunk's edge. */
function excerptOf(text: string, from: number, to: number): string {
  const body = text.slice(from, to).trim()
  return `${from > 0 ? '…' : ''}${body}${to < text.length ? '…' : ''}`
}

/** "[1] name (p. 3)\ntext" blocks, numbered to match the citation markers we ask for. */
export function formatExcerpts(sources: RankedChunk[], focus?: string): string {
  return sources
    .map((s, i) => {
      const page = pageLabel(s)
      const header = `[${i + 1}] ${s.documentName}${page ? ` (${page})` : ''}`
      return `${header}\n${clipExcerpt(s.text, EXCERPT_MAX_CHARS, focus, s.focusStart)}`
    })
    .join('\n\n')
}

/**
 * Earlier *user* questions only. Prior assistant answers are deliberately left
 * out: a 1.5B model shown its own earlier "The fact is not there." repeats it
 * verbatim, even when the new excerpts contain the answer. The follow-up rewrite
 * (condense.ts) already resolves references using both sides of the transcript.
 */
function priorQuestions(history: ChatMessage[]): string[] {
  return history
    .filter((m) => m.role === 'user')
    .slice(-RAG_HISTORY_QUESTIONS)
    .map((m) => {
      const t = m.content.trim().replace(/\s+/g, ' ')
      return t.length <= RAG_HISTORY_CLIP ? t : `${t.slice(0, RAG_HISTORY_CLIP)}…`
    })
}

/**
 * Ground the model in retrieved chunks. Small models love to echo table soup
 * from PDF extracts, so the prompt demands plain-English synthesis and a
 * numbered citation after each fact (the UI turns [n] into links).
 */
export function buildRagMessages(
  question: string,
  sources: RankedChunk[],
  history: ChatMessage[] = [],
): ChatMessage[] {
  const overview = isOverviewQuery(question)
  // Overview excerpts keep the head (title / intro); factual ones slide to the fact.
  const context = formatExcerpts(sources, overview ? undefined : question)

  const system =
    'You are a document analyst running on-device. The excerpts ARE from the user\'s uploaded documents — never say the file is missing. ' +
    'Write clear plain-English sentences. ' +
    'Do NOT dump raw tables, label lists, or jumbled numbers; interpret metrics in words. ' +
    'After each fact you state, cite the excerpt it came from in square brackets, like [1]. ' +
    'Answer the user\'s question; do not merely repeat the excerpts.'

  const ask = overview
    ? 'In 2–4 short sentences, say what this document is about (topic, parties or organisation, period if present, and what it covers). No raw number dumps.'
    : 'Answer the question in plain English using only the excerpts, citing them like [1]. If the fact is not there, say so.'

  const earlier = priorQuestions(history)
  const conversation =
    earlier.length > 0
      ? `Earlier questions in this conversation (for context only):\n${earlier.map((q) => `- ${q}`).join('\n')}\n\n`
      : ''

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `${conversation}Excerpts:\n${context}\n\nQuestion: ${question}\n\n${ask}`,
    },
  ]
}

export function buildPlainChatMessages(
  history: ChatMessage[],
  userText: string,
): ChatMessage[] {
  const recent = history.slice(-4)
  return [
    {
      role: 'system',
      content:
        'Helpful on-device assistant. Data never leaves this browser. Answer in clear short sentences.',
    },
    ...recent,
    { role: 'user', content: userText },
  ]
}
