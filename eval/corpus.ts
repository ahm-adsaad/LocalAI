/**
 * Shared helpers for the Node evals: PDF text extraction with the browser's
 * reading-order code, golden-set loading, and relevance judgements.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { AutoModelForSequenceClassification, AutoTokenizer } from '@huggingface/transformers'
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import { pageItemsToText, type PdfTextItem } from '../src/lib/pdfText'
import type { RerankPair } from '../src/lib/types'

export interface GoldenItem {
  id: string
  doc: string
  question: string
  expect: string[]
  answer: string[]
  history?: Array<{ question: string; answer: string }>
}

export interface Golden {
  version: number
  documents: string[]
  items: GoldenItem[]
}

export const ROOT = process.cwd()
export const SAMPLES = join(ROOT, 'public', 'samples')
export const RESULTS = join(ROOT, 'eval', 'results')
export const MODEL_CACHE = join(ROOT, 'node_modules', '.cache', 'transformers')

export function loadGolden(): Golden {
  return JSON.parse(readFileSync(join(ROOT, 'eval', 'golden.json'), 'utf8')) as Golden
}

/** Page texts in reading order, exactly as the browser extractor builds them. */
export async function extractPdfPages(path: string): Promise<string[]> {
  const data = new Uint8Array(readFileSync(path))
  const doc = await pdfjs.getDocument({
    data,
    useWorkerFetch: false,
    isEvalSupported: false,
    standardFontDataUrl: join(ROOT, 'node_modules', 'pdfjs-dist', 'standard_fonts') + '/',
  }).promise
  const pages: string[] = []
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    pages.push(pageItemsToText(content.items as PdfTextItem[]))
  }
  return pages
}

export function textIsRelevant(item: GoldenItem, documentId: string, text: string): boolean {
  const lower = text.toLowerCase()
  return documentId === item.doc && item.expect.some((s) => lower.includes(s.toLowerCase()))
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) dot += a[i]! * b[i]!
  return dot
}

export function pct(x: number): string {
  return `${(x * 100).toFixed(1)}%`
}

export type Scorer = (pairs: RerankPair[]) => Promise<number[]>

interface LogitsOutput {
  logits: { dims: number[]; data: ArrayLike<number> }
}

/** Cross-encoder scorer: one relevance logit per (question, text) pair, same math as the worker. */
export async function loadReranker(id: string): Promise<Scorer> {
  const tokenizer = await AutoTokenizer.from_pretrained(id)
  let model
  try {
    model = await AutoModelForSequenceClassification.from_pretrained(id, { dtype: 'q8' })
  } catch {
    model = await AutoModelForSequenceClassification.from_pretrained(id, { dtype: 'fp32' })
  }
  return async (pairs) => {
    if (pairs.length === 0) return []
    const inputs = tokenizer(
      pairs.map((p) => p.query),
      { text_pair: pairs.map((p) => p.text), padding: true, truncation: true },
    )
    const { logits } = (await model(inputs)) as unknown as LogitsOutput
    const cols = logits.dims[1] ?? 1
    const col = cols === 2 ? 1 : 0
    return pairs.map((_, i) => Number(logits.data[i * cols + col]))
  }
}
