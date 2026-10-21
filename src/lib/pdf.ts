import * as pdfjs from 'pdfjs-dist'
import { pageItemsToText, type PdfTextItem } from './pdfText'

// pdf.js runs its own dedicated worker so page parsing stays off the UI thread.
pdfjs.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url,
).toString()

export interface PdfExtractResult {
  /** Reading-order text per page, index 0 = page 1. */
  pages: string[]
  pageCount: number
}

export async function extractPdfText(file: File): Promise<PdfExtractResult> {
  const data = new Uint8Array(await file.arrayBuffer())
  const pdf = await pdfjs.getDocument({ data }).promise
  const pages: string[] = []

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const content = await page.getTextContent()
    pages.push(pageItemsToText(content.items as PdfTextItem[]))
  }

  return { pages, pageCount: pdf.numPages }
}
