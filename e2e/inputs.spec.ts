import { fileURLToPath } from 'node:url'
import { chromium, expect, test } from '@playwright/test'
import { isCspViolation } from './hosts'

/**
 * Each supported non-PDF format is uploaded into a fresh page, indexed, and
 * queried for a sentence that exists only in the fixture. Needs WebGPU, so it
 * runs locally in the installed Chrome (persistent profile caches the weights)
 * and is skipped in CI.
 */
const PROFILE = fileURLToPath(new URL('./.chrome-profile', import.meta.url))
const QUESTION = 'What is the project codename?'

test.skip(!!process.env.CI, 'needs a real GPU (WebGPU)')

for (const name of ['notes.txt', 'notes.md', 'notes.docx']) {
  test(`${name} is indexed and answerable`, async ({ baseURL }) => {
    const origin = new URL(baseURL!).origin
    const context = await chromium.launchPersistentContext(PROFILE, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1280, height: 900 },
    })

    try {
      const violations: string[] = []
      const page = await context.newPage()
      page.on('console', (m) => {
        if (isCspViolation(m.text())) violations.push(m.text())
      })

      await page.goto(`${origin}/?model=qwen-fast`)
      const input = page.getByPlaceholder(/Add a PDF to this chat|Ask a question about/)
      await expect(input).toBeVisible({ timeout: 15 * 60 * 1000 })

      // The persistent profile restores earlier chats; start clean so only this fixture is retrievable.
      await page.getByRole('button', { name: /new chat/i }).first().click()
      await page.locator('input[type="file"]').setInputFiles(`e2e/fixtures/${name}`)
      await expect(page.getByText(/Indexed \d+ chunks/)).toBeVisible({ timeout: 5 * 60 * 1000 })

      await input.fill(QUESTION)
      await input.press('Enter')
      await expect(page.locator('.prose-chat').last()).toContainText(/Tangerine Falcon/i, {
        timeout: 10 * 60 * 1000,
      })

      expect(violations, 'CSP violations').toEqual([])
    } finally {
      await context.close()
    }
  })
}
