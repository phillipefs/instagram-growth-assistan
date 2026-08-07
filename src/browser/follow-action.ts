import type { Page } from 'playwright';
import { profileLocators, FOLLOW_BUTTON_TEXT } from '../instagram/profile-locators.js';
import { readProfileSignals } from './read-profile.js';
import type { ReadSignalsOptions } from './read-signals.js';
import { assessProfile, type ObservedRelationship } from './profile-detector.js';

/** Clica no botão de seguir uma única vez. Não repete. */
export async function clickFollow(page: Page): Promise<void> {
  const hook = page.locator(profileLocators.followButton).first();
  if ((await hook.count()) > 0) {
    await hook.click();
    return;
  }
  await page.getByRole('button', { name: FOLLOW_BUTTON_TEXT.FOLLOW }).first().click();
}

/**
 * Executa no máximo um clique de seguir e retorna o relacionamento observado.
 * O botão do Instagram troca "Seguir"→"Seguindo" com um pequeno atraso (spinner);
 * por isso aguardamos a confirmação por até ~5s antes de reportar (sem reclicar).
 */
export async function performFollow(
  page: Page,
  readOptions?: ReadSignalsOptions,
): Promise<ObservedRelationship> {
  await clickFollow(page);
  const deadline = Date.now() + 5000;
  for (;;) {
    await page.waitForTimeout(250);
    const relationship = assessProfile(await readProfileSignals(page, readOptions)).relationshipState;
    if (relationship === 'FOLLOWING' || relationship === 'FOLLOW_REQUESTED' || Date.now() >= deadline) {
      return relationship;
    }
  }
}
