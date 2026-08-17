import { test, expect } from '@playwright/test'

/**
 * HermesCN E2E suite. Runs against an isolated backend (temporary state,
 * non-default port) via e2e/start-isolated.sh. The app shell must be the real
 * React app — a test that passes against the 503 "Frontend is not built"
 * placeholder is a failure.
 */

test('serves the real React app at / (never the 503 placeholder)', async ({ page }) => {
  const response = await page.goto('/')
  expect(response?.status()).toBe(200)
  // The React root must be present and hydrated.
  await expect(page.locator('#root')).toBeVisible()
  // The 503 placeholder must never appear.
  await expect(page.getByText('Frontend is not built')).toHaveCount(0)
  await expect(page.getByText('Hermes is restarting')).toHaveCount(0)
})

test('renders the chat workbench shell', async ({ page }) => {
  await page.goto('/')
  // The three-panel workbench: a heading and the composer.
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible()
  await expect(page.getByTestId('composer')).toBeVisible()
})

test('document title is HermesCN', async ({ page }) => {
  await page.goto('/')
  await expect(page).toHaveTitle(/HermesCN/)
})

test('login page renders when auth is enabled', async ({ page }) => {
  // The isolated backend has no password set, so auth is disabled and the app
  // bounces to /. We assert the login route still serves the React shell.
  await page.goto('/login')
  await expect(page.locator('#root')).toBeVisible()
})

test('session deep link loads the app shell', async ({ page }) => {
  // A non-existent session id should still render the app shell (the backend
  // returns an error, but the SPA must not crash or show the 503 placeholder).
  await page.goto('/session/does-not-exist')
  await expect(page.locator('#root')).toBeVisible()
  await expect(page.getByText('Frontend is not built')).toHaveCount(0)
})

test('PWA manifest and service worker are served', async ({ page }) => {
  const manifest = await page.request.get('/manifest.json')
  expect(manifest.status()).toBe(200)
  const sw = await page.request.get('/sw.js')
  expect(sw.status()).toBe(200)
})

test('JS entry is served with correct MIME', async ({ page }) => {
  // In dev mode the entry is /src/main.tsx; in a built/preview run it is a
  // hashed /assets/*.js. Either way the served JS must have a JS content type.
  const index = await page.request.get('/')
  const html = await index.text()
  const match = html.match(/src="([^"]+\.(?:js|tsx))"/)
  expect(match).not.toBeNull()
  const asset = await page.request.get(match![1])
  expect(asset.status()).toBe(200)
  expect(asset.headers()['content-type']).toContain('javascript')
})

/**
 * Dismiss the first-run wizard when the isolated backend has no config yet.
 * The wizard overlays the whole app, so every interaction test needs it gone.
 */
async function skipOnboarding(page: import('@playwright/test').Page) {
  const skip = page.getByRole('button', { name: 'Skip setup' })
  if (await skip.count()) {
    await skip.click()
    await expect(page.getByRole('dialog', { name: 'Onboarding wizard' })).toHaveCount(0)
  }
}

test('creating a conversation from the sidebar reaches the empty state', async ({ page }) => {
  // Regression guard for two separate faults: the dev proxy rejected every
  // write as a cross-origin mismatch, and newSession() swallowed the failure,
  // so the button visibly did nothing at all.
  await page.goto('/')
  await skipOnboarding(page)
  await page.getByRole('button', { name: 'New conversation' }).first().click()
  await expect(page.getByTestId('chat-empty-state')).toBeVisible()
  await expect(page.getByTestId('composer-textarea')).toBeVisible()
})

test('the composer grows with a multi-line draft', async ({ page }) => {
  await page.goto('/')
  await skipOnboarding(page)
  const composer = page.getByTestId('composer-textarea')
  await composer.fill('one')
  const single = (await composer.boundingBox())!.height
  await composer.fill('one\ntwo\nthree\nfour\nfive')
  const multi = (await composer.boundingBox())!.height
  expect(multi).toBeGreaterThan(single + 20)
})

test('the keyboard shortcuts dialog opens from the header and closes on Escape', async ({ page }) => {
  await page.goto('/')
  await skipOnboarding(page)
  await page.getByRole('button', { name: 'Keyboard shortcuts' }).click()
  const dialog = page.getByRole('dialog').filter({ hasText: 'Keyboard shortcuts' })
  await expect(dialog.getByRole('heading', { name: 'Keyboard shortcuts' })).toBeVisible()
  // The shortcuts the chat surface actually binds are all listed.
  await expect(dialog.getByText('New conversation')).toBeVisible()
  await expect(dialog.getByText('Stop the running turn')).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('heading', { name: 'Keyboard shortcuts' })).toHaveCount(0)
})

test('the Control Center exposes every section without clipping', async ({ page }) => {
  // The twelve sections used to sit in a horizontal tab strip whose tail fell
  // off the edge of the dialog with no way to scroll to it.
  await page.goto('/')
  await skipOnboarding(page)
  await page.getByRole('button', { name: /Control Center/i }).click()
  for (const name of ['Tasks', 'Skills', 'Providers', 'Logs', 'Settings']) {
    await expect(page.getByRole('tab', { name })).toBeInViewport()
  }
})
