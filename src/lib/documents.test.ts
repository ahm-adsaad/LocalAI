import { describe, expect, it } from 'vitest'
import { extractDocument } from './documents'

describe('extractDocument', () => {
  it('treats a text file as one unpaged document', async () => {
    const file = new File(['﻿Hello\r\nworld'], 'notes.txt', { type: 'text/plain' })
    await expect(extractDocument(file)).resolves.toEqual({ pages: null, text: 'Hello\nworld', pageCount: 0 })
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
