import fs from 'node:fs';
import path from 'node:path';
import type { Command } from 'commander';
import { BrowserSession } from '../../browser/browser-session.js';
import { readSessionSignals } from '../../browser/read-signals.js';
import { assessSession } from '../../browser/session-detector.js';
import { readProfileSignals } from '../../browser/read-profile.js';
import { assessProfile } from '../../browser/profile-detector.js';
import { FOLLOW_BUTTON_TEXT } from '../../instagram/profile-locators.js';
import { resolveDataPaths } from '../../config/paths.js';

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function registerDebugCommands(program: Command): void {
  program
    .command('debug:capture')
    .description('Captura o HTML renderizado e um screenshot de uma página para ajustar os seletores.')
    .requiredOption('--url <url>', 'URL a capturar (ex.: perfil ou feed)')
    .option('--open-following-menu', 'clica em "Following"/"Requested" para abrir o menu antes de capturar')
    .action(async (options: { url: string; openFollowingMenu?: boolean }) => {
      const paths = resolveDataPaths();
      const capturesDir = path.join(paths.evidence, 'captures');
      fs.mkdirSync(capturesDir, { recursive: true });
      fs.mkdirSync(paths.screenshots, { recursive: true });

      const session = await BrowserSession.open({ visible: true });
      try {
        await session.goto(options.url);
        const page = session.activePage;

        if (options.openFollowingMenu) {
          const header = (await page.locator('header').count()) > 0 ? page.locator('header') : page;
          const trigger = header
            .getByRole('button', { name: FOLLOW_BUTTON_TEXT.FOLLOWING })
            .or(header.getByRole('button', { name: FOLLOW_BUTTON_TEXT.REQUESTED }));
          await trigger.first().click({ timeout: 4000 }).catch(() => undefined);
          await page.waitForTimeout(800);
        }

        const stamp = Date.now();

        const htmlPath = path.join(capturesDir, `capture-${stamp}.html`);
        fs.writeFileSync(htmlPath, await page.content(), 'utf8');

        const screenshotPath = path.join(paths.screenshots, `capture-${stamp}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => undefined);

        const sessionSignals = await readSessionSignals(page);
        const profileSignals = await readProfileSignals(page);

        write({
          finalUrl: page.url(),
          htmlPath,
          screenshotPath,
          sessionAssessment: assessSession(sessionSignals),
          profileAssessment: assessProfile(profileSignals),
          sessionSignals,
          profileSignals,
        });
      } finally {
        await session.close().catch(() => undefined);
      }
    });
}
