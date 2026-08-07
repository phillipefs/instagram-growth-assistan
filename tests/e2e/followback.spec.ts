import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { readFollowsYou } from '../../src/browser/read-followback.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../fixtures/profile');

function fixtureUrl(name: string): string {
  return pathToFileURL(path.join(fixturesDir, name)).href;
}

test('detecta o selo "segue você"', async ({ page }) => {
  await page.goto(fixtureUrl('follows_you.html'));
  expect(await readFollowsYou(page)).toBe(true);
});

test('não detecta o selo em perfil sem ele', async ({ page }) => {
  await page.goto(fixtureUrl('public.html'));
  expect(await readFollowsYou(page)).toBe(false);
});
