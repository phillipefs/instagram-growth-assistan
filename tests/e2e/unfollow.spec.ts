import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { test, expect } from '@playwright/test';
import { performUnfollow } from '../../src/browser/unfollow-action.js';
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
