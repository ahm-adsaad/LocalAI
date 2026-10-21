/**
 * The RAG prompt asks the model to cite excerpts as [n]. We rewrite those
 * markers into markdown links so the UI can jump to the matching source card,
 * and label sources with the page they came from.
 */

export function citationAnchor(turnId: string, n: number): string {
  return `src-${turnId}-${n}`
}

/** "p. 3" or "pp. 3–4"; empty when the chunk predates page tracking. */
export function pageLabel(chunk: { pageStart?: number; pageEnd?: number }): string {
  const { pageStart, pageEnd } = chunk
  if (pageStart == null) return ''
  if (pageEnd == null || pageEnd === pageStart) return `p. ${pageStart}`
  return `pp. ${pageStart}–${pageEnd}`
}

/** "lease.pdf, p. 3" for chip tooltips and chat exports. */
export function sourceTitle(chunk: { documentName: string; pageStart?: number; pageEnd?: number }): string {
  const label = pageLabel(chunk)
  return label ? `${chunk.documentName}, ${label}` : chunk.documentName
}

const MARKER_RE = /\[(\d+(?:\s*,\s*\d+)*)\]/g

export function linkifyCitations(
  markdown: string,
  sourceCount: number,
  turnId: string,
  titles: string[] = [],
): string {
  if (sourceCount <= 0) return markdown
  return markdown.replace(MARKER_RE, (match, inner: string) => {
    const nums = inner.split(',').map((s) => Number.parseInt(s.trim(), 10))
    if (nums.some((n) => !Number.isFinite(n) || n < 1 || n > sourceCount)) return match
    return nums
      .map((n) => {
        const title = titles[n - 1]
        const suffix = title ? ` "${title.replace(/"/g, '\\"')}"` : ''
        return `[\\[${n}\\]](#${citationAnchor(turnId, n)}${suffix})`
      })
      .join('')
  })
}
