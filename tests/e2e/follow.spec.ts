import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { performFollow } from '../../src/browser/follow-action.js';
import { readProfileSignals } from '../../src/browser/read-profile.js';
import { assessProfile } from '../../src/browser/profile-detector.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../fixtures/follow');

function fixtureUrl(name: string): string {
  return pathToFileURL(path.join(fixturesDir, name)).href;
}

const readOptions = { allowedHosts: [''] };

test('um clique de seguir confirma FOLLOWING', async ({ page }) => {
  await page.goto(fixtureUrl('follow_button.html'));
  const before = assessProfile(await readProfileSignals(page, readOptions)).relationshipState;
  expect(before).toBe('NOT_FOLLOWING');
  const after = await performFollow(page, readOptions);
  expect(after).toEqual({ clicked: true, relationship: 'FOLLOWING' });
});

test('conta privada resulta em solicitação enviada', async ({ page }) => {
  await page.goto(fixtureUrl('follow_request.html'));
  const after = await performFollow(page, readOptions);
  expect(after).toEqual({ clicked: true, relationship: 'FOLLOW_REQUESTED' });
});

test('não usa botão Seguir de sugestão quando o perfil não tem botão principal', async ({
  page,
}) => {
  await page.setContent(`
    <header><h2>alvo_sem_botao</h2><span>100 seguidores</span></header>
    <main>
      <button onclick="this.dataset.clicked='true'">Seguir</button>
    </main>
  `);
  const before = assessProfile(await readProfileSignals(page, readOptions)).relationshipState;
  expect(before).toBe('UNKNOWN');
  const after = await performFollow(page, readOptions);
  expect(after.clicked).toBe(false);
  expect(after.relationship).toBe('UNKNOWN');
  await expect(page.locator('main button')).not.toHaveAttribute('data-clicked', 'true');
});

test('não clica quando o cabeçalho pertence a outro username', async ({ page }) => {
  await page.goto(fixtureUrl('follow_button.html'));
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'outro_perfil',
    stabilityDelayMs: 10,
  });
  expect(result.clicked).toBe(false);
  expect(result.notClickedReason).toMatch(/diverge do esperado/);
  await expect(page.getByTestId('follow-button')).toHaveAttribute('data-state', 'FOLLOW');
});

test('não clica quando o botão desaparece entre as duas leituras', async ({ page }) => {
  await page.goto(fixtureUrl('follow_button.html'));
  await page.evaluate(
    `setTimeout(() => document.querySelector('[data-testid="follow-button"]')?.remove(), 500)`,
  );
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo',
    stabilityDelayMs: 1000,
  });
  expect(result.clicked).toBe(false);
  expect(result.notClickedReason).toMatch(/validação instável/);
});

test('não clica quando o perfil exibe falha de carregamento', async ({ page }) => {
  await page.goto(fixtureUrl('follow_button.html'));
  await page
    .getByRole('main')
    .getByRole('link')
    .evaluate((element) => {
      element.textContent = 'Falha no carregamento.';
    });
  const result = await performFollow(page, readOptions, {
    expectedUsername: 'alvo',
    stabilityDelayMs: 10,
  });
  expect(result.clicked).toBe(false);
  expect(result.notClickedReason).toMatch(/falha visível de carregamento/);
  await expect(page.getByTestId('follow-button')).toHaveAttribute('data-state', 'FOLLOW');
});
