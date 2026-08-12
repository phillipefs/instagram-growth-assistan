import type { Page, Locator } from 'playwright';
import { FOLLOW_BUTTON_TEXT, UNFOLLOW_CONFIRM_TEXT } from '../instagram/profile-locators.js';
import { readProfileSignals } from './read-profile.js';
import type { ReadSignalsOptions } from './read-signals.js';
import { assessProfile, type ObservedRelationship } from './profile-detector.js';

async function headerScope(page: Page): Promise<Page | Locator> {
  return (await page.locator('header').count()) > 0 ? page.locator('header') : page;
}

/**
 * Abre o menu do botão "Following"/"Requested" e confirma a saída (unfollow ou
 * cancelamento de solicitação). Uma única sequência, sem repetição automática.
 */
export async function clickUnfollow(page: Page): Promise<void> {
  const hook = page.locator('[data-testid="unfollow-button"]');
  if ((await hook.count()) > 0) {
    await hook.first().click();
    return;
  }
  const scope = await headerScope(page);
  // 1) Abre o menu clicando no botão de estado atual (no header do perfil).
  const trigger = scope
    .getByRole('button', { name: FOLLOW_BUTTON_TEXT.FOLLOWING })
    .or(scope.getByRole('button', { name: FOLLOW_BUTTON_TEXT.REQUESTED }));
  await trigger.first().click();
  await page.waitForTimeout(400);
  // 2) Confirma no menu/diálogo (renderizado na raiz da página, fora do header).
  const confirm = page
    .getByRole('button', { name: UNFOLLOW_CONFIRM_TEXT })
    .or(page.getByRole('menuitem', { name: UNFOLLOW_CONFIRM_TEXT }));
  await confirm
    .first()
    .click({ timeout: 4000 })
    .catch(() => undefined);
}

/**
 * Executa no máximo uma saída e retorna o relacionamento observado. A confirmação
 * (deixar de mostrar "Following") tem um pequeno atraso; aguardamos por até ~5s
 * até `NOT_FOLLOWING` (sem reclicar).
 */
export async function performUnfollow(
  page: Page,
  readOptions?: ReadSignalsOptions,
): Promise<ObservedRelationship> {
  await clickUnfollow(page);
  const deadline = Date.now() + 5000;
  let lastRelationship: ObservedRelationship;
  for (;;) {
    await page.waitForTimeout(250);
    try {
      const assessment = assessProfile(await readProfileSignals(page, readOptions));
      if (assessment.safetyState !== 'SAFE') {
        return 'UNKNOWN';
      }
      lastRelationship = assessment.relationshipState;
      if (lastRelationship === 'NOT_FOLLOWING') {
        return lastRelationship;
      }
    } catch {
      // O nó pode ser substituído pelo React durante a leitura. Não reclica:
      // aguarda e resolve novamente o controle a partir do DOM atual.
      lastRelationship = 'UNKNOWN';
    }
    if (Date.now() >= deadline) {
      break;
    }
  }

  // Exceção somente leitura: uma recarga pode confirmar o estado quando o DOM
  // do perfil falhou após o clique. Nunca repete a ação externa.
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const assessment = assessProfile(await readProfileSignals(page, readOptions));
    return assessment.safetyState === 'SAFE' ? assessment.relationshipState : 'UNKNOWN';
  } catch {
    return lastRelationship;
  }
}
