import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { readGridPosts, readLikeState, performLike } from '../../src/browser/like-action.js';
import { selectRecentPost } from '../../src/domain/recent-post.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../fixtures/engagement');

function fixtureUrl(name: string): string {
  return pathToFileURL(path.join(fixturesDir, name)).href;
}

test('lê estado não curtido e confirma a curtida', async ({ page }) => {
  await page.goto(fixtureUrl('post_not_liked.html'));
  expect(await readLikeState(page)).toBe('NOT_LIKED');
  expect(await performLike(page)).toBe('LIKED');
});

test('reconhece publicação já curtida', async ({ page }) => {
  await page.goto(fixtureUrl('post_liked.html'));
  expect(await readLikeState(page)).toBe('LIKED');
});

test('lê a grade datada e seleciona a publicação recente', async ({ page }) => {
  await page.goto(fixtureUrl('grid_dated.html'));
  const posts = await readGridPosts(page);
  const selection = selectRecentPost(posts, { now: new Date('2026-08-06T00:00:00.000Z'), maxAgeDays: 30 });
  expect(selection.post?.shortcode).toBe('NEW222');
});
