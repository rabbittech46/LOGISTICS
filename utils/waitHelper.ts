import { expect, type Page } from '@playwright/test';

export async function waitForPath(page: Page, path: string, timeout = 15_000): Promise<void> {
  await page.waitForURL((url) => url.pathname === path, { timeout });
  expect(new URL(page.url()).pathname).toBe(path);
}

export async function expectRedirectToLogin(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForURL((url) => url.pathname === '/login', { timeout });
  expect(new URL(page.url()).pathname).toBe('/login');
}

export async function expectHeading(page: Page, heading: string | RegExp): Promise<void> {
  if (heading instanceof RegExp) {
    await expect(page.getByRole('heading').filter({ hasText: heading })).toHaveCount(1);
    await expect(page.getByRole('heading').filter({ hasText: heading }).first()).toBeVisible();
    return;
  }

  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
}

export async function waitForToast(page: Page, message: string | RegExp): Promise<void> {
  const locator = typeof message === 'string'
    ? page.getByText(message, { exact: false })
    : page.getByText(message);

  await expect(locator.first()).toBeVisible();
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}