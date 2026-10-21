import type { ChatMessage } from './types'

/**
 * Conversation-aware retrieval: a follow-up like "when does her lease end?"
 * embeds badly on its own because the referent lives in an earlier turn. We
 * rewrite such questions into standalone form before retrieval. The rewrite is
 * an extra on-device generation, so we only pay for it when the question looks
 * like it depends on prior context.
 */

const ANAPHORA_RE =
  /\b(he|she|they|it|him|her|his|hers|their|theirs|its|them|that|this|these|those|same|also|too|again|the former|the latter)\b/i
const FOLLOW_UP_RE = /^(and|what about|how about|also|any|ok|okay|so)\b/i

/** Max characters of each prior turn included in the rewrite prompt. */
const TURN_CLIP = 320
/** Longest rewrite we accept; longer output means the model started answering. */
const MAX_REWRITE_CHARS = 240

export function needsCondensing(question: string, history: ChatMessage[]): boolean {
  if (!history.some((m) => m.role === 'assistant')) return false
  const q = question.trim()
  const words = q.split(/\s+/).filter(Boolean).length
  if (words <= 5) return true
  if (FOLLOW_UP_RE.test(q)) return true
  return ANAPHORA_RE.test(q)
}

function clip(text: string): string {
  const t = text.trim().replace(/\s+/g, ' ')
  return t.length <= TURN_CLIP ? t : `${t.slice(0, TURN_CLIP)}…`
}

export function buildCondenseMessages(history: ChatMessage[], question: string): ChatMessage[] {
  const recent = history.filter((m) => m.role !== 'system').slice(-4)
  const transcript = recent
    .map((m) => `${m.role === 'user' ? 'User' : 'Assistant'}: ${clip(m.content)}`)
    .join('\n')

  return [
    {
      role: 'system',
      content:
        'You rewrite follow-up questions so they can be understood without the conversation. ' +
        'Replace pronouns and references with the specific names or things from the transcript. ' +
        'Output only the rewritten standalone question on one line. Do not answer it.',
    },
    {
      role: 'user',
      content: `Transcript:\n${transcript}\n\nFollow-up: ${question}\n\nStandalone question:`,
    },
  ]
}

/** Normalize a model rewrite; return `fallback` when the output is unusable. */
export function cleanCondensed(raw: string, fallback: string): string {
  let line = raw.trim().split(/\r?\n/)[0] ?? ''
  line = line.replace(/^(standalone question|rewritten question|question)\s*:\s*/i, '').trim()
  line = line.replace(/^["'“‘]+|["'”’]+$/g, '').trim()
  if (!line || line.length > MAX_REWRITE_CHARS) return fallback
  return line
}
