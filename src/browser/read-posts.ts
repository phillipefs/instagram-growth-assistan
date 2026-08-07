import type { Page } from 'playwright';
import { extractShortcodeFromHref, extractUsernameFromHref } from '../domain/username.js';
import { LIKERS_HIDDEN_TEXT, postLocators } from '../instagram/post-locators.js';

function uniquePreserveOrder(values: string[]): string[] {
  return [...new Set(values)];
}

/** Clica no controle "carregar mais comentários", se existir (best-effort). */
async function clickLoadMoreComments(page: Page): Promise<void> {
  const selectors = [
    '[aria-label="Load more comments"]',
    '[aria-label="Carregar mais comentários"]',
    '[aria-label="Ver mais comentários"]',
  ];
  for (const selector of selectors) {
    const locator = page.locator(selector);
    if ((await locator.count()) > 0) {
      await locator.first().click({ timeout: 2000 }).catch(() => undefined);
      return;
    }
  }
  const byRole = page.getByRole('button', { name: /load more comments|mais comentários/i });
  if ((await byRole.count()) > 0) {
    await byRole.first().click({ timeout: 2000 }).catch(() => undefined);
  }
}

/**
 * Rola o container rolável que contém os comentários (achado a partir dos links
 * de avatar) até o fim, disparando o carregamento infinito do Instagram. Feito
 * dentro da página para atingir o painel certo (na coluna direita, no desktop),
 * já que `mouse.wheel` numa posição arbitrária não rola esse painel. Retorna
 * quantos containers roláveis foram rolados (0 = usou fallback na janela).
 */
async function scrollCommentPanel(page: Page): Promise<number> {
  // Executado no contexto do navegador (não tipado contra os globais do Node).
  const script = `(() => {
    const isScrollable = (el) => {
      const style = window.getComputedStyle(el);
      const oy = style.overflowY;
      return (oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 20;
    };
    const links = Array.from(document.querySelectorAll('a[href^="/"]')).filter((a) => a.querySelector('img[alt]'));
    const containers = new Set();
    for (const link of links) {
      let el = link.parentElement;
      while (el && el !== document.body) {
        if (isScrollable(el)) { containers.add(el); break; }
        el = el.parentElement;
      }
    }
    if (containers.size === 0) {
      window.scrollTo(0, document.body.scrollHeight);
      return 0;
    }
    for (const el of containers) { el.scrollTop = el.scrollHeight; }
    return containers.size;
  })()`;
  return (await page.evaluate(script)) as number;
}

/**
 * Carrega mais comentários rolando o painel de comentários até o fim e clicando
 * em "carregar mais", até parar de crescer ou atingir o máximo de rodadas.
 * Somente leitura.
 */
export async function loadAllComments(page: Page, options: { maxRounds?: number } = {}): Promise<void> {
  const maxRounds = options.maxRounds ?? 20;
  // Links de avatar dentro de comentários (têm uma imagem de perfil).
  const commentAvatar = 'a[href^="/"]:has(img[alt])';
  let last = 0;
  let stable = 0;
  for (let round = 0; round < maxRounds; round += 1) {
    await clickLoadMoreComments(page);
    // Rola o painel rolável dos comentários diretamente pelo DOM (visível).
    await scrollCommentPanel(page);
    await page.waitForTimeout(1000);
    const after = await page.locator(commentAvatar).count();
    if (after > last) {
      last = after;
      stable = 0;
    } else {
      stable += 1;
      if (stable >= 3) {
        break;
      }
    }
  }
}

async function bodyText(page: Page): Promise<string> {
  try {
    return await page.locator('body').innerText();
  } catch {
    return '';
  }
}

/** Extrai usernames de um conjunto de elementos (via data-username ou href). */
async function readUsernames(page: Page, selector: string, max: number): Promise<string[]> {
  const usernames: string[] = [];
  let handles;
  try {
    handles = await page.locator(selector).elementHandles();
  } catch {
    return [];
  }
  for (const handle of handles) {
    if (usernames.length >= max) {
      break;
    }
    const dataUsername = await handle.getAttribute('data-username');
    if (dataUsername && dataUsername.trim().length > 0) {
      usernames.push(dataUsername.trim().replace(/^@/, '').toLowerCase());
      continue;
    }
    const href = await handle.getAttribute('href');
    if (href) {
      const username = extractUsernameFromHref(href);
      if (username) {
        usernames.push(username);
      }
    }
  }
  return uniquePreserveOrder(usernames);
}

/** Lê os shortcodes das publicações recentes visíveis na grade do perfil. */
export async function readRecentPostShortcodes(page: Page, max = 12): Promise<string[]> {
  let handles;
  try {
    handles = await page.locator(postLocators.postLink).elementHandles();
  } catch {
    return [];
  }
  const shortcodes: string[] = [];
  for (const handle of handles) {
    const href = await handle.getAttribute('href');
    if (!href) {
      continue;
    }
    const shortcode = extractShortcodeFromHref(href);
    if (shortcode) {
      shortcodes.push(shortcode);
    }
  }
  return uniquePreserveOrder(shortcodes).slice(0, max);
}

/** Extrai usernames válidos dos hrefs de um conjunto de links. */
async function extractUsernamesFromLinks(page: Page, selector: string, max: number): Promise<string[]> {
  let handles;
  try {
    handles = await page.locator(selector).elementHandles();
  } catch {
    return [];
  }
  const usernames: string[] = [];
  for (const handle of handles) {
    if (usernames.length >= max) {
      break;
    }
    const href = await handle.getAttribute('href');
    if (!href) {
      continue;
    }
    const username = extractUsernameFromHref(href);
    if (username) {
      usernames.push(username);
    }
  }
  return uniquePreserveOrder(usernames);
}

/** Lê os comentaristas de uma publicação (links de avatar dos comentários). */
export async function readPostCommenters(page: Page, max = 80): Promise<string[]> {
  // Preferir links de avatar (precisos); cair para o scan amplo em fixtures.
  const fromAvatars = await extractUsernamesFromLinks(page, 'a[href^="/"]:has(img[alt])', max);
  if (fromAvatars.length > 0) {
    return fromAvatars;
  }
  return extractUsernamesFromLinks(page, 'a[href^="/"]', max);
}

export interface LikersResult {
  readonly accessible: boolean;
  readonly usernames: string[];
}

/**
 * Lê os curtidores de uma publicação (best-effort). O Instagram frequentemente
 * oculta essa lista; nesse caso, `accessible` é falso.
 */
export async function readPostLikers(page: Page, max = 50): Promise<LikersResult> {
  const usernames = await readUsernames(page, postLocators.liker, max);
  if (usernames.length > 0) {
    return { accessible: true, usernames };
  }
  const text = await bodyText(page);
  if (LIKERS_HIDDEN_TEXT.test(text)) {
    return { accessible: false, usernames: [] };
  }
  return { accessible: false, usernames: [] };
}
