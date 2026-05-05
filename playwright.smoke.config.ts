import { defineConfig, devices } from '@playwright/test'

/**
 * Deploy-gate smoke config. Runs only the smoke spec(s) against a remote URL
 * (Vercel preview or production), no local webServer.
 *
 * Usage:
 *   SMOKE_BASE_URL=https://<deployment>.vercel.app \
 *   SITE_ACCESS_CODE=<code> \
 *   npx playwright test --config playwright.smoke.config.ts
 */

const SMOKE_BASE_URL = process.env.SMOKE_BASE_URL ?? 'https://wirepredictions.vercel.app'

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /.*\.smoke\.spec\.ts/,
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: SMOKE_BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
