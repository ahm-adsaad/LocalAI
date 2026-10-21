import { detectInputKind, readTextFile } from './inputs'

export interface ExtractedDocument {
  /** Per-page text for paged formats (PDF); null for formats without pages. */
  pages: string[] | null
  text: string
  /** 0 means unpaged. */
  pageCount: number
}

/**
 * Decode a text file's bytes, sniffing a UTF-16 byte-order mark (Notepad's
 * "Unicode", PowerShell 5.1's `>`); anything else is UTF-8. `file.text()` would
 * always read UTF-8 and index the NULs of a UTF-16 file.
 */
export function decodeTextFile(buffer: ArrayBuffer): string {
  const head = new Uint8Array(buffer, 0, Math.min(2, buffer.byteLength))
  if (head[0] === 0xff && head[1] === 0xfe) return new TextDecoder('utf-16le').decode(buffer)
  if (head[0] === 0xfe && head[1] === 0xff) return new TextDecoder('utf-16be').decode(buffer)
  return new TextDecoder('utf-8').decode(buffer)
}

async function mammothRawText(arrayBuffer: ArrayBuffer): Promise<string> {
  // Lazy: mammoth ships as its own chunk and stays out of the main bundle until a DOCX arrives.
  const { default: mammoth } = await import('mammoth')
  return (await mammoth.extractRawText({ arrayBuffer })).value
}

export async function extractDocx(
  buffer: ArrayBuffer,
  extract: (b: ArrayBuffer) => Promise<string> = mammothRawText,
): Promise<ExtractedDocument> {
  return { pages: null, text: readTextFile(await extract(buffer)).trim(), pageCount: 0 }
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
      return { pages: null, text: readTextFile(decodeTextFile(await file.arrayBuffer())), pageCount: 0 }
    case 'docx':
      return extractDocx(await file.arrayBuffer())
    default: {
      const ext = file.name.includes('.') ? file.name.slice(file.name.lastIndexOf('.')) : file.name
      throw new Error(`Unsupported file type: ${ext}`)
    }
  }
}
