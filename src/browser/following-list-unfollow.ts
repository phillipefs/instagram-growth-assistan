import type { Locator, Page } from 'playwright';
import { canonicalUsername } from '../database/util.js';
import {
  FOLLOW_BUTTON_TEXT,
  UNFOLLOW_CONFIRM_TEXT,
} from '../instagram/profile-locators.js';
import type { ObservedRelationship } from './profile-detector.js';

const FOLLOWING_DIALOG_TITLE = /^(following|seguindo)$/i;

export type FollowingListLookup =
  | { readonly status: 'FOUND'; readonly reason: string }
  | { readonly status: 'NOT_FOUND'; readonly reason: string }
  | { readonly status: 'UNKNOWN_INTERFACE'; readonly reason: string };

interface CurrentTarget {
  readonly username: string;
  readonly dialog: Locator;
  readonly row: Locator;
  readonly action: Locator;
}

function usernameText(username: string): RegExp {
  const escaped = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped}$`, 'i');
}

/**
 * Controla a janela "Seguindo" da conta ativa. A busca nunca interpreta
 * ausência como NOT_FOLLOWING: o chamador deve usar a página individual como
 * fallback. Somente uma linha com href, username e botão exatos é acionável.
 */
export class FollowingListUnfollowController {
  private dialog: Locator | null = null;
  private current: CurrentTarget | null = null;

  constructor(
    private readonly page: Page,
    private readonly accountUsername: string,
  ) {}

  invalidate(): void {
    this.dialog = null;
    this.current = null;
  }

  async open(): Promise<FollowingListLookup> {
    this.current = null;
    const account = canonicalUsername(this.accountUsername);
    const exactLink = this.page.locator(`a[href="/${account}/following/"]`);
    const fallbackLink = this.page.locator('a[href$="/following/"]');
    const labeledLink = this.page
      .locator('header a, header [role="link"]')
      .filter({ hasText: /\b(following|seguindo)\b/i });
    const link =
      (await exactLink.count()) > 0
        ? exactLink.first()
        : (await fallbackLink.count()) > 0
          ? fallbackLink.first()
          : labeledLink.first();
    if ((await link.count()) !== 1) {
      return { status: 'UNKNOWN_INTERFACE', reason: 'link Seguindo não encontrado' };
    }

    await link.click();
    const fixture = this.page.locator('[data-testid="following-dialog"]');
    const dialog =
      (await fixture.count()) > 0 ? fixture.first() : this.page.locator('[role="dialog"]').last();
    await dialog.waitFor({ state: 'visible', timeout: 8_000 }).catch(() => undefined);
    if (!(await dialog.isVisible().catch(() => false))) {
      return { status: 'UNKNOWN_INTERFACE', reason: 'janela Seguindo não abriu' };
    }
    const title = dialog.getByText(FOLLOWING_DIALOG_TITLE, { exact: true });
    const fixtureDialog = (await dialog.getAttribute('data-testid')) === 'following-dialog';
    if (!fixtureDialog && (await title.count()) === 0) {
      return { status: 'UNKNOWN_INTERFACE', reason: 'janela Seguindo não reconhecida' };
    }
    const search = dialog
      .getByRole('textbox')
      .or(dialog.locator('input[placeholder*="Search" i], input[placeholder*="Pesquisar" i]'));
    if ((await search.count()) !== 1) {
      return { status: 'UNKNOWN_INTERFACE', reason: 'busca da janela Seguindo ambígua' };
    }

    this.dialog = dialog;
    return { status: 'FOUND', reason: 'janela Seguindo reconhecida' };
  }

  async inspect(usernameInput: string): Promise<FollowingListLookup> {
    this.current = null;
    const dialog = this.dialog;
    if (!dialog || !(await dialog.isVisible().catch(() => false))) {
      return { status: 'UNKNOWN_INTERFACE', reason: 'janela Seguindo indisponível' };
    }
    const username = canonicalUsername(usernameInput);
    const search = dialog.getByRole('textbox').first();
    await search.fill(username);

    const links = dialog
      .locator(`a[href="/${username}/"]`)
      .filter({ hasText: usernameText(username) });
    const deadline = Date.now() + 6_000;
    let visibleLinks = 0;
    while (Date.now() < deadline) {
      visibleLinks = await links.count();
      if (visibleLinks > 0 && (await links.first().isVisible().catch(() => false))) break;
      await this.page.waitForTimeout(250);
    }
    if (visibleLinks === 0) {
      return { status: 'NOT_FOUND', reason: 'username não encontrado na busca de Seguindo' };
    }
    if (visibleLinks !== 1) {
      return { status: 'UNKNOWN_INTERFACE', reason: 'username duplicado na janela Seguindo' };
    }

    const row = links
      .first()
      .locator("xpath=ancestor::div[.//button or .//*[@role='button']][1]");
    if ((await row.count()) !== 1) {
      return { status: 'UNKNOWN_INTERFACE', reason: 'linha de Seguindo não reconhecida' };
    }
    const action = row.getByRole('button', { name: FOLLOW_BUTTON_TEXT.FOLLOWING });
    if ((await action.count()) !== 1 || !(await action.isVisible().catch(() => false))) {
      return { status: 'UNKNOWN_INTERFACE', reason: 'botão Seguindo da linha não é único' };
    }

    this.current = { username, dialog, row, action };
    return { status: 'FOUND', reason: 'username e botão Seguindo confirmados' };
  }

  async performUnfollow(): Promise<ObservedRelationship> {
    const target = this.current;
    this.current = null;
    if (!target) return 'UNKNOWN';

    await target.action.click();
    const confirm = this.page
      .getByRole('button', { name: UNFOLLOW_CONFIRM_TEXT })
      .or(this.page.getByRole('menuitem', { name: UNFOLLOW_CONFIRM_TEXT }));
    const confirmationDeadline = Date.now() + 4_000;
    let confirmedDirectly = false;
    while (Date.now() < confirmationDeadline) {
      if ((await confirm.count()) === 1 && (await confirm.first().isVisible().catch(() => false))) {
        await confirm.first().click();
        break;
      }
      if (!(await target.row.isVisible().catch(() => false))) {
        confirmedDirectly = true;
        break;
      }
      const stillFollowing = await target.row
        .getByRole('button', { name: FOLLOW_BUTTON_TEXT.FOLLOWING })
        .isVisible()
        .catch(() => false);
      if (!stillFollowing) {
        confirmedDirectly = true;
        break;
      }
      await this.page.waitForTimeout(200);
    }
    if (confirmedDirectly) return 'NOT_FOLLOWING';

    const resultDeadline = Date.now() + 5_000;
    while (Date.now() < resultDeadline) {
      const usernameLink = target.dialog
        .locator(`a[href="/${target.username}/"]`)
        .filter({ hasText: usernameText(target.username) });
      if ((await usernameLink.count()) === 0 || !(await target.row.isVisible().catch(() => false))) {
        return 'NOT_FOLLOWING';
      }
      const stillFollowing = await target.row
        .getByRole('button', { name: FOLLOW_BUTTON_TEXT.FOLLOWING })
        .isVisible()
        .catch(() => false);
      if (!stillFollowing) return 'NOT_FOLLOWING';
      await this.page.waitForTimeout(250);
    }
    return 'FOLLOWING';
  }
}
