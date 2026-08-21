import { CHUNK_OVERLAP, CHUNK_SIZE } from './types'

/**
 * Prefer paragraph/line breaks from pdf extraction when splitting, then fall
 * back to a sliding window. Keeps metric rows from gluing into one opaque blob.
 */
export function chunkText(
  text: string,
  size = CHUNK_SIZE,
  overlap = CHUNK_OVERLAP,
): string[] {
  const cleaned = text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  if (!cleaned) return []

  if (cleaned.length <= size) return [cleaned]

  const paragraphs = cleaned.split(/\n+/).map((p) => p.trim()).filter(Boolean)
  const chunks: string[] = []
  let buf = ''

  const flush = () => {
    const t = buf.trim()
    if (t) chunks.push(t)
    buf = ''
  }

  for (const para of paragraphs) {
    if (para.length > size) {
      flush()
      let start = 0
      while (start < para.length) {
        const end = Math.min(start + size, para.length)
        chunks.push(para.slice(start, end).trim())
        if (end >= para.length) break
        start = Math.max(0, end - overlap)
      }
      continue
    }

    const next = buf ? `${buf}\n${para}` : para
    if (next.length > size) {
      flush()
      buf = para
    } else {
      buf = next
    }
  }
  flush()

  return chunks.filter(Boolean)
}

/** Prefer prose-like chunks over pure number dumps when ranking is weak. */
export function proseDensity(text: string): number {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length
  const digits = (text.match(/\d/g) ?? []).length
  return letters / Math.max(letters + digits, 1)
}
