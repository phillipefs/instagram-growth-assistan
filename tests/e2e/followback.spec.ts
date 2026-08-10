import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { readFollowsYou } from '../../src/browser/read-followback.js';
import { readFollowersList } from '../../src/browser/read-followers-list.js';

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

test('confirma follow-back pela lista completa de seguidores', async ({ page }) => {
  await page.goto(fixtureUrl('followers_list.html'));
  const snapshot = await readFollowersList(page, 'appassetlens', 3);
  expect(snapshot.complete).toBe(true);
  expect(snapshot.loadedCount).toBe(3);
  expect(snapshot.usernames.has('edu.brasileiro')).toBe(true);
  expect(snapshot.usernames.has('nao_segue')).toBe(false);
});

test('não conclui ausência quando a lista está incompleta', async ({ page }) => {
  await page.goto(fixtureUrl('followers_list.html'));
  const snapshot = await readFollowersList(page, 'appassetlens', 4);
  expect(snapshot.complete).toBe(false);
  expect(snapshot.reason).toContain('lista incompleta');
});
