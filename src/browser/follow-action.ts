import type { JSHandle, Page } from 'playwright';
import { readProfileSignals } from './read-profile.js';
import type { ReadSignalsOptions } from './read-signals.js';
import { assessProfile, type ObservedRelationship } from './profile-detector.js';
import { resolvePrimaryRelationshipControl } from './profile-relationship-control.js';
import { observePositiveProfileRelationship } from './profile-network-relationship.js';

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
  readonly notClickedReason?: string;
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

async function resolvePrimaryFollowButton(
  page: Page,
  expectedUsername: string | undefined,
): Promise<RelationshipButtonHandle | null> {
  const control = await resolvePrimaryRelationshipControl(page, expectedUsername);
  if (!control || control.state !== 'FOLLOW' || !(await control.locator.isEnabled())) {
    return null;
  }
  return control.locator.elementHandle();
}

async function sameElement(
  original: RelationshipButtonHandle,
  resolved: RelationshipButtonHandle,
): Promise<boolean> {
  try {
    return await original.evaluate(
      (element, current) => element.isConnected && element === current,
      resolved,
    );
  } catch {
    return false;
  }
}

/**
 * Tolera uma substituição técnica do nó pelo React, desde que o novo controle
 * continue sendo resolvido estruturalmente como o botão principal do mesmo alvo.
 * Nenhum clique real é despachado durante esta preparação.
 */
async function preparePrimaryFollowButton(
  page: Page,
  expectedUsername: string | undefined,
): Promise<RelationshipButtonHandle | null> {
  const attempts = 2;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const candidate = await resolvePrimaryFollowButton(page, expectedUsername).catch(() => null);
    if (!candidate) {
      if (attempt < attempts) {
        await page.waitForTimeout(200);
      }
      continue;
    }
    try {
      await candidate.click({ trial: true, timeout: 4000 });
      const current = await resolvePrimaryFollowButton(page, expectedUsername).catch(() => null);
      if (current) {
        const stable = await sameElement(candidate, current);
        await current.dispose().catch(() => undefined);
        if (stable) {
          return candidate;
        }
      }
    } catch {
      // Sem evento de clique nesta fase; uma nova resolução estrutural é segura.
    }
    await candidate.dispose().catch(() => undefined);
    if (attempt < attempts) {
      await page.waitForTimeout(200);
    }
  }
  return null;
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
  const network = expectedUsername
    ? observePositiveProfileRelationship(page, expectedUsername)
    : null;
  try {
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 10_000 });
    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    await page.waitForTimeout(600);
    const visual = await waitForStableConfirmation(page, readOptions, expectedUsername, 2000);
    if (visual.relationship !== 'UNKNOWN' || visual.terminal) {
      return visual.relationship;
    }
    return (await network?.waitFor(500)) ?? 'UNKNOWN';
  } catch {
    return 'UNKNOWN';
  } finally {
    network?.dispose();
  }
}

async function clickPrimaryFollow(
  page: Page,
  expectedUsername?: string,
): Promise<ClickFollowResult> {
  const button = await preparePrimaryFollowButton(page, expectedUsername);
  if (!button) {
    return {
      clicked: false,
      notClickedReason: 'botão principal permaneceu ausente ou instável antes do clique',
    };
  }

  let clickRecord: JSHandle<FollowClickRecord> | undefined;
  try {
    clickRecord = await installFollowClickRecord(button);
  } catch {
    await button.dispose().catch(() => undefined);
    return {
      clicked: false,
      notClickedReason: 'não foi possível instalar a guarda imediatamente antes do clique',
    };
  }
  try {
    await button.click({ timeout: 4000 });
    return { clicked: true };
  } catch {
    const dispatched = await clickRecordSnapshot(clickRecord);
    // Se o contexto sumiu durante o clique, o resultado é incerto. Tratamos como
    // possível clique para que a confirmação falhe fechada e pare sem repetir.
    return dispatched === false
      ? {
          clicked: false,
          notClickedReason: 'botão principal não ficou acionável no clique final',
        }
      : { clicked: true };
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
      notClickedReason:
        click.notClickedReason ?? 'botão principal indisponível na verificação final',
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
