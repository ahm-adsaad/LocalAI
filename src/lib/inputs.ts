export type InputKind = 'pdf' | 'text' | 'markdown' | 'docx'

export const ACCEPTED_EXTENSIONS = '.pdf,.txt,.md,.markdown,.docx'

const KIND_BY_EXTENSION: Record<string, InputKind> = {
  pdf: 'pdf',
  txt: 'text',
  md: 'markdown',
  markdown: 'markdown',
  docx: 'docx',
}

/** Classify a file by its extension (case-insensitive); null when unsupported. */
export function detectInputKind(fileName: string): InputKind | null {
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return null
  return KIND_BY_EXTENSION[fileName.slice(dot + 1).toLowerCase()] ?? null
}

export function isSupportedFile(file: { name: string }): boolean {
  return detectInputKind(file.name) !== null
}

/** Strip a leading BOM and normalise Windows and classic-Mac line endings. */
export function readTextFile(raw: string): string {
  return raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n')
}
