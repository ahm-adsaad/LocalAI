/**
 * Pure reading-order reconstruction shared by the browser extractor and the
 * Node eval harness, so both measure the exact same text the model sees.
 */

export interface PdfTextItem {
  str?: string
  transform?: number[]
}

type TextRow = { y: number; parts: Array<{ x: number; str: string }> }

/**
 * Rebuild reading order from pdf.js glyph positions. Joining every item with a
 * space turns dashboard tables into "10.65% 6.63% 9.30%" soup — which small
 * models then parrot instead of summarizing. Baselines are bucketed to 2 units
 * so slightly misaligned items on one visual line stay on one text line.
 */
export function pageItemsToText(items: PdfTextItem[]): string {
  const rows = new Map<number, TextRow>()

  for (const item of items) {
    const str = item.str?.replace(/\s+/g, ' ').trim()
    if (!str) continue
    const x = item.transform?.[4] ?? 0
    const y = Math.round((item.transform?.[5] ?? 0) / 2) * 2
    const row = rows.get(y) ?? { y, parts: [] }
    row.parts.push({ x, str })
    rows.set(y, row)
  }

  return [...rows.values()]
    .sort((a, b) => b.y - a.y)
    .map((row) =>
      row.parts
        .sort((a, b) => a.x - b.x)
        .map((p) => p.str)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim(),
    )
    .filter(Boolean)
    .join('\n')
}
