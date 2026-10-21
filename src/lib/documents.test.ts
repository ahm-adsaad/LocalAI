import { describe, expect, it } from 'vitest'
import { decodeTextFile, extractDocument } from './documents'

describe('extractDocument', () => {
  it('treats a text file as one unpaged document', async () => {
    const file = new File(['﻿Hello\r\nworld'], 'notes.txt', { type: 'text/plain' })
    await expect(extractDocument(file)).resolves.toEqual({ pages: null, text: 'Hello\nworld', pageCount: 0 })
  })

  it('decodes a UTF-16LE text file with a BOM instead of indexing NULs', async () => {
    const bytes = new Uint8Array([0xff, 0xfe, ...Buffer.from('Hello\r\nworld', 'utf16le')])
    const file = new File([bytes], 'notes.txt', { type: 'text/plain' })
    await expect(extractDocument(file)).resolves.toEqual({ pages: null, text: 'Hello\nworld', pageCount: 0 })
  })

  it('decodeTextFile sniffs UTF-16BE and falls back to UTF-8', () => {
    const be = new Uint8Array([0xfe, 0xff, 0x00, 0x48, 0x00, 0x69])
    expect(decodeTextFile(be.buffer)).toBe('Hi')
    expect(decodeTextFile(new TextEncoder().encode('café').buffer as ArrayBuffer)).toBe('café')
  })

  it('extracts DOCX text through the injected extractor and fails on empty documents', async () => {
    const { extractDocx } = await import('./documents')
    await expect(extractDocx(new ArrayBuffer(0), async () => 'Para one\r\n\r\nPara two')).resolves.toEqual({
      pages: null, text: 'Para one\n\nPara two', pageCount: 0,
    })
    await expect(extractDocx(new ArrayBuffer(0), async () => '   ')).resolves.toMatchObject({ text: '' })
  })

  it('refuses unsupported types by extension', async () => {
    await expect(extractDocument(new File(['x'], 'photo.png'))).rejects.toThrow(/Unsupported file type/)
  })
})
