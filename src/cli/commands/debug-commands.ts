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
import { readPostLikers, type LikersResult } from '../../browser/read-posts.js';
import {
  readFollowersList,
  type FollowersListSnapshot,
} from '../../browser/read-followers-list.js';
import { extractUsernameFromHref } from '../../domain/username.js';

function write(payload: unknown): void {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

export function registerDebugCommands(program: Command): void {
  program
    .command('debug:capture')
    .description(
      'Captura o HTML renderizado e um screenshot de uma página para ajustar os seletores.',
    )
    .requiredOption('--url <url>', 'URL a capturar (ex.: perfil ou feed)')
    .option(
      '--open-following-menu',
      'clica em "Following"/"Requested" para abrir o menu antes de capturar',
    )
    .option('--open-likers', 'abre a área de curtidores antes de capturar')
    .option('--likers-limit <n>', 'limite de curtidores usado com --open-likers', '1')
    .option('--load-followers <account>', 'carrega a lista de seguidores antes de capturar')
    .option('--settle-ms <n>', 'espera técnica adicional antes da captura', '800')
    .action(
      async (options: {
        url: string;
        openFollowingMenu?: boolean;
        openLikers?: boolean;
        likersLimit: string;
        loadFollowers?: string;
        settleMs: string;
      }) => {
        const paths = resolveDataPaths();
        const capturesDir = path.join(paths.evidence, 'captures');
        fs.mkdirSync(capturesDir, { recursive: true });
        fs.mkdirSync(paths.screenshots, { recursive: true });

        const session = await BrowserSession.open({ visible: true });
        try {
          await session.goto(options.url);
          const page = session.activePage;
          let likersResult: LikersResult | null = null;
          let likerScrollDiagnostics: unknown = null;
          let followersResult: Omit<FollowersListSnapshot, 'usernames'> | null = null;
          let followersLoadedAfterWait: number | null = null;

          if (options.openFollowingMenu) {
            const header =
              (await page.locator('header').count()) > 0 ? page.locator('header') : page;
            const trigger = header
              .getByRole('button', { name: FOLLOW_BUTTON_TEXT.FOLLOWING })
              .or(header.getByRole('button', { name: FOLLOW_BUTTON_TEXT.REQUESTED }));
            await trigger
              .first()
              .click({ timeout: 4000 })
              .catch(() => undefined);
          }

          if (options.openLikers) {
            const likersLimit = Number.parseInt(options.likersLimit, 10);
            likersResult = await readPostLikers(
              page,
              Number.isFinite(likersLimit) && likersLimit > 0 ? likersLimit : 1,
            );
          }

          if (options.loadFollowers) {
            const profileBeforeDialog = assessProfile(await readProfileSignals(page));
            const snapshot = await readFollowersList(
              page,
              options.loadFollowers,
              profileBeforeDialog.followersCount,
            );
            followersResult = {
              complete: snapshot.complete,
              expectedCount: snapshot.expectedCount,
              loadedCount: snapshot.loadedCount,
              reason: snapshot.reason,
            };
          }

          const settleMs = Number.parseInt(options.settleMs, 10);
          await page.waitForTimeout(Number.isFinite(settleMs) && settleMs >= 0 ? settleMs : 800);
          if (followersResult) {
            const dialogs = page.locator('[data-testid="followers-dialog"], [role="dialog"]');
            const dialog = dialogs.last();
            const hrefs =
              (await dialog.count()) > 0
                ? await dialog
                    .locator('a[href]')
                    .evaluateAll((anchors) =>
                      anchors.map((anchor) => anchor.getAttribute('href') ?? ''),
                    )
                : [];
            followersLoadedAfterWait = new Set(
              hrefs.map(extractUsernameFromHref).filter((username) => username !== null),
            ).size;
          }
          if (likersResult) {
            const dialogs = page.locator('[data-testid="likers-dialog"], [role="dialog"]');
            const dialog = dialogs.last();
            if ((await dialog.count()) > 0) {
              likerScrollDiagnostics = await dialog.evaluate((root) => {
                const getComputedStyle = Reflect.get(globalThis, 'getComputedStyle');
                return [root, ...root.querySelectorAll('div, ul')]
                  .map((element) => {
                    const scrollTop = Number(Reflect.get(element, 'scrollTop') ?? 0);
                    const scrollHeight = Number(Reflect.get(element, 'scrollHeight') ?? 0);
                    const clientHeight = Number(Reflect.get(element, 'clientHeight') ?? 0);
                    const style = Reflect.apply(getComputedStyle, globalThis, [element]) as Record<
                      string,
                      unknown
                    >;
                    return {
                      scrollTop,
                      scrollHeight,
                      clientHeight,
                      remaining: Math.max(0, scrollHeight - clientHeight - scrollTop),
                      overflowY: String(Reflect.get(style, 'overflowY') ?? ''),
                    };
                  })
                  .filter((item) => item.scrollHeight > item.clientHeight + 2)
                  .sort(
                    (left, right) =>
                      right.scrollHeight -
                      right.clientHeight -
                      (left.scrollHeight - left.clientHeight),
                  )
                  .slice(0, 5);
              });
            }
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
            ...(likersResult ? { likersResult } : {}),
            ...(likerScrollDiagnostics ? { likerScrollDiagnostics } : {}),
            ...(followersResult ? { followersResult } : {}),
            ...(followersLoadedAfterWait !== null ? { followersLoadedAfterWait } : {}),
            sessionAssessment: assessSession(sessionSignals),
            profileAssessment: assessProfile(profileSignals),
            sessionSignals,
            profileSignals,
          });
        } finally {
          await session.close().catch(() => undefined);
        }
      },
    );
}
