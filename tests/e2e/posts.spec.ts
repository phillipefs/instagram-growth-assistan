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
  const shortcodes = await readRecentPostShortcodes(page, 3);
  expect(shortcodes).toContain('AAA111');
  expect(shortcodes).toContain('BBB222');
  expect(shortcodes).toContain('CCC333');
});

test('rola a grade até atingir o limite de publicações', async ({ page }) => {
  await page.setContent(`
    <style>.post { display: block; height: 500px; }</style>
    <main id="grid">
      <a class="post" href="/p/POST001/">Post 1</a>
      <a class="post" href="/p/POST002/">Post 2</a>
      <a class="post" href="/p/POST003/">Post 3</a>
    </main>
    <script>
      let loaded = 3;
      window.addEventListener('scroll', () => {
        if (loaded >= 9) return;
        const grid = document.querySelector('#grid');
        for (let index = 0; index < 3; index += 1) {
          loaded += 1;
          const link = document.createElement('a');
          link.className = 'post';
          link.href = '/p/POST' + String(loaded).padStart(3, '0') + '/';
          link.textContent = 'Post ' + loaded;
          grid.appendChild(link);
        }
      });
    </script>
  `);

  await expect(readRecentPostShortcodes(page, 8)).resolves.toEqual([
    'POST001',
    'POST002',
    'POST003',
    'POST004',
    'POST005',
    'POST006',
    'POST007',
    'POST008',
  ]);
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
