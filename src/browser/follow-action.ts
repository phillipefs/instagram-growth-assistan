import type { Page } from 'playwright';
import { profileLocators, FOLLOW_BUTTON_TEXT } from '../instagram/profile-locators.js';
import { readProfileSignals } from './read-profile.js';
import type { ReadSignalsOptions } from './read-signals.js';
import { assessProfile, type ObservedRelationship } from './profile-detector.js';

export interface PerformFollowResult {
  readonly clicked: boolean;
  readonly relationship: ObservedRelationship;
  readonly notClickedReason?: string;
}

export interface PerformFollowOptions {
  /** Username que deve estar visível no cabeçalho no momento da ação. */
  readonly expectedUsername?: string;
  /** Pausa técnica entre as duas leituras que comprovam estabilidade do DOM. */
  readonly stabilityDelayMs?: number;
}

function canonicalUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

async function mainFollowButton(page: Page) {
  const header = page.locator(profileLocators.profileHeader).first();
  if ((await header.count()) !== 1 || !(await header.isVisible())) {
    return null;
  }

  const hook = header.locator(profileLocators.followButton);
  if ((await hook.count()) === 1) {
    const button = hook.first();
    const state = await button.getAttribute('data-state');
    if (state === 'FOLLOW' && (await button.isVisible()) && (await button.isEnabled())) {
      return button;
    }
    return null;
  }

  const buttons = header.getByRole('button', { name: FOLLOW_BUTTON_TEXT.FOLLOW });
  if ((await buttons.count()) !== 1) {
    return null;
  }
  const button = buttons.first();
  return (await button.isVisible()) && (await button.isEnabled()) ? button : null;
}

async function validateFollowTarget(
  page: Page,
  readOptions: ReadSignalsOptions | undefined,
  expectedUsername: string | undefined,
): Promise<string | null> {
  const signals = await readProfileSignals(page, readOptions);
  const assessment = assessProfile(signals);
  if (assessment.safetyState !== 'SAFE') {
    return `estado de segurança ${assessment.safetyState}`;
  }
  if (!signals.usernameShown) {
    return 'username do perfil não reconhecido';
  }
  if (
    expectedUsername &&
    canonicalUsername(signals.usernameShown) !== canonicalUsername(expectedUsername)
  ) {
    return `perfil visível @${signals.usernameShown} diverge do esperado @${expectedUsername}`;
  }
  if (signals.followButtonState !== 'FOLLOW') {
    return 'botão principal Seguir ausente ou em estado diferente de FOLLOW';
  }
  if (!(await mainFollowButton(page))) {
    return 'botão principal Seguir ausente, duplicado, invisível ou desabilitado';
  }
  return null;
}

/**
 * Clica no botão principal de seguir uma única vez. Retorna falso, sem clicar,
 * quando ele não existe/está invisível/desabilitado no momento exato da ação.
 */
export async function clickFollow(page: Page): Promise<boolean> {
  const button = await mainFollowButton(page);
  if (!button) {
    return false;
  }
  // O trial reexecuta as verificações de acionabilidade sem despachar o clique.
  await button.click({ trial: true, timeout: 1500 });
  await button.click({ timeout: 1500 });
  return true;
}

/**
 * Executa no máximo um clique de seguir e retorna o relacionamento observado.
 * O botão do Instagram troca "Seguir"→"Seguindo" com um pequeno atraso (spinner);
 * por isso aguardamos a confirmação por até ~5s antes de reportar (sem reclicar).
 */
export async function performFollow(
  page: Page,
  readOptions?: ReadSignalsOptions,
  options: PerformFollowOptions = {},
): Promise<PerformFollowResult> {
  const firstFailure = await validateFollowTarget(page, readOptions, options.expectedUsername);
  if (firstFailure) {
    return { clicked: false, relationship: 'UNKNOWN', notClickedReason: firstFailure };
  }

  // Segunda leitura independente: evita clicar em um cabeçalho residual durante
  // a transição SPA entre dois perfis.
  await page.waitForTimeout(options.stabilityDelayMs ?? 400);
  const secondFailure = await validateFollowTarget(page, readOptions, options.expectedUsername);
  if (secondFailure) {
    return {
      clicked: false,
      relationship: 'UNKNOWN',
      notClickedReason: `validação instável: ${secondFailure}`,
    };
  }

  const clicked = await clickFollow(page);
  if (!clicked) {
    return {
      clicked: false,
      relationship: 'UNKNOWN',
      notClickedReason: 'botão desapareceu na verificação final antes do clique',
    };
  }
  const deadline = Date.now() + 5000;
  for (;;) {
    await page.waitForTimeout(250);
    const relationship = assessProfile(
      await readProfileSignals(page, readOptions),
    ).relationshipState;
    if (
      relationship === 'FOLLOWING' ||
      relationship === 'FOLLOW_REQUESTED' ||
      Date.now() >= deadline
    ) {
      return { clicked: true, relationship };
    }
  }
}
