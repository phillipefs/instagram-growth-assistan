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
  expect(after).toBe('FOLLOWING');
});

test('conta privada resulta em solicitação enviada', async ({ page }) => {
  await page.goto(fixtureUrl('follow_request.html'));
  const after = await performFollow(page, readOptions);
  expect(after).toBe('FOLLOW_REQUESTED');
});
