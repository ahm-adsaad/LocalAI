/**
 * Render eval/corpus/*.txt into real PDFs under public/samples so the eval
 * exercises the same pdf.js extraction path users hit. Lines starting with
 * "# " / "## " become headings; blank lines separate paragraphs.
 *
 *   npm run eval:pdfs
 */
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'

const CORPUS_DIR = join(process.cwd(), 'eval', 'corpus')
const OUT_DIR = join(process.cwd(), 'public', 'samples')

const PAGE_W = 612
const PAGE_H = 792
const MARGIN = 64
const BODY_SIZE = 11
const LEADING = 15

function wrap(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ''
  for (const w of words) {
    const candidate = line ? `${line} ${w}` : w
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate
    } else {
      if (line) lines.push(line)
      line = w
    }
  }
  if (line) lines.push(line)
  return lines
}

async function render(name: string, source: string) {
  const doc = await PDFDocument.create()
  const body = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  doc.setTitle(name)

  let page: PDFPage = doc.addPage([PAGE_W, PAGE_H])
  let y = PAGE_H - MARGIN
  const maxWidth = PAGE_W - MARGIN * 2

  const ensure = (needed: number) => {
    if (y - needed < MARGIN) {
      page = doc.addPage([PAGE_W, PAGE_H])
      y = PAGE_H - MARGIN
    }
  }

  const drawLines = (lines: string[], font: PDFFont, size: number, leading: number) => {
    for (const line of lines) {
      ensure(leading)
      page.drawText(line, { x: MARGIN, y, size, font, color: rgb(0.1, 0.1, 0.1) })
      y -= leading
    }
  }

  for (const block of source.replace(/\r\n/g, '\n').split(/\n{2,}/)) {
    const text = block.trim()
    if (!text) continue
    if (text.startsWith('## ')) {
      y -= 6
      drawLines(wrap(text.slice(3), bold, 13, maxWidth), bold, 13, 18)
      y -= 2
    } else if (text.startsWith('# ')) {
      drawLines(wrap(text.slice(2), bold, 18, maxWidth), bold, 18, 24)
      y -= 6
    } else {
      // Keep intentional single line breaks (tables, signature blocks).
      for (const raw of text.split('\n')) {
        drawLines(wrap(raw, body, BODY_SIZE, maxWidth), body, BODY_SIZE, LEADING)
      }
      y -= LEADING * 0.6
    }
  }

  return doc.save()
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const files = readdirSync(CORPUS_DIR).filter((f) => f.endsWith('.txt'))
  for (const f of files) {
    const stem = basename(f, '.txt')
    const bytes = await render(stem, readFileSync(join(CORPUS_DIR, f), 'utf8'))
    const out = join(OUT_DIR, `${stem}.pdf`)
    writeFileSync(out, bytes)
    console.log(`wrote ${out} (${(bytes.byteLength / 1024).toFixed(1)} KB)`)
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
