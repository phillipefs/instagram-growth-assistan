import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { performUnfollow } from '../../src/browser/unfollow-action.js';
import { FollowingListUnfollowController } from '../../src/browser/following-list-unfollow.js';
import { readProfileSignals } from '../../src/browser/read-profile.js';
import { assessProfile } from '../../src/browser/profile-detector.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../fixtures/unfollow');

function fixtureUrl(name: string): string {
  return pathToFileURL(path.join(fixturesDir, name)).href;
}

const readOptions = { allowedHosts: [''] };

test('uma saída confirma NOT_FOLLOWING', async ({ page }) => {
  await page.goto(fixtureUrl('unfollow_button.html'));
  const before = assessProfile(await readProfileSignals(page, readOptions)).relationshipState;
  expect(before).toBe('FOLLOWING');
  const after = await performUnfollow(page, readOptions);
  expect(after).toBe('NOT_FOLLOWING');
});

test('confirma quando o React substitui o botão e o conteúdo exibe falha', async ({ page }) => {
  await page.setContent(`
    <header>
      <h2 data-testid="profile-username">alvo</h2>
      <div>10 posts 20 seguidores 30 seguindo</div>
      <button id="relationship" data-testid="follow-button" data-state="REQUESTED">Solicitado</button>
      <button id="unfollow" data-testid="unfollow-button">Cancelar solicitação</button>
    </header>
    <main id="content"></main>
    <script>
      document.querySelector('#unfollow').addEventListener('click', () => {
        const old = document.querySelector('#relationship');
        const replacement = document.createElement('button');
        replacement.id = 'relationship';
        replacement.dataset.testid = 'follow-button';
        replacement.dataset.state = 'FOLLOW';
        replacement.textContent = 'Seguir';
        old.replaceWith(replacement);
        document.querySelector('#content').textContent = 'Falha no carregamento.';
      });
    </script>
  `);

  const after = await performUnfollow(page, { allowedHosts: [''] });
  expect(after).toBe('NOT_FOLLOWING');
});

test('deixa de seguir pela linha exata da janela Seguindo', async ({ page }) => {
  await page.goto(fixtureUrl('following_list.html'));
  const controller = new FollowingListUnfollowController(page, 'appassetlens');
  expect((await controller.open()).status).toBe('FOUND');
  expect((await controller.inspect('edu.brasileiro')).status).toBe('FOUND');
  expect(await controller.performUnfollow()).toBe('NOT_FOLLOWING');
  expect(await page.locator('#edu-row').count()).toBe(0);
  expect(await page.locator('#other-row').count()).toBe(1);
});

test('ausência na busca exige fallback e não clica em outra linha', async ({ page }) => {
  await page.goto(fixtureUrl('following_list.html'));
  const controller = new FollowingListUnfollowController(page, 'appassetlens');
  expect((await controller.open()).status).toBe('FOUND');
  expect((await controller.inspect('nao_existe')).status).toBe('NOT_FOUND');
  expect(await controller.performUnfollow()).toBe('UNKNOWN');
  expect(await page.locator('#edu-row').count()).toBe(1);
  expect(await page.locator('#other-row').count()).toBe(1);
});
