import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { CONTENT_SECURITY_POLICY, MODEL_HOSTS } from './csp'

function directive(name: string): string[] {
  const d = CONTENT_SECURITY_POLICY.split(';')
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name} `))
  return d ? d.split(/\s+/).slice(1) : []
}

describe('Content-Security-Policy', () => {
  it('lets the page connect only to itself and the model weight hosts', () => {
    expect(directive('connect-src').sort()).toEqual(["'self'", ...MODEL_HOSTS].sort())
  })

  it('runs only first-party scripts, with WebAssembly compilation allowed', () => {
    expect(directive('script-src')).toEqual(["'self'", "'wasm-unsafe-eval'"])
    expect(directive('object-src')).toEqual(["'none'"])
  })

  it('is exactly what the production host sends (public/_headers)', () => {
    const headers = readFileSync('public/_headers', 'utf8')
    expect(headers).toContain(`Content-Security-Policy: ${CONTENT_SECURITY_POLICY}`)
  })
})
