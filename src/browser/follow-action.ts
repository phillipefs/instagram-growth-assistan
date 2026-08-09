import type { JSHandle, Page } from 'playwright';
import { PROFILE_LOAD_ERROR_TEXT } from '../instagram/profile-locators.js';
import { readProfileSignals } from './read-profile.js';
import type { ReadSignalsOptions } from './read-signals.js';
import { assessProfile, type ObservedRelationship } from './profile-detector.js';
import { resolvePrimaryRelationshipControl } from './profile-relationship-control.js';

export interface PerformFollowResult {
  readonly clicked: boolean;
  readonly relationship: ObservedRelationship;
  readonly notClickedReason?: string;
}

export interface PerformFollowOptions {
  /** Username que deve estar visível no cabeçalho no momento da ação. */
  readonly expectedUsername?: string;
  /** Quantidade de leituras consecutivas exigidas antes do clique. */
  readonly stabilityChecks?: number;
  /** Pausa técnica entre as leituras que comprovam estabilidade do DOM. */
  readonly stabilityDelayMs?: number;
  /** Janela de confirmação do clique antes da verificação excepcional. */
  readonly confirmationTimeoutMs?: number;
}

type RelationshipButtonHandle = NonNullable<
  Awaited<ReturnType<ReturnType<Page['locator']>['elementHandle']>>
>;

interface FollowClickRecord {
  clicked: boolean;
}

interface ClickFollowResult {
  readonly clicked: boolean;
}

interface ConfirmationRead {
  readonly relationship: ObservedRelationship;
  /** Estado de segurança/identidade divergente: não tente nem uma recarga. */
  readonly terminal: boolean;
}

function canonicalUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

async function validateFollowTarget(
  page: Page,
  readOptions: ReadSignalsOptions | undefined,
  expectedUsername: string | undefined,
): Promise<string | null> {
  const visibleText = await page
    .locator('body')
    .innerText()
    .catch(() => '');
  if (PROFILE_LOAD_ERROR_TEXT.test(visibleText)) {
    return 'perfil com falha visível de carregamento';
  }
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
  const control = await resolvePrimaryRelationshipControl(page, expectedUsername);
  if (!control || control.state !== 'FOLLOW' || !(await control.locator.isEnabled())) {
    return 'botão principal Seguir ausente, duplicado, invisível ou desabilitado';
  }
  return null;
}

/**
 * Clica no botão principal de seguir uma única vez. Retorna falso, sem clicar,
 * quando ele não existe/está invisível/desabilitado no momento exato da ação.
 */
async function installFollowClickRecord(
  button: RelationshipButtonHandle,
): Promise<JSHandle<FollowClickRecord>> {
  return button.evaluateHandle((element) => {
    const record: FollowClickRecord = { clicked: false };
    element.addEventListener(
      'click',
      () => {
        record.clicked = true;
      },
      { capture: true, once: true },
    );
    return record;
  });
}

async function remainsTheSamePrimaryControl(
  page: Page,
  button: RelationshipButtonHandle,
  expectedUsername: string | undefined,
): Promise<boolean> {
  const current = await resolvePrimaryRelationshipControl(page, expectedUsername);
  if (!current || current.state !== 'FOLLOW' || !(await current.locator.isEnabled())) {
    return false;
  }
  const currentHandle = await current.locator.elementHandle();
  if (!currentHandle) {
    return false;
  }
  try {
    return await button.evaluate(
      (original, resolved) => original.isConnected && original === resolved,
      currentHandle,
    );
  } finally {
    await currentHandle.dispose().catch(() => undefined);
  }
}

async function clickRecordSnapshot(
  record: JSHandle<FollowClickRecord> | undefined,
): Promise<boolean | null> {
  if (!record) {
    return null;
  }
  return record.evaluate((value) => value.clicked).catch(() => null);
}

async function closeClickRecord(record: JSHandle<FollowClickRecord> | undefined): Promise<void> {
  if (!record) {
    return;
  }
  await record.dispose().catch(() => undefined);
}

async function readConfirmation(
  page: Page,
  readOptions: ReadSignalsOptions | undefined,
  expectedUsername: string | undefined,
): Promise<ConfirmationRead> {
  try {
    const visibleText = await page
      .locator('body')
      .innerText()
      .catch(() => '');
    const signals = await readProfileSignals(page, readOptions);
    const assessment = assessProfile(signals);
    if (assessment.safetyState !== 'SAFE') {
      return { relationship: 'UNKNOWN', terminal: true };
    }
    if (
      expectedUsername &&
      (!signals.usernameShown ||
        canonicalUsername(signals.usernameShown) !== canonicalUsername(expectedUsername))
    ) {
      return { relationship: 'UNKNOWN', terminal: true };
    }
    if (PROFILE_LOAD_ERROR_TEXT.test(visibleText)) {
      return { relationship: 'UNKNOWN', terminal: false };
    }
    const relationship = assessment.relationshipState;
    return {
      relationship:
        relationship === 'FOLLOWING' || relationship === 'FOLLOW_REQUESTED'
          ? relationship
          : 'UNKNOWN',
      terminal: false,
    };
  } catch {
    return { relationship: 'UNKNOWN', terminal: false };
  }
}

async function waitForStableConfirmation(
  page: Page,
  readOptions: ReadSignalsOptions | undefined,
  expectedUsername: string | undefined,
  timeoutMs: number,
): Promise<ConfirmationRead> {
  const deadline = Date.now() + Math.max(0, timeoutMs);
  let previous: ObservedRelationship = 'UNKNOWN';
  let consecutive = 0;
  for (;;) {
    await page.waitForTimeout(150);
    const current = await readConfirmation(page, readOptions, expectedUsername);
    if (current.terminal) {
      return current;
    }
    if (current.relationship === 'FOLLOWING' || current.relationship === 'FOLLOW_REQUESTED') {
      consecutive = current.relationship === previous ? consecutive + 1 : 1;
      previous = current.relationship;
      if (consecutive >= 2) {
        return current;
      }
    } else {
      previous = 'UNKNOWN';
      consecutive = 0;
    }
    if (Date.now() >= deadline) {
      return { relationship: 'UNKNOWN', terminal: false };
    }
  }
}

async function confirmAfterReadOnlyReload(
  page: Page,
  readOptions: ReadSignalsOptions | undefined,
  expectedUsername: string | undefined,
): Promise<ObservedRelationship> {
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    return (await waitForStableConfirmation(page, readOptions, expectedUsername, 2000))
      .relationship;
  } catch {
    return 'UNKNOWN';
  }
}

async function clickPrimaryFollow(
  page: Page,
  expectedUsername?: string,
): Promise<ClickFollowResult> {
  let button: RelationshipButtonHandle | null = null;
  try {
    const control = await resolvePrimaryRelationshipControl(page, expectedUsername);
    if (!control || control.state !== 'FOLLOW' || !(await control.locator.isEnabled())) {
      return { clicked: false };
    }
    // Fixa o mesmo nó: um Locator poderia ser resolvido novamente para um card de
    // sugestão se o React alterasse o header entre o trial e o clique real.
    button = await control.locator.elementHandle();
    if (!button) {
      return { clicked: false };
    }
    // O trial reexecuta as verificações de acionabilidade sem despachar o clique.
    // Qualquer detach/instabilidade nesta fase é seguro para virar SKIP.
    await button.click({ trial: true, timeout: 1500 });
    if (!(await remainsTheSamePrimaryControl(page, button, expectedUsername))) {
      await button.dispose().catch(() => undefined);
      return { clicked: false };
    }
  } catch {
    await button?.dispose().catch(() => undefined);
    return { clicked: false };
  }

  let clickRecord: JSHandle<FollowClickRecord> | undefined;
  try {
    clickRecord = await installFollowClickRecord(button);
  } catch {
    await button.dispose().catch(() => undefined);
    return { clicked: false };
  }
  try {
    await button.click({ timeout: 1500 });
    return { clicked: true };
  } catch {
    const dispatched = await clickRecordSnapshot(clickRecord);
    // Se o contexto sumiu durante o clique, o resultado é incerto. Tratamos como
    // possível clique para que a confirmação falhe fechada e pare sem repetir.
    return { clicked: dispatched !== false };
  } finally {
    await closeClickRecord(clickRecord);
    await button.dispose().catch(() => undefined);
  }
}

/**
 * Compatibilidade da API pública: executa no máximo um clique e informa apenas
 * se o evento foi ou pode ter sido despachado. A confirmação do relacionamento
 * fica a cargo de `performFollow`.
 */
export async function clickFollow(page: Page, expectedUsername?: string): Promise<boolean> {
  const result = await clickPrimaryFollow(page, expectedUsername);
  return result.clicked;
}

/**
 * Executa no máximo um clique de seguir e retorna o relacionamento observado.
 * O botão do Instagram troca "Seguir"→"Seguindo" com um pequeno atraso (spinner);
 * por isso aguardamos a confirmação por até 5s antes da verificação excepcional
 * (sem reclicar em nenhuma hipótese).
 */
export async function performFollow(
  page: Page,
  readOptions?: ReadSignalsOptions,
  options: PerformFollowOptions = {},
): Promise<PerformFollowResult> {
  const checks = Math.max(2, Math.floor(options.stabilityChecks ?? 2));
  const delayMs = Math.max(0, Math.floor(options.stabilityDelayMs ?? 200));
  for (let check = 1; check <= checks; check += 1) {
    const failure = await validateFollowTarget(page, readOptions, options.expectedUsername);
    if (failure) {
      return {
        clicked: false,
        relationship: 'UNKNOWN',
        notClickedReason:
          check === 1 ? failure : `validação instável na leitura ${check}/${checks}: ${failure}`,
      };
    }
    if (check < checks) {
      await page.waitForTimeout(delayMs);
    }
  }

  const click = await clickPrimaryFollow(page, options.expectedUsername);
  if (!click.clicked) {
    return {
      clicked: false,
      relationship: 'UNKNOWN',
      notClickedReason: 'botão desapareceu na verificação final antes do clique',
    };
  }
  const confirmation = await waitForStableConfirmation(
    page,
    readOptions,
    options.expectedUsername,
    options.confirmationTimeoutMs ?? 5000,
  );
  if (confirmation.relationship !== 'UNKNOWN') {
    return { clicked: true, relationship: confirmation.relationship };
  }
  if (confirmation.terminal) {
    return { clicked: true, relationship: 'UNKNOWN' };
  }

  // Exceção, não caminho normal: depois de um clique despachado cujo DOM
  // quebrou, faz uma única recarga somente leitura. Nunca repete a ação.
  const reloadedRelationship = await confirmAfterReadOnlyReload(
    page,
    readOptions,
    options.expectedUsername,
  );
  return { clicked: true, relationship: reloadedRelationship };
}
