import { describe, expect, it } from 'vitest'
import { detectInputKind, isSupportedFile, readTextFile } from './inputs'

describe('detectInputKind', () => {
  it('maps extensions case-insensitively and rejects the rest', () => {
    expect(detectInputKind('Lease.PDF')).toBe('pdf')
    expect(detectInputKind('notes.txt')).toBe('text')
    expect(detectInputKind('README.md')).toBe('markdown')
    expect(detectInputKind('report.docx')).toBe('docx')
    expect(detectInputKind('photo.png')).toBeNull()
    expect(isSupportedFile({ name: 'photo.png' })).toBe(false)
  })
})

describe('readTextFile', () => {
  it('drops a UTF-8 BOM and normalises Windows line endings', () => {
    expect(readTextFile('﻿First line\r\nSecond line')).toBe('First line\nSecond line')
  })

  it('normalises a lone carriage return to a newline', () => {
    expect(readTextFile('one\rtwo\r\nthree')).toBe('one\ntwo\nthree')
  })
})
