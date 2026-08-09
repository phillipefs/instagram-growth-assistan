import type { Page } from 'playwright';
import {
  ALLOWED_HOSTS,
  CAPTCHA_TEXT,
  CHALLENGE_TEXT,
  CHALLENGE_URL,
  WARNING_TEXT,
  sessionLocators,
} from '../instagram/session-locators.js';
import {
  FOLLOW_BUTTON_TEXT,
  PROFILE_NOT_FOUND_TEXT,
  PROFILE_PRIVATE_TEXT,
  profileLocators,
} from '../instagram/profile-locators.js';
import type { FollowButtonState, ProfileSignals } from './profile-detector.js';
import type { ReadSignalsOptions } from './read-signals.js';
import { extractProfileCounts } from '../domain/profile-counts.js';

// FOLLOWING/REQUESTED antes de FOLLOW: após seguir, o IG mostra sugestões com
// botões "Follow"; checar o estado seguido primeiro evita falso NOT_FOLLOWING.
const FOLLOW_STATES: readonly FollowButtonState[] = ['FOLLOWING', 'REQUESTED', 'FOLLOW'];

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

async function headerText(page: Page): Promise<string> {
  try {
    const header = page.locator('header');
    if ((await header.count()) > 0) {
      return await header.first().innerText();
    }
  } catch {
    // Ignora e cai para o texto do corpo.
  }
  return '';
}

function isFollowState(value: string | null): value is FollowButtonState {
  return value !== null && (FOLLOW_STATES as readonly string[]).includes(value);
}

async function readFollowButtonState(page: Page): Promise<FollowButtonState | null> {
  const hook = page.locator(profileLocators.followButton);
  if ((await hook.count()) > 0) {
    const attr = await hook.first().getAttribute('data-state');
    if (isFollowState(attr)) {
      return attr;
    }
  }
  // Nunca cai para a página inteira: botões "Follow" de sugestões não podem
  // representar o relacionamento com o perfil aberto.
  const scope = page.locator(profileLocators.profileHeader).first();
  if ((await scope.count()) === 0) {
    return null;
  }
  for (const state of FOLLOW_STATES) {
    if ((await scope.getByRole('button', { name: FOLLOW_BUTTON_TEXT[state] }).count()) > 0) {
      return state;
    }
  }
  return null;
}

async function readUsername(page: Page): Promise<string | null> {
  const locator = page.locator(profileLocators.username).first();
  if ((await locator.count()) === 0) {
    return null;
  }
  const text = (await locator.textContent())?.trim();
  return text && text.length > 0 ? text.replace(/^@/, '') : null;
}

/**
 * Lê sinais de reconhecimento de um perfil. Best-effort e somente leitura.
 */
export async function readProfileSignals(
  page: Page,
  options: ReadSignalsOptions = {},
): Promise<ProfileSignals> {
  const allowed = options.allowedHosts ?? ALLOWED_HOSTS;
  const url = page.url();
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    host = '';
  }

  const text = await bodyText(page);
  const captchaIframes = await count(page, sessionLocators.captchaIframe);
  // Contadores lidos do cabeçalho (mais confiável que a página inteira, que tem
  // "followers" em sugestões); cai para o corpo se não houver header.
  const counts = extractProfileCounts((await headerText(page)) || text);

  return {
    url,
    host,
    isUnexpectedDomain: !hostAllowed(host, allowed),
    captchaPresent: captchaIframes > 0 || CAPTCHA_TEXT.test(text),
    challengePresent: CHALLENGE_URL.test(url) || CHALLENGE_TEXT.test(text),
    warningPresent: WARNING_TEXT.test(text),
    notFound: PROFILE_NOT_FOUND_TEXT.test(text),
    isPrivate: PROFILE_PRIVATE_TEXT.test(text),
    usernameShown: await readUsername(page),
    followButtonState: await readFollowButtonState(page),
    hasFollowersAccess: (await count(page, profileLocators.followersLink)) > 0,
    postsVisible: await count(page, profileLocators.postLink),
    postsCount: counts.posts,
    followersCount: counts.followers,
    followingCount: counts.following,
  };
}
