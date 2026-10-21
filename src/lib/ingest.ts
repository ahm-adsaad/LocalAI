import { chunkPages } from './chunking'
import { saveDocumentWithChunks } from './db'
import { extractPdfText } from './pdf'
import type { DocumentMeta, StoredChunk } from './types'
import type { WorkerClient } from './workerClient'

/**
 * PDF → reading-order text → page-tagged chunks → on-device embeddings → IndexedDB.
 * Shared by drag-and-drop upload and the bench's sample-corpus loader.
 */
export async function ingestPdf(
  file: File,
  chatId: string,
  worker: WorkerClient,
  onStatus?: (status: string) => void,
): Promise<{ meta: DocumentMeta; chunks: StoredChunk[] }> {
  onStatus?.(`Reading ${file.name}…`)
  const { pages, pageCount } = await extractPdfText(file)
  if (!pages.join('').trim()) {
    throw new Error('No extractable text in this PDF (it may be image-only).')
  }

  const parts = chunkPages(pages)
  onStatus?.(`Embedding ${parts.length} chunks on-device…`)
  const embeddings = await worker.embed(
    parts.map((p) => p.text),
    (p) => onStatus?.(`${p.text} chunks on-device…`),
  )

  const documentId = crypto.randomUUID()
  const chunks: StoredChunk[] = parts.map((part, i) => ({
    id: `${documentId}-${i}`,
    documentId,
    documentName: file.name,
    index: i,
    text: part.text,
    embedding: embeddings[i] ?? [],
    pageStart: part.pageStart,
    pageEnd: part.pageEnd,
  }))

  const meta: DocumentMeta = {
    id: documentId,
    chatId,
    name: file.name,
    pageCount,
    chunkCount: chunks.length,
    createdAt: Date.now(),
    sizeBytes: file.size,
  }

  await saveDocumentWithChunks(meta, chunks)
  return { meta, chunks }
}
