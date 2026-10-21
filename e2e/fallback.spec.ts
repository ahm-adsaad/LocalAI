import { fileURLToPath } from 'node:url'
import { chromium, expect, test } from '@playwright/test'

const PROFILE = fileURLToPath(new URL('./.chrome-profile', import.meta.url))
test.skip(!!process.env.CI, 'needs a real GPU (WebGPU)')

test('a model that does not fit falls back to the next smaller one and is not remembered', async ({ baseURL }) => {
  const origin = new URL(baseURL!).origin
  const context = await chromium.launchPersistentContext(PROFILE, { channel: 'chrome', headless: false })
  try {
    const page = await context.newPage()
    await page.goto(`${origin}/?model=qwen-balanced&simulateOom=qwen-balanced`)
    await expect(page.getByText(/did not fit in this GPU/)).toBeVisible({ timeout: 10 * 60 * 1000 })
    await expect(page.getByPlaceholder(/Add a PDF|Ask a question/)).toBeVisible({ timeout: 10 * 60 * 1000 })
    await expect(page.getByText('Qwen 2.5 · 0.5B').first()).toBeVisible()
    // The failed model was not saved: a plain reload boots the small one directly.
    await page.goto(`${origin}/`)
    await expect(page.getByPlaceholder(/Add a PDF|Ask a question/)).toBeVisible({ timeout: 10 * 60 * 1000 })
    await expect(page.getByText('Qwen 2.5 · 0.5B').first()).toBeVisible()
  } finally {
    await context.close()
  }
})
