import { defineConfig } from '@playwright/test'

const PORT = 4173
const CI = !!process.env.CI

/**
 * e2e/ runs against the production build served by `vite preview`, so the
 * CSP, headers, and asset paths under test are exactly what users get.
 *
 * Locally the installed Google Chrome is used: it has WebGPU on the real GPU,
 * which the privacy audit needs. CI uses Playwright's Chromium (no GPU) and
 * runs only the header and boot checks.
 */
export default defineConfig({
  testDir: 'e2e',
  timeout: 20 * 60 * 1000,
  expect: { timeout: 30_000 },
  workers: 1,
  retries: 0,
  reporter: CI ? 'github' : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    ...(CI ? {} : { channel: 'chrome' as const }),
  },
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !CI,
    timeout: 180_000,
  },
})
