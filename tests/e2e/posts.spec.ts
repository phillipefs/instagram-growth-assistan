import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import {
  readPostCommenters,
  readPostLikers,
  readRecentPostShortcodes,
} from '../../src/browser/read-posts.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../fixtures/engagement');

function fixtureUrl(name: string): string {
  return pathToFileURL(path.join(fixturesDir, name)).href;
}

test('lê shortcodes das publicações recentes', async ({ page }) => {
  await page.goto(fixtureUrl('grid.html'));
  const shortcodes = await readRecentPostShortcodes(page);
  expect(shortcodes).toContain('AAA111');
  expect(shortcodes).toContain('BBB222');
  expect(shortcodes).toContain('CCC333');
});

test('lê comentaristas de uma publicação', async ({ page }) => {
  await page.goto(fixtureUrl('post_comments.html'));
  const commenters = await readPostCommenters(page);
  expect(commenters).toEqual(['user1', 'user2', 'user3']);
});

test('lê curtidores quando acessíveis', async ({ page }) => {
  await page.goto(fixtureUrl('post_likers.html'));
  const likers = await readPostLikers(page);
  expect(likers.accessible).toBe(true);
  expect(likers.usernames).toEqual(['liker_one', 'liker_two']);
});

test('trata curtidores ocultos como indisponíveis', async ({ page }) => {
  await page.goto(fixtureUrl('post_likers_hidden.html'));
  const likers = await readPostLikers(page);
  expect(likers.accessible).toBe(false);
  expect(likers.usernames).toEqual([]);
});
