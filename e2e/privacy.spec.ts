import { fileURLToPath } from 'node:url'
import { chromium, expect, test } from '@playwright/test'
import { hostAllowed, isCspViolation } from './hosts'

/**
 * The privacy audit. Drives the real app on a real GPU: boot the smallest
 * model, index a sample PDF, ask a question, and prove that over the whole
 * session (a) every network request went to this origin or a model-weight
 * host, (b) not one request carried a body, (c) nothing from the document
 * appeared in any URL, and (d) the CSP never had to block anything.
 *
 * Needs WebGPU, so it runs locally in the installed Chrome (a persistent
 * profile under e2e/.chrome-profile keeps the weights cached between runs)
 * and is skipped in CI.
 */
const PROFILE = fileURLToPath(new URL('./.chrome-profile', import.meta.url))
const SAMPLE_PDF = 'public/samples/clinic-visit-summary.pdf'
const QUESTION = 'What allergy does Jordan Lee have?'
/** Strings that exist only inside the sample document. */
const DOC_TERMS = ['jordan lee', 'penicillin', 'rfc-204817']

test.skip(!!process.env.CI, 'needs a real GPU (WebGPU)')

test('document text never leaves the browser', async ({ baseURL }) => {
  const origin = new URL(baseURL!).origin
  const context = await chromium.launchPersistentContext(PROFILE, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1280, height: 900 },
  })

  try {
    const requests: Array<{ url: string; method: string; body: string | null }> = []
    const violations: string[] = []
    context.on('request', (r) => requests.push({ url: r.url(), method: r.method(), body: r.postData() }))

    const page = await context.newPage()
    page.on('console', (m) => {
      if (isCspViolation(m.text())) violations.push(m.text())
    })

    // Smallest model keeps the first-run download short; later runs hit the cache.
    await page.goto(`${origin}/?model=qwen-fast`)
    const input = page.getByPlaceholder(/Add a PDF to this chat|Ask a question about/)
    await expect(input).toBeVisible({ timeout: 15 * 60 * 1000 })

    await page.locator('input[type="file"]').setInputFiles(SAMPLE_PDF)
    await expect(page.getByText(/Indexed \d+ chunks/)).toBeVisible({ timeout: 5 * 60 * 1000 })

    await input.fill(QUESTION)
    await input.press('Enter')
    await expect(page.locator('.prose-chat').last()).toContainText(/penicillin/i, {
      timeout: 10 * 60 * 1000,
    })
    // The stats footer renders once generation has finished.
    await expect(page.getByText(/tok\/s · /).last()).toBeVisible({ timeout: 60_000 })

    const offHost = requests.filter((r) => !hostAllowed(r.url, origin)).map((r) => r.url)
    expect(offHost, 'requests outside this origin and the model-weight hosts').toEqual([])

    const withBody = requests
      .filter((r) => r.body != null || !['GET', 'HEAD'].includes(r.method))
      .map((r) => `${r.method} ${r.url}`)
    expect(withBody, 'requests that carried a body').toEqual([])

    const leaks = requests
      .filter((r) => DOC_TERMS.some((t) => decodeURIComponent(r.url).toLowerCase().includes(t)))
      .map((r) => r.url)
    expect(leaks, 'document text in a URL').toEqual([])

    expect(violations, 'CSP violations').toEqual([])

    // The embedder's WebAssembly runtime came from this origin, not a CDN.
    expect(requests.some((r) => r.url.startsWith(`${origin}/ort/`))).toBe(true)

    test.info().annotations.push({
      type: 'network',
      description: `${requests.length} requests; hosts: ${[...new Set(requests.map((r) => new URL(r.url).host))].join(', ')}`,
    })
  } finally {
    await context.close()
  }
})
