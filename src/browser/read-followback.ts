import type { Page } from 'playwright';
import { FOLLOWS_YOU_TEXT, followBackLocators } from '../instagram/followback-locators.js';

/** Lê, em modo somente leitura, se o perfil exibe o selo "segue você". */
export async function readFollowsYou(page: Page): Promise<boolean> {
  try {
    if ((await page.locator(followBackLocators.followsYouBadge).count()) > 0) {
      return true;
    }
    const text = await page.locator('body').innerText();
    return FOLLOWS_YOU_TEXT.test(text);
  } catch {
    return false;
  }
}
