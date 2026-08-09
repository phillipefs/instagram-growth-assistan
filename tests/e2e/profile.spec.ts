import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { readProfileSignals, readSettledProfileSignals } from '../../src/browser/read-profile.js';
import { assessProfile } from '../../src/browser/profile-detector.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../fixtures/profile');

function fixtureUrl(name: string): string {
  return pathToFileURL(path.join(fixturesDir, name)).href;
}

const readOptions = { allowedHosts: [''] };

test('reconhece perfil público não seguido com publicações', async ({ page }) => {
  await page.goto(fixtureUrl('public.html'));
  const assessment = assessProfile(await readProfileSignals(page, readOptions));
  expect(assessment.profileType).toBe('PUBLIC');
  expect(assessment.username).toBe('perfil_alvo');
  expect(assessment.relationshipState).toBe('NOT_FOLLOWING');
  expect(assessment.hasFollowersAccess).toBe(true);
  expect(assessment.postsVisible).toBeGreaterThan(0);
});

test('reconhece perfil privado', async ({ page }) => {
  await page.goto(fixtureUrl('private.html'));
  const assessment = assessProfile(await readProfileSignals(page, readOptions));
  expect(assessment.profileType).toBe('PRIVATE');
});

test('reconhece perfil já seguido', async ({ page }) => {
  await page.goto(fixtureUrl('following.html'));
  const assessment = assessProfile(await readProfileSignals(page, readOptions));
  expect(assessment.relationshipState).toBe('FOLLOWING');
});

test('reconhece solicitação pendente', async ({ page }) => {
  await page.goto(fixtureUrl('requested.html'));
  const assessment = assessProfile(await readProfileSignals(page, readOptions));
  expect(assessment.relationshipState).toBe('FOLLOW_REQUESTED');
});

test('reconhece perfil inexistente', async ({ page }) => {
  await page.goto(fixtureUrl('notfound.html'));
  const assessment = assessProfile(await readProfileSignals(page, readOptions));
  expect(assessment.profileType).toBe('NOT_FOUND');
});

test('aguarda renderização transitória antes de declarar interface desconhecida', async ({
  page,
}) => {
  await page.setContent(`
    <main>Carregando...</main>
    <script>
      setTimeout(() => {
        document.body.innerHTML = '<header><h2>perfil_tardio</h2><div>10 posts 100 seguidores 50 seguindo</div><button>Seguir</button></header>';
      }, 250);
    </script>
  `);
  const signals = await readSettledProfileSignals(page, readOptions, {
    attempts: 5,
    delayMs: 100,
  });
  const assessment = assessProfile(signals);
  expect(assessment.safetyState).toBe('SAFE');
  expect(assessment.username).toBe('perfil_tardio');
  expect(assessment.relationshipState).toBe('NOT_FOLLOWING');
});
