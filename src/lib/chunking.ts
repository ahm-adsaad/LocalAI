import { CHUNK_OVERLAP, CHUNK_SIZE } from './types'

/** A chunk plus the 1-based page range of the PDF it was cut from. */
export interface PageChunk {
  text: string
  pageStart: number
  pageEnd: number
}

interface Paragraph {
  text: string
  page: number
}

function clean(text: string): string {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}

function paragraphsOf(text: string, page: number): Paragraph[] {
  return clean(text)
    .split(/\n+/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => ({ text: p, page }))
}

/**
 * Pack paragraphs into chunks of at most `size` chars; an oversized paragraph
 * falls back to a sliding window with `overlap`. Page tags ride along so a
 * chunk knows the pages it spans.
 */
function packParagraphs(paragraphs: Paragraph[], size: number, overlap: number): PageChunk[] {
  const chunks: PageChunk[] = []
  let buf = ''
  let bufStart = 0
  let bufEnd = 0

  const flush = () => {
    const t = buf.trim()
    if (t) chunks.push({ text: t, pageStart: bufStart, pageEnd: bufEnd })
    buf = ''
  }

  for (const para of paragraphs) {
    if (para.text.length > size) {
      flush()
      let start = 0
      while (start < para.text.length) {
        const end = Math.min(start + size, para.text.length)
        chunks.push({ text: para.text.slice(start, end).trim(), pageStart: para.page, pageEnd: para.page })
        if (end >= para.text.length) break
        start = Math.max(0, end - overlap)
      }
      continue
    }

    const next = buf ? `${buf}\n${para.text}` : para.text
    if (next.length > size) {
      flush()
      buf = para.text
      bufStart = para.page
    } else {
      if (!buf) bufStart = para.page
      buf = next
    }
    bufEnd = para.page
  }
  flush()

  return chunks.filter((c) => c.text)
}

/**
 * Prefer paragraph/line breaks from pdf extraction when splitting, then fall
 * back to a sliding window. Keeps metric rows from gluing into one opaque blob.
 */
export function chunkText(text: string, size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): string[] {
  const cleaned = clean(text)
  if (!cleaned) return []
  if (cleaned.length <= size) return [cleaned]
  return packParagraphs(paragraphsOf(cleaned, 1), size, overlap).map((c) => c.text)
}

/**
 * Same chunks as `chunkText(pages.join('\n\n'))`, each tagged with the pages
 * it came from, so citations can point at a page and not just a file.
 */
export function chunkPages(pages: string[], size = CHUNK_SIZE, overlap = CHUNK_OVERLAP): PageChunk[] {
  const cleaned = clean(pages.join('\n\n'))
  if (!cleaned) return []

  if (cleaned.length <= size) {
    const nonEmpty = pages.map((p, i) => (clean(p) ? i + 1 : 0)).filter(Boolean)
    return [{ text: cleaned, pageStart: nonEmpty[0] ?? 1, pageEnd: nonEmpty.at(-1) ?? 1 }]
  }

  const paragraphs = pages.flatMap((p, i) => paragraphsOf(p, i + 1))
  return packParagraphs(paragraphs, size, overlap)
}

/** Prefer prose-like chunks over pure number dumps when ranking is weak. */
export function proseDensity(text: string): number {
  const letters = (text.match(/[A-Za-z]/g) ?? []).length
  const digits = (text.match(/\d/g) ?? []).length
  return letters / Math.max(letters + digits, 1)
}
