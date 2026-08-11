import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import {
  readPostCommenters,
  readPostLikers,
  readPostPublishedAt,
  readRecentPosts,
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

test('lê metadados da grade e a data da publicação aberta', async ({ page }) => {
  await page.goto(fixtureUrl('grid_dated.html'));
  const posts = await readRecentPosts(page, 3);
  expect(posts[0]).toMatchObject({ shortcode: 'PIN000', isPinned: true });
  expect(posts[1]).toMatchObject({
    shortcode: 'NEW222',
    publishedAt: '2026-08-01T00:00:00.000Z',
  });

  await page.setContent(
    '<article><time datetime="2026-08-07T12:30:00Z">7 de agosto</time></article>',
  );
  await expect(readPostPublishedAt(page)).resolves.toBe('2026-08-07T12:30:00.000Z');
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

test('permite extrair mais de 80 comentaristas quando configurado', async ({ page }) => {
  const links = Array.from(
    { length: 125 },
    (_, index) => `<a href="/user${String(index).padStart(3, '0')}/"><img alt="avatar"></a>`,
  ).join('');
  await page.setContent(`<main>${links}</main>`);

  expect(await readPostCommenters(page)).toHaveLength(80);
  expect(await readPostCommenters(page, 120)).toHaveLength(120);
});

test('lê curtidores quando acessíveis', async ({ page }) => {
  await page.goto(fixtureUrl('post_likers.html'));
  const likers = await readPostLikers(page);
  expect(likers.accessible).toBe(true);
  expect(likers.usernames).toEqual(['liker_one', 'liker_two']);
});

test('prioriza a contagem numérica do post sobre curtidas de comentário', async ({ page }) => {
  await page.route('https://www.instagram.com/p/POST123/', async (route) => {
    await route.fulfill({
      contentType: 'text/html',
      body: `
        <article>
          <div id="comment-likes" role="button">3 curtidas</div>
          <div id="post-actions">
            <span role="button"><svg aria-label="Curtir"></svg></span>
            <span id="post-likes" role="button">4</span>
          </div>
        </article>
        <div id="comment-dialog" data-testid="likers-dialog" role="dialog" hidden>
          <h2>Curtidas</h2>
          <a href="/comment_liker_a/">A</a>
          <a href="/comment_liker_b/">B</a>
          <a href="/comment_liker_c/">C</a>
        </div>
        <div id="post-dialog" data-testid="likers-dialog" role="dialog" hidden>
          <h2>Curtidas</h2>
          <a href="/post_liker_a/">A</a>
          <a href="/post_liker_b/">B</a>
          <a href="/post_liker_c/">C</a>
          <a href="/post_liker_d/">D</a>
        </div>
        <script>
          document.querySelector('#comment-likes').addEventListener('click', () => {
            document.querySelector('#comment-dialog').hidden = false;
          });
          document.querySelector('#post-likes').addEventListener('click', () => {
            document.querySelector('#post-dialog').hidden = false;
          });
        </script>
      `,
    });
  });
  await page.goto('https://www.instagram.com/p/POST123/');

  const likers = await readPostLikers(page, 10);
  expect(likers.accessible).toBe(true);
  expect(likers.complete).toBe(true);
  expect(likers.expectedCount).toBe(4);
  expect(likers.usernames).toEqual([
    'post_liker_a',
    'post_liker_b',
    'post_liker_c',
    'post_liker_d',
  ]);
});

test('abre o diálogo e carrega todos os 188 curtidores por rolagem', async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="open-likers">188 likes</button>
      <div data-testid="likers-dialog" role="dialog" hidden>
        <h2>Likes</h2>
        <div id="likers-list" data-testid="likers-scroll"></div>
      </div>
    </main>
    <style>
      #likers-list { height: 180px; overflow-y: auto; }
      #likers-list a { display: block; height: 20px; }
    </style>
    <script>
      const total = 188;
      let loaded = 0;
      const dialog = document.querySelector('[data-testid="likers-dialog"]');
      const list = document.querySelector('#likers-list');
      const appendBatch = () => {
        const target = Math.min(total, loaded + 25);
        while (loaded < target) {
          const link = document.createElement('a');
          link.href = '/liker_' + String(loaded).padStart(3, '0') + '/';
          link.textContent = 'liker_' + String(loaded).padStart(3, '0');
          list.appendChild(link);
          loaded += 1;
        }
      };
      document.querySelector('#open-likers').addEventListener('click', () => {
        dialog.hidden = false;
        appendBatch();
      });
      list.addEventListener('scroll', () => {
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 25) appendBatch();
      });
    </script>
  `);

  const likers = await readPostLikers(page, 500);
  expect(likers.accessible).toBe(true);
  expect(likers.complete).toBe(true);
  expect(likers.expectedCount).toBe(188);
  expect(likers.usernames).toHaveLength(188);
  expect(likers.usernames[0]).toBe('liker_000');
  expect(likers.usernames[187]).toBe('liker_187');
});

test('lê curtidores em painel visual sem role dialog', async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="open-likers">4 curtidas</button>
      <div id="likers-sheet" style="display: none; position: fixed; inset: 0">
        <h2>Curtidas</h2>
        <a href="/liker_a/">A</a>
        <a href="/liker_b/">B</a>
        <a href="/liker_c/">C</a>
        <a href="/liker_d/">D</a>
      </div>
    </main>
    <script>
      document.querySelector('#open-likers').addEventListener('click', () => {
        document.querySelector('#likers-sheet').style.display = 'block';
      });
    </script>
  `);

  const likers = await readPostLikers(page, 10);
  expect(likers.accessible).toBe(true);
  expect(likers.complete).toBe(true);
  expect(likers.usernames).toEqual(['liker_a', 'liker_b', 'liker_c', 'liker_d']);
});

test('prioriza o link textual quando miniaturas e contagem usam liked_by', async ({ page }) => {
  await page.setContent(`
    <main>
      <a id="avatar-link" href="/p/POST123/liked_by/"><img alt="miniatura"></a>
      <a id="count-link" href="/p/POST123/liked_by/">outras 2 pessoas</a>
      <div data-testid="likers-dialog" role="dialog" hidden>
        <h2>Curtidas</h2>
        <a href="/liker_a/">A</a>
        <a href="/liker_b/">B</a>
        <a href="/liker_c/">C</a>
      </div>
    </main>
    <script>
      document.querySelector('#count-link').addEventListener('click', (event) => {
        event.preventDefault();
        document.querySelector('[data-testid="likers-dialog"]').hidden = false;
      });
    </script>
  `);

  const likers = await readPostLikers(page, 10);
  expect(likers.accessible).toBe(true);
  expect(likers.complete).toBe(true);
  expect(likers.expectedCount).toBe(3);
  expect(likers.usernames).toEqual(['liker_a', 'liker_b', 'liker_c']);
});

test('lê curtidores quando o link abre uma página em vez de diálogo', async ({ page }) => {
  await page.setContent(`
    <main id="post">
      <a id="open-likers" href="/p/POST123/liked_by/">3 likes</a>
    </main>
    <main data-testid="likers-page" hidden>
      <h1>Likes</h1>
      <a href="/page_liker_a/">A</a>
      <a href="/page_liker_b/">B</a>
      <a href="/page_liker_c/">C</a>
    </main>
    <script>
      document.querySelector('#open-likers').addEventListener('click', (event) => {
        event.preventDefault();
        document.querySelector('#post').hidden = true;
        document.querySelector('[data-testid="likers-page"]').hidden = false;
      });
    </script>
  `);

  const likers = await readPostLikers(page, 10);
  expect(likers.accessible).toBe(true);
  expect(likers.complete).toBe(true);
  expect(likers.usernames).toEqual(['page_liker_a', 'page_liker_b', 'page_liker_c']);
});

test('não lê links de um diálogo que não seja de curtidores', async ({ page }) => {
  await page.setContent(`
    <main>
      <button id="open-dialog">188 curtidas</button>
      <div role="dialog" hidden>
        <h2>Compartilhar</h2>
        <a href="/nao_eh_curtidor/">perfil fora da lista</a>
      </div>
    </main>
    <script>
      document.querySelector('#open-dialog').addEventListener('click', () => {
        document.querySelector('[role="dialog"]').hidden = false;
      });
    </script>
  `);

  const likers = await readPostLikers(page, 500);
  expect(likers.accessible).toBe(false);
  expect(likers.usernames).toEqual([]);
  expect(likers.reason).toContain('não reconhecido');
});

test('trata curtidores ocultos como indisponíveis', async ({ page }) => {
  await page.goto(fixtureUrl('post_likers_hidden.html'));
  const likers = await readPostLikers(page);
  expect(likers.accessible).toBe(false);
  expect(likers.usernames).toEqual([]);
});
