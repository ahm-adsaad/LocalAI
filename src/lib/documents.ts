import { detectInputKind, readTextFile } from './inputs'

export interface ExtractedDocument {
  /** Per-page text for paged formats (PDF); null for formats without pages. */
  pages: string[] | null
  text: string
  /** 0 means unpaged. */
  pageCount: number
}

export async function extractDocument(file: File): Promise<ExtractedDocument> {
  const kind = detectInputKind(file.name)
  switch (kind) {
    case 'pdf': {
      // Lazy: pdf.js configures its worker at module load and stays out of the main bundle until needed.
      const { extractPdfText } = await import('./pdf')
      const { pages } = await extractPdfText(file)
      return { pages, text: pages.join('\n\n'), pageCount: pages.length }
    }
    case 'text':
    case 'markdown':
      return { pages: null, text: readTextFile(await file.text()), pageCount: 0 }
    default: {
      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : file.name
      throw new Error(`Unsupported file type: ${ext}`)
    }
  }
}
