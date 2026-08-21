import type { ChatMessage, RankedChunk } from './types'
import { EXCERPT_MAX_CHARS } from './types'
import { isOverviewQuery } from './rag'

function clip(text: string, max = EXCERPT_MAX_CHARS): string {
  const t = text.trim()
  if (t.length <= max) return t
  // Prefer cutting on a line/sentence boundary so we do not end mid-number-run.
  const slice = t.slice(0, max)
  const breakAt = Math.max(slice.lastIndexOf('\n'), slice.lastIndexOf('. '), slice.lastIndexOf('; '))
  const cut = breakAt > max * 0.5 ? slice.slice(0, breakAt + 1) : slice
  return `${cut.trimEnd()}…`
}

/**
 * Ground the model in retrieved chunks. Small 1B models love to echo table soup
 * from PDF extracts — the prompt must demand plain-English synthesis.
 */
export function buildRagMessages(question: string, sources: RankedChunk[]): ChatMessage[] {
  const overview = isOverviewQuery(question)
  const context = sources
    .map((s, i) => `[${i + 1}] ${s.documentName}\n${clip(s.text)}`)
    .join('\n\n')

  const system =
    'You are a document analyst running on-device. The excerpts ARE from the user\'s uploaded PDF — never say the file is missing. ' +
    'Write clear plain-English sentences. ' +
    'Do NOT dump raw tables, label lists, or jumbled percentages. ' +
    'If you see metrics (engagement, posts, clicks), interpret them in words (e.g. "Engagement was about 8–11% across months"). ' +
    'Answer the user\'s question; do not merely repeat the excerpts.'

  const ask = overview
    ? 'In 2–4 short sentences, say what this document is about (topic, org/period if present, and the kinds of metrics it tracks). No raw number dumps.'
    : 'Answer the question in plain English using only the excerpts. Cite [1] or [2] if useful. If the fact is not there, say so.'

  return [
    { role: 'system', content: system },
    {
      role: 'user',
      content: `Excerpts:\n${context}\n\nQuestion: ${question}\n\n${ask}`,
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
