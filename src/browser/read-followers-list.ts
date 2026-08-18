import type { Locator, Page } from 'playwright';
import { canonicalUsername } from '../database/util.js';
import { FOLLOWERS_DIALOG_TITLE, followersLocators } from '../instagram/followers-locators.js';

export interface FollowersListSnapshot {
  readonly complete: boolean;
  readonly expectedCount: number | null;
  readonly loadedCount: number;
  readonly usernames: ReadonlySet<string>;
  readonly reason: string;
}

interface ScrollState {
  readonly foundScroller: boolean;
  readonly before: number;
  readonly after: number;
  readonly scrollHeight: number;
  readonly clientHeight: number;
}

const BASE_SCROLL_SETTLE_MS = 350;
const STALLED_LOADING_WAIT_MS = 6_000;
const STALLED_LOADING_POLL_MS = 500;
const STALLED_PASSES_BEFORE_RECOVERY = 4;

function usernameFromHref(href: string | null): string | null {
  if (!href) return null;
  let pathname: string;
  try {
    pathname = new URL(href, 'https://www.instagram.com/').pathname;
  } catch {
    return null;
  }
  const match = pathname.match(/^\/([A-Za-z0-9._]+)\/$/);
  return match?.[1] ? canonicalUsername(match[1]) : null;
}

async function collectFollowerUsernames(dialog: Locator): Promise<string[]> {
  return dialog.evaluate((root) => {
    const unique: string[] = [];
    const seen: Record<string, boolean> = {};
    for (const anchor of root.querySelectorAll('a[href]')) {
      const href = anchor.getAttribute('href') ?? '';
      if (!seen[href]) {
        seen[href] = true;
        unique.push(href);
      }
    }
    return unique;
  });
}

async function absorbFollowerUsernames(
  dialog: Locator,
  usernames: Set<string>,
): Promise<boolean> {
  const before = usernames.size;
  for (const href of await collectFollowerUsernames(dialog)) {
    const username = usernameFromHref(href);
    if (username) usernames.add(username);
  }
  return usernames.size > before;
}

async function readFollowerListScroll(dialog: Locator): Promise<ScrollState> {
  return dialog.evaluate((root, explicitSelector) => {
    const explicit = root.querySelector(explicitSelector);
    let scroller: typeof explicit = null;
    let largestOverflow = 2;
    if (explicit) {
      const height = Number(Reflect.get(explicit, 'scrollHeight') ?? 0);
      const visible = Number(Reflect.get(explicit, 'clientHeight') ?? 0);
      if (height > visible + 2) {
        scroller = explicit;
      }
    } else {
      const candidates = [root, ...root.querySelectorAll('div')];
      for (const element of candidates) {
        const height = Number(Reflect.get(element, 'scrollHeight') ?? 0);
        const visible = Number(Reflect.get(element, 'clientHeight') ?? 0);
        const overflow = height - visible;
        if (overflow > largestOverflow) {
          largestOverflow = overflow;
          scroller = element;
        }
      }
    }
    if (!scroller) {
      return { foundScroller: false, before: 0, after: 0, scrollHeight: 0, clientHeight: 0 };
    }
    const position = Number(Reflect.get(scroller, 'scrollTop') ?? 0);
    return {
      foundScroller: true,
      before: position,
      after: position,
      scrollHeight: Number(Reflect.get(scroller, 'scrollHeight') ?? 0),
      clientHeight: Number(Reflect.get(scroller, 'clientHeight') ?? 0),
    };
  }, followersLocators.scrollContainer);
}

async function advanceFollowerList(dialog: Locator): Promise<ScrollState> {
  return dialog.evaluate((root, explicitSelector) => {
    const explicit = root.querySelector(explicitSelector);
    let scroller: typeof explicit = null;
    let largestOverflow = 2;
    if (explicit) {
      const height = Number(Reflect.get(explicit, 'scrollHeight') ?? 0);
      const visible = Number(Reflect.get(explicit, 'clientHeight') ?? 0);
      if (height > visible + 2) {
        scroller = explicit;
      }
    } else {
      const candidates = [root, ...root.querySelectorAll('div')];
      for (const element of candidates) {
        const height = Number(Reflect.get(element, 'scrollHeight') ?? 0);
        const visible = Number(Reflect.get(element, 'clientHeight') ?? 0);
        const overflow = height - visible;
        if (overflow > largestOverflow) {
          largestOverflow = overflow;
          scroller = element;
        }
      }
    }
    if (!scroller) {
      return { foundScroller: false, before: 0, after: 0, scrollHeight: 0, clientHeight: 0 };
    }
    const before = Number(Reflect.get(scroller, 'scrollTop') ?? 0);
    const height = Number(Reflect.get(scroller, 'scrollHeight') ?? 0);
    const visible = Number(Reflect.get(scroller, 'clientHeight') ?? 0);
    const step = Math.max(Math.floor(visible * 0.8), 250);
    const scrollBy = Reflect.get(scroller, 'scrollBy');
    if (typeof scrollBy === 'function') {
      Reflect.apply(scrollBy, scroller, [{ top: step, left: 0, behavior: 'instant' }]);
    } else {
      Reflect.set(scroller, 'scrollTop', Math.min(before + step, height));
    }
    const event = new Event('scroll', { bubbles: true });
    scroller.dispatchEvent(event);
    return {
      foundScroller: true,
      before,
      after: Number(Reflect.get(scroller, 'scrollTop') ?? 0),
      scrollHeight: height,
      clientHeight: visible,
    };
  }, followersLocators.scrollContainer);
}

async function recoverFollowerListLoading(
  page: Page,
  dialog: Locator,
  usernames: Set<string>,
  loadedBeforeRecovery: number,
  scrollHeightBeforeRecovery: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < STALLED_LOADING_WAIT_MS) {
    await page.waitForTimeout(STALLED_LOADING_POLL_MS);
    const grew = await absorbFollowerUsernames(dialog, usernames);
    const scroll = await readFollowerListScroll(dialog);
    if (grew || usernames.size > loadedBeforeRecovery) return true;
    if (scroll.foundScroller && scroll.scrollHeight > scrollHeightBeforeRecovery) return true;
    if (scroll.foundScroller) {
      await advanceFollowerList(dialog);
    }
  }
  return false;
}

/**
 * Abre a lista de seguidores da conta ativa e carrega usernames por rolagem.
 * Um resultado negativo só é conclusivo quando a quantidade carregada alcança
 * o contador exato observado no cabeçalho do perfil.
 */
export async function readFollowersList(
  page: Page,
  accountUsername: string,
  expectedCount: number | null,
): Promise<FollowersListSnapshot> {
  const usernames = new Set<string>();
  const account = canonicalUsername(accountUsername);
  try {
    const exactLink = page.locator(`a[href="/${account}/followers/"]`);
    const fallbackLink = page.locator('a[href$="/followers/"]');
    const labeledLink = page
      .locator('header a, header [role="link"]')
      .filter({ hasText: /\b(followers|seguidores)\b/i });
    const link =
      (await exactLink.count()) > 0
        ? exactLink.first()
        : (await fallbackLink.count()) > 0
          ? fallbackLink.first()
          : labeledLink.first();
    if ((await link.count()) === 0) {
      return {
        complete: false,
        expectedCount,
        loadedCount: 0,
        usernames,
        reason: 'link de seguidores não encontrado',
      };
    }
    await link.click();

    const dialogs = page.locator(followersLocators.dialog);
    await dialogs.last().waitFor({ state: 'visible', timeout: 8_000 });
    const dialog = dialogs.last();
    const titleLocator = dialog.getByText(FOLLOWERS_DIALOG_TITLE, { exact: true }).first();
    const title = ((await titleLocator.textContent().catch(() => '')) ?? '').trim();
    const fixtureDialog = (await dialog.getAttribute('data-testid')) === 'followers-dialog';
    if (!fixtureDialog && !FOLLOWERS_DIALOG_TITLE.test(title)) {
      return {
        complete: false,
        expectedCount,
        loadedCount: 0,
        usernames,
        reason: `diálogo de seguidores não reconhecido (${title || 'sem título'})`,
      };
    }
    if (expectedCount === null) {
      return {
        complete: false,
        expectedCount,
        loadedCount: 0,
        usernames,
        reason: 'contador exato de seguidores indisponível',
      };
    }
    if (expectedCount > 0) {
      await dialog.locator('a[href]').first().waitFor({ state: 'visible', timeout: 8_000 });
    }

    const maxPasses = Math.min(2_000, Math.max(60, Math.ceil(expectedCount / 2) + 80));
    let stalledPasses = 0;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      await absorbFollowerUsernames(dialog, usernames);
      if (usernames.size >= expectedCount) {
        return {
          complete: true,
          expectedCount,
          loadedCount: usernames.size,
          usernames,
          reason: 'lista completa carregada',
        };
      }

      const loadedBeforeScroll = usernames.size;
      const scrollBefore = await readFollowerListScroll(dialog);
      const scroll = await advanceFollowerList(dialog);
      if (!scroll.foundScroller) break;
      await page.waitForTimeout(BASE_SCROLL_SETTLE_MS);
      const grewAfterScroll = await absorbFollowerUsernames(dialog, usernames);
      if (usernames.size >= expectedCount) {
        return {
          complete: true,
          expectedCount,
          loadedCount: usernames.size,
          usernames,
          reason: 'lista completa carregada',
        };
      }
      const scrollAfter = await readFollowerListScroll(dialog);
      const progressed =
        scroll.after > scroll.before ||
        grewAfterScroll ||
        usernames.size > loadedBeforeScroll ||
        scrollAfter.scrollHeight > scrollBefore.scrollHeight;
      stalledPasses = progressed ? 0 : stalledPasses + 1;
      if (stalledPasses >= STALLED_PASSES_BEFORE_RECOVERY) {
        const recovered = await recoverFollowerListLoading(
          page,
          dialog,
          usernames,
          loadedBeforeScroll,
          scrollBefore.scrollHeight,
        );
        if (!recovered) break;
        stalledPasses = 0;
      }
    }

    return {
      complete: false,
      expectedCount,
      loadedCount: usernames.size,
      usernames,
      reason: `lista incompleta (${usernames.size}/${expectedCount})`,
    };
  } catch (error) {
    return {
      complete: false,
      expectedCount,
      loadedCount: usernames.size,
      usernames,
      reason: `falha ao ler seguidores: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
