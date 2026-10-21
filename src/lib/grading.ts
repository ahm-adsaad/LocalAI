import type { RankedChunk } from './types'

/**
 * Deterministic answer grading for the in-browser bench. Keyword matching is
 * crude but honest: it never needs a second model, runs offline, and the
 * golden set is written so that each answer has one unambiguous key fact.
 */

export function normalizeAnswer(text: string): string {
  return text
    .toLowerCase()
    // "$100, 000" → "100000": drop the separator and any space it was followed by.
    .replace(/(\d),\s*(?=\d)/g, '$1')
    .replace(/[$£€,]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Every entry must match; an entry like "a|b" accepts either alternative. */
export function answerMatches(content: string, expected: string[]): boolean {
  const haystack = normalizeAnswer(content)
  return expected.every((entry) =>
    entry.split('|').some((alt) => haystack.includes(normalizeAnswer(alt))),
  )
}

/** True when a selected source comes from the expected PDF and holds the fact. */
export function retrievalHit(sources: RankedChunk[], doc: string, expect: string[]): boolean {
  const name = `${doc}.pdf`
  return sources.some(
    (s) =>
      s.documentName === name &&
      expect.some((e) => s.text.toLowerCase().includes(e.toLowerCase())),
  )
}
