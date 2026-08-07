import type { Page } from 'playwright';
import {
  ALLOWED_HOSTS,
  CAPTCHA_TEXT,
  CHALLENGE_TEXT,
  CHALLENGE_URL,
  WARNING_TEXT,
  VIEWER_USERNAME_PATTERNS,
  sessionLocators,
} from '../instagram/session-locators.js';
import type { SafetyState } from '../domain/states.js';
import type { SessionSignals } from './session-detector.js';

export interface ReadSignalsOptions {
  /** Hosts aceitos como "esperados". Em testes com file:// use ['']. */
  readonly allowedHosts?: readonly string[];
}

function hostAllowed(host: string, allowed: readonly string[]): boolean {
  return allowed.some((h) => host === h || host.endsWith(`.${h}`));
}

async function count(page: Page, selector: string): Promise<number> {
  try {
    return await page.locator(selector).count();
  } catch {
    return 0;
  }
}

async function bodyText(page: Page): Promise<string> {
  try {
    return await page.locator('body').innerText();
  } catch {
    return '';
  }
}

/**
 * Extrai o username da conta ativa. Prioriza o bloco do viewer no HTML real e,
 * como reserva (fixtures de teste), o gancho `data-testid`.
 */
async function readActiveUsername(page: Page): Promise<string | null> {
  try {
    const content = await page.content();
    for (const pattern of VIEWER_USERNAME_PATTERNS) {
      const match = pattern.exec(content);
      if (match?.[1]) {
        return match[1].trim().toLowerCase();
      }
    }
  } catch {
    // ignora e tenta o fallback
  }
  try {
    if ((await page.locator(sessionLocators.activeAccount).count()) > 0) {
      const attr = await page.locator(sessionLocators.activeAccount).first().getAttribute('data-username');
      if (attr && attr.trim().length > 0) {
        return attr.trim();
      }
    }
  } catch {
    // ignora
  }
  return null;
}

/**
 * Lê sinais de sessão de uma página Playwright. É best-effort e não altera a
 * página. A classificação fica a cargo de `assessSession`.
 */
export async function readSessionSignals(
  page: Page,
  options: ReadSignalsOptions = {},
): Promise<SessionSignals> {
  const allowed = options.allowedHosts ?? ALLOWED_HOSTS;
  const url = page.url();
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    host = '';
  }

  const text = await bodyText(page);

  const usernameInputs = await count(page, sessionLocators.loginUsernameInput);
  const passwordInputs = await count(page, sessionLocators.loginPasswordInput);
  const captchaIframes = await count(page, sessionLocators.captchaIframe);

  const activeUsername = await readActiveUsername(page);

  return {
    url,
    host,
    isUnexpectedDomain: !hostAllowed(host, allowed),
    onLoginPage: usernameInputs > 0 && passwordInputs > 0,
    captchaPresent: captchaIframes > 0 || CAPTCHA_TEXT.test(text),
    challengePresent: CHALLENGE_URL.test(url) || CHALLENGE_TEXT.test(text),
    warningPresent: WARNING_TEXT.test(text),
    activeUsername,
  };
}

/**
 * Estado de segurança de uma página qualquer (ex.: publicação), considerando
 * apenas sinais de bloqueio. `SAFE` quando nenhum é detectado.
 */
export async function readPageSafety(
  page: Page,
  options: ReadSignalsOptions = {},
): Promise<SafetyState> {
  const signals = await readSessionSignals(page, options);
  if (signals.captchaPresent) {
    return 'CAPTCHA_DETECTED';
  }
  if (signals.challengePresent) {
    return 'CHALLENGE_DETECTED';
  }
  if (signals.warningPresent) {
    return 'WARNING_DETECTED';
  }
  if (signals.isUnexpectedDomain) {
    return 'UNKNOWN_INTERFACE';
  }
  return 'SAFE';
}
