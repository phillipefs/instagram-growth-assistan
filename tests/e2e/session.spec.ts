import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { readSessionSignals } from '../../src/browser/read-signals.js';
import { assessSession } from '../../src/browser/session-detector.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const fixturesDir = path.resolve(here, '../fixtures/session');

function fixtureUrl(name: string): string {
  return pathToFileURL(path.join(fixturesDir, name)).href;
}

// Fixtures locais carregadas via file://; nenhum acesso a contas reais.
const readOptions = { allowedHosts: [''] };

test('reconhece sessão autenticada', async ({ page }) => {
  await page.goto(fixtureUrl('authenticated.html'));
  const assessment = assessSession(await readSessionSignals(page, readOptions));
  expect(assessment.sessionStatus).toBe('authenticated');
  expect(assessment.activeAccount).toBe('minha_conta');
  expect(assessment.safetyState).toBe('SAFE');
});

test('reconhece página de login como não autenticada', async ({ page }) => {
  await page.goto(fixtureUrl('login.html'));
  const assessment = assessSession(await readSessionSignals(page, readOptions));
  expect(assessment.sessionStatus).toBe('unauthenticated');
  expect(assessment.safetyState).toBe('SAFE');
});

test('detecta CAPTCHA', async ({ page }) => {
  await page.goto(fixtureUrl('captcha.html'));
  const assessment = assessSession(await readSessionSignals(page, readOptions));
  expect(assessment.safetyState).toBe('CAPTCHA_DETECTED');
});

test('detecta desafio/checkpoint', async ({ page }) => {
  await page.goto(fixtureUrl('challenge.html'));
  const assessment = assessSession(await readSessionSignals(page, readOptions));
  expect(assessment.safetyState).toBe('CHALLENGE_DETECTED');
});

test('detecta aviso de atividade', async ({ page }) => {
  await page.goto(fixtureUrl('warning.html'));
  const assessment = assessSession(await readSessionSignals(page, readOptions));
  expect(assessment.safetyState).toBe('WARNING_DETECTED');
});

test('falha fechada em layout desconhecido', async ({ page }) => {
  await page.goto(fixtureUrl('unknown.html'));
  const assessment = assessSession(await readSessionSignals(page, readOptions));
  expect(assessment.sessionStatus).toBe('unknown');
  expect(assessment.safetyState).toBe('UNKNOWN_INTERFACE');
});
