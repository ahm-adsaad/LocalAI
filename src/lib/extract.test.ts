import { describe, expect, it } from 'vitest'
import {
  buildExtractMessages,
  buildExtractionSchema,
  extractionToMarkdown,
  parseExtractCommand,
  parseExtractionResult,
} from './extract'
import type { RankedChunk } from './types'

describe('parseExtractCommand', () => {
  it('returns trimmed, de-duplicated field names from a slash command', () => {
    expect(parseExtractCommand('/extract patient name, allergies , allergies, medications')).toEqual([
      'patient name',
      'allergies',
      'medications',
    ])
  })

  it('returns null for ordinary questions', () => {
    expect(parseExtractCommand('What is the rent?')).toBeNull()
  })

  it('returns null when no fields follow the command', () => {
    expect(parseExtractCommand('/extract')).toBeNull()
    expect(parseExtractCommand('/extract   ')).toBeNull()
  })
})

describe('buildExtractionSchema', () => {
  it('produces a strict object schema with one required object per field', () => {
    const schema = buildExtractionSchema(['rent', 'tenant'])
    expect(schema.type).toBe('object')
    expect(schema.required).toEqual(['rent', 'tenant'])
    expect(schema.properties.rent).toEqual({
      type: 'object',
      properties: { value: { type: 'string' }, source: { type: 'integer' } },
      required: ['value', 'source'],
    })
    expect(schema.additionalProperties).toBe(false)
  })
})

describe('buildExtractMessages', () => {
  const sources: RankedChunk[] = [
    { id: 'a', documentId: 'd', documentName: 'lease.pdf', text: 'Rent is $1,200.', score: 0.9 },
  ]

  it('lists the excerpts and the requested fields', () => {
    const text = buildExtractMessages(['rent', 'tenant'], sources)
      .map((m) => m.content)
      .join('\n')
    expect(text).toContain('[1] lease.pdf')
    expect(text).toContain('rent')
    expect(text).toContain('tenant')
  })
})

describe('parseExtractionResult', () => {
  it('maps model JSON into ordered fields with nullable values and sources', () => {
    const raw = '{"rent":{"value":"$1,200","source":1},"tenant":{"value":"not found","source":0}}'
    const result = parseExtractionResult(raw, ['rent', 'tenant'], 1)
    expect(result).toEqual([
      { name: 'rent', value: '$1,200', source: 1 },
      { name: 'tenant', value: null, source: null },
    ])
  })

  it('tolerates code fences and drops out-of-range sources', () => {
    const raw = '```json\n{"rent":{"value":"$1,200","source":7}}\n```'
    const result = parseExtractionResult(raw, ['rent'], 2)
    expect(result).toEqual([{ name: 'rent', value: '$1,200', source: null }])
  })

  it('returns null values for fields missing from malformed output', () => {
    const result = parseExtractionResult('not json at all', ['rent'], 1)
    expect(result).toEqual([{ name: 'rent', value: null, source: null }])
  })
})

describe('extractionToMarkdown', () => {
  it('renders a GFM table with a dash for missing values', () => {
    const md = extractionToMarkdown([
      { name: 'rent', value: '$1,200', source: 1 },
      { name: 'tenant', value: null, source: null },
    ])
    expect(md).toBe(
      '| Field | Value | Source |\n| --- | --- | --- |\n| rent | $1,200 | [1] |\n| tenant | — | — |',
    )
  })
})
