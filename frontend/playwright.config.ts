import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  use: {
    baseURL: 'http://127.0.0.1:5173',
  },
  webServer: {
    // Boots an isolated backend (temporary state, non-default port) plus the
    // Vite dev server proxying to it. See e2e/start-isolated.sh.
    command: 'bash e2e/start-isolated.sh',
    url: 'http://127.0.0.1:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
