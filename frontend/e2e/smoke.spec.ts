import { test, expect } from '@playwright/test'

test('app loads at /', async ({ page }) => {
  await page.goto('/')
  await expect(page.locator('h1')).toBeVisible()
  expect(await page.title()).not.toBe('')
})
