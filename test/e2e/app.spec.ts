import { test, expect } from 'playwright/test';

import type { RunningTestServer } from '../helpers/test-server';
import { startTestServer } from '../helpers/test-server';

let server: RunningTestServer;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(async () => {
  await server.stop();
});

test('dashboard creates and drives a fake session', async ({ page }) => {
  await page.goto(server.url);
  await expect(page.getByRole('heading', { name: 'Create session' })).toBeVisible();
  await page.getByLabel('Agent').selectOption('fake');
  await page.getByLabel('Initial prompt').fill('hello world');
  await page.getByRole('button', { name: 'Create session' }).click();

  await expect(page.getByRole('heading', { name: 'hello world' })).toBeVisible();
  await page.getByLabel('Message').fill('need approval');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByRole('heading', { name: 'Pending actions' })).toBeVisible();
  await expect(page.getByText('Allow the fake adapter to continue?', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Allow' }).click();
  await expect(page.getByText('No pending actions.')).toBeVisible();

  await page.getByRole('button', { name: 'Terminate', exact: true }).click();
  await expect(page.getByText('fake · terminated · build')).toBeVisible();
});

test('session transcript survives browser reload without duplicate messages', async ({ page }) => {
  await page.goto(server.url);
  await page.getByLabel('Agent').selectOption('fake');
  await page.getByLabel('Initial prompt').fill('hello world');
  await page.getByRole('button', { name: 'Create session' }).click();
  await expect(page.getByText('Fake session ready for: hello world')).toBeVisible();

  const before = await page.locator('.message').count();
  await page.reload();
  await expect(page.getByText('Fake session ready for: hello world')).toBeVisible();
  const after = await page.locator('.message').count();
  expect(after).toBe(before);
});

test('settings and doctor routes render on direct load before hydration completes', async ({ page }) => {
  await page.goto(`${server.url}#/settings`);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  await page.goto(`${server.url}#/doctor`);
  await expect(page.getByRole('heading', { name: 'Doctor' })).toBeVisible();
});
