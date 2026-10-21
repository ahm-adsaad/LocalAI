import { expect, test } from '@playwright/test'
import { CONTENT_SECURITY_POLICY } from '../src/lib/csp'
import { hostAllowed, isCspViolation } from './hosts'

/**
 * Header and boot checks. These need no GPU, so they run in CI on every push:
 * the production build must ship the strict CSP, serve the ONNX runtime
 * itself, and come up without a single policy violation or third-party call.
 */

test('the document is served with the strict CSP and cross-origin isolation', async ({ page }) => {
  const res = await page.goto('/')
  const headers = res!.headers()
  expect(headers['content-security-policy']).toBe(CONTENT_SECURITY_POLICY)
  expect(headers['cross-origin-opener-policy']).toBe('same-origin')
  expect(headers['cross-origin-embedder-policy']).toBe('credentialless')
})

test('the ONNX runtime is served first-party, not from a CDN', async ({ request }) => {
  for (const name of ['ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.asyncify.wasm']) {
    const res = await request.get(`/ort/${name}`)
    expect(res.status(), name).toBe(200)
  }
})

test('booting raises no CSP violation and contacts no third party', async ({ page, baseURL }) => {
  const origin = new URL(baseURL!).origin
  const violations: string[] = []
  const offHost: string[] = []
  page.on('console', (m) => {
    if (isCspViolation(m.text())) violations.push(m.text())
  })
  page.on('request', (r) => {
    if (!hostAllowed(r.url(), origin)) offHost.push(r.url())
  })

  await page.goto('/')
  // With WebGPU the model boot starts; without it the WebGPU gate renders.
  // Either way the app has painted something and nothing has been blocked.
  await expect(page.locator('#root')).not.toBeEmpty()
  await page.waitForTimeout(3_000)

  expect(violations).toEqual([])
  expect(offHost).toEqual([])
})
