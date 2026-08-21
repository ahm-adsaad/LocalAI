import * as pdfjs from 'pdfjs-dist'

// pdf.js runs its own dedicated worker so page parsing stays off the UI thread.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export interface PdfExtractResult {
  text: string
  pageCount: number
}

type TextRow = { y: number; parts: Array<{ x: number; str: string }> }

/**
 * Rebuild reading order from pdf.js glyph positions. Joining every item with a
 * space turns LinkedIn/dashboard tables into "10.65% 6.63% 9.30%" soup — which
 * small models then parrot instead of summarizing.
 */
function pageItemsToText(items: Array<{ str?: string; transform?: number[] }>): string {
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

export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    const items = content.items as Array<{ str?: string; transform?: number[] }>
    pages.push(pageItemsToText(items))
  }

  return {
    text: pages.join('\n\n'),
    pageCount: pdf.numPages,
  }
}
