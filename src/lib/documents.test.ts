import { describe, expect, it } from 'vitest'
import { extractDocument } from './documents'

describe('extractDocument', () => {
  it('treats a text file as one unpaged document', async () => {
    const file = new File(['﻿Hello\r\nworld'], 'notes.txt', { type: 'text/plain' })
    await expect(extractDocument(file)).resolves.toEqual({ pages: null, text: 'Hello\nworld', pageCount: 0 })
  })

  it('refuses unsupported types by extension', async () => {
    await expect(extractDocument(new File(['x'], 'photo.png'))).rejects.toThrow(/Unsupported file type/)
  })
})
