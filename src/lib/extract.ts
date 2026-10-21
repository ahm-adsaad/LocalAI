import type { ChatMessage, ExtractedField, RankedChunk } from './types'
import { formatExcerpts } from './prompt'

/**
 * Schema-driven extraction: `/extract patient name, allergies, medications`
 * retrieves the relevant excerpts, then decodes under a JSON-schema grammar so
 * the model cannot drift into prose. Each field carries the excerpt it came
 * from, so every value is auditable against the source cards.
 */

const COMMAND_RE = /^\/extract\b(.*)$/is
const MAX_FIELDS = 12
const NOT_FOUND_RE = /^(not found|n\/a|none|null|unknown|)$/i

export function parseExtractCommand(text: string): string[] | null {
  const m = COMMAND_RE.exec(text.trim())
  if (!m) return null
  const seen = new Set<string>()
  const fields: string[] = []
  for (const raw of (m[1] ?? '').split(/[,;\n]/)) {
    const name = raw.trim().replace(/\s+/g, ' ')
    const key = name.toLowerCase()
    if (!name || seen.has(key)) continue
    seen.add(key)
    fields.push(name)
    if (fields.length >= MAX_FIELDS) break
  }
  return fields.length > 0 ? fields : null
}

export interface ExtractionSchema {
  type: 'object'
  properties: Record<
    string,
    {
      type: 'object'
      properties: { value: { type: 'string' }; source: { type: 'integer' } }
      required: ['value', 'source']
    }
  >
  required: string[]
  additionalProperties: false
}

export function buildExtractionSchema(fields: string[]): ExtractionSchema {
  const properties: ExtractionSchema['properties'] = {}
  for (const f of fields) {
    properties[f] = {
      type: 'object',
      properties: { value: { type: 'string' }, source: { type: 'integer' } },
      required: ['value', 'source'],
    }
  }
  return { type: 'object', properties, required: [...fields], additionalProperties: false }
}

/** Retrieval query for an extraction: the field names themselves. */
export function extractionQuery(fields: string[]): string {
  return fields.join(', ')
}

export function buildExtractMessages(fields: string[], sources: RankedChunk[]): ChatMessage[] {
  const context = formatExcerpts(sources, fields.join(' '))
  const list = fields.map((f) => `- ${f}`).join('\n')
  return [
    {
      role: 'system',
      content:
        'You extract fields from document excerpts and answer only in JSON. ' +
        'For each requested field give the exact value from the excerpts and the number of the excerpt it came from. ' +
        'If a field is not present, set value to "not found" and source to 0. Never invent values.',
    },
    {
      role: 'user',
      content: `Excerpts:\n${context}\n\nFields to extract:\n${list}\n\nReturn JSON with one key per field, each an object with "value" and "source".`,
    },
  ]
}

function extractJsonObject(raw: string): Record<string, unknown> | null {
  const stripped = raw.replace(/```(?:json)?/gi, '').trim()
  const start = stripped.indexOf('{')
  const end = stripped.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(stripped.slice(start, end + 1))
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null
  } catch {
    return null
  }
}

/** GFM table used as the turn's text content so Markdown export still works. */
export function extractionToMarkdown(rows: ExtractedField[]): string {
  const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ')
  const lines = ['| Field | Value | Source |', '| --- | --- | --- |']
  for (const r of rows) {
    lines.push(
      `| ${cell(r.name)} | ${r.value == null ? '—' : cell(r.value)} | ${r.source == null ? '—' : `[${r.source}]`} |`,
    )
  }
  return lines.join('\n')
}

export function parseExtractionResult(
  raw: string,
  fields: string[],
  sourceCount: number,
): ExtractedField[] {
  const obj = extractJsonObject(raw) ?? {}
  return fields.map((name) => {
    const entry = obj[name]
    if (!entry || typeof entry !== 'object') return { name, value: null, source: null }
    const rec = entry as Record<string, unknown>
    const rawValue = typeof rec.value === 'string' ? rec.value.trim() : ''
    const value = NOT_FOUND_RE.test(rawValue) ? null : rawValue
    const rawSource = typeof rec.source === 'number' ? Math.trunc(rec.source) : NaN
    const source =
      value != null && Number.isFinite(rawSource) && rawSource >= 1 && rawSource <= sourceCount
        ? rawSource
        : null
    return { name, value, source }
  })
}
