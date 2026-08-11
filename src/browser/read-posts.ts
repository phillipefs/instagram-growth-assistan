import type { Locator, Page } from 'playwright';
import { extractShortcodeFromHref, extractUsernameFromHref } from '../domain/username.js';
import { parseCountToken } from '../domain/profile-counts.js';
import {
  LIKERS_DIALOG_TITLE,
  LIKERS_HIDDEN_TEXT,
  postLocators,
} from '../instagram/post-locators.js';
import type { PostCandidate } from '../domain/recent-post.js';

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
      await locator
        .first()
        .click({ timeout: 2000 })
        .catch(() => undefined);
      return;
    }
  }
  const byRole = page.getByRole('button', { name: /load more comments|mais comentários/i });
  if ((await byRole.count()) > 0) {
    await byRole
      .first()
      .click({ timeout: 2000 })
      .catch(() => undefined);
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
export async function loadAllComments(
  page: Page,
  options: { maxRounds?: number } = {},
): Promise<void> {
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

async function appendVisiblePostShortcodes(
  page: Page,
  posts: PostCandidate[],
  seen: Set<string>,
): Promise<void> {
  const handles = await page.locator(postLocators.postLink).elementHandles();
  for (const handle of handles) {
    const href = await handle.getAttribute('href');
    if (!href) {
      continue;
    }
    const shortcode = extractShortcodeFromHref(href);
    if (shortcode && !seen.has(shortcode)) {
      seen.add(shortcode);
      const publishedAt = await handle.getAttribute('data-published-at');
      const pinnedAttribute = await handle.getAttribute('data-pinned');
      const pinnedIcon = await handle.$(
        'svg[aria-label="Pinned post"], svg[aria-label="Publicação fixada"], svg[aria-label="Fixado"]',
      );
      posts.push({
        shortcode,
        positionIndex: posts.length,
        ...(publishedAt ? { publishedAt } : {}),
        isPinned: pinnedAttribute === 'true' || pinnedIcon !== null,
      });
    }
  }
}

/**
 * Lê os shortcodes da grade do perfil, rolando a janela para carregar mais
 * publicações até atingir o limite ou o grid parar de crescer.
 */
export async function readRecentPosts(page: Page, max = 12): Promise<PostCandidate[]> {
  if (!Number.isFinite(max) || max <= 0) {
    return [];
  }

  const posts: PostCandidate[] = [];
  const seen = new Set<string>();
  const maxRounds = Math.min(40, Math.max(6, Math.ceil(max / 3)));
  let stableRounds = 0;

  try {
    await appendVisiblePostShortcodes(page, posts, seen);
    for (let round = 0; posts.length < max && round < maxRounds; round += 1) {
      const countBeforeScroll = posts.length;
      const scrollToGridEnd = `window.scrollTo(
        0,
        Math.max(document.body.scrollHeight, document.documentElement.scrollHeight)
      )`;
      await page.evaluate(scrollToGridEnd);
      // Pausa técnica para o carregamento assíncrono do próximo trecho do grid.
      await page.waitForTimeout(1000);
      await appendVisiblePostShortcodes(page, posts, seen);

      if (posts.length > countBeforeScroll) {
        stableRounds = 0;
      } else {
        stableRounds += 1;
        if (stableRounds >= 3) {
          break;
        }
      }
    }
  } catch {
    // Preserva o que já foi lido se a grade mudar durante o carregamento.
  }
  return posts.slice(0, max);
}

export async function readRecentPostShortcodes(page: Page, max = 12): Promise<string[]> {
  return (await readRecentPosts(page, max)).map((post) => post.shortcode);
}

/** Lê a data publicada pelo Instagram na página aberta de um post/reel. */
export async function readPostPublishedAt(page: Page): Promise<string | null> {
  try {
    const time = page.locator('article time[datetime], time[datetime]').first();
    if ((await time.count()) === 0) {
      return null;
    }
    const raw = await time.getAttribute('datetime');
    if (!raw || !Number.isFinite(Date.parse(raw))) {
      return null;
    }
    return new Date(raw).toISOString();
  } catch {
    return null;
  }
}

/** Extrai usernames válidos dos hrefs de um conjunto de links. */
async function extractUsernamesFromLinks(
  page: Page,
  selector: string,
  max: number,
): Promise<string[]> {
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
  readonly complete: boolean;
  readonly expectedCount: number | null;
  readonly usernames: string[];
  readonly reason: string;
}

interface LikersScrollState {
  readonly foundScroller: boolean;
  readonly before: number;
  readonly after: number;
}

interface LikersArea {
  readonly root: Locator;
  readonly allowWindowScroll: boolean;
  readonly description: string;
}

interface LikersAreaSearch {
  readonly area: LikersArea | null;
  readonly reason: string;
}

const LIKED_BY_ROUTE = /^\/(?:p|reel)\/[^/]+\/liked_by\/?$/i;

function expectedLikersFromText(text: string): number | null {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const token = normalized.match(
    /([0-9][0-9.,]*(?:\s*(?:k|m|mil|mi))?)\s+(?:likes|curtidas)\b/i,
  )?.[1];
  if (token) {
    return parseCountToken(token);
  }
  const othersToken = normalized.match(
    /(?:outras?\s+([0-9][0-9.,]*(?:\s*(?:k|m|mil|mi))?)\s+pessoas?|([0-9][0-9.,]*(?:\s*(?:k|m|mil|mi))?)\s+others?)\b/i,
  );
  const otherPeople = othersToken?.[1] ?? othersToken?.[2];
  const parsedOthers = otherPeople ? parseCountToken(otherPeople) : null;
  if (parsedOthers !== null) {
    return parsedOthers + 1;
  }
  const bareToken = normalized.match(/^([0-9][0-9.,]*(?:\s*(?:k|m|mil|mi))?)$/i)?.[1];
  return bareToken ? parseCountToken(bareToken) : null;
}

interface CurrentPostRoute {
  readonly kind: 'p' | 'reel';
  readonly shortcode: string;
}

function currentPostRoute(page: Page): CurrentPostRoute | null {
  const match = currentPathname(page).match(/^\/(p|reel)\/([^/]+)\/?$/i);
  if (!match) {
    return null;
  }
  const kind = match[1];
  const shortcode = match[2];
  if (!kind || !shortcode) {
    return null;
  }
  return { kind: kind.toLowerCase() as CurrentPostRoute['kind'], shortcode };
}

function isCurrentPostLikersHref(href: string | null, route: CurrentPostRoute): boolean {
  if (!href) {
    return false;
  }
  try {
    const pathname = new URL(href, 'https://www.instagram.com').pathname;
    return pathname.toLowerCase() === `/${route.kind}/${route.shortcode}/liked_by/`.toLowerCase();
  } catch {
    return false;
  }
}

async function hasNearbyLikeControl(candidate: Locator): Promise<boolean> {
  return candidate
    .evaluate((element) => {
      let ancestor = element.parentElement;
      for (let depth = 0; ancestor && depth < 4; depth += 1) {
        const labels = [...ancestor.querySelectorAll('svg[aria-label]')].map(
          (svg) => svg.getAttribute('aria-label') ?? '',
        );
        if (labels.some((label) => /^(like|unlike|curtir|descurtir)$/i.test(label.trim()))) {
          return true;
        }
        ancestor = ancestor.parentElement;
      }
      return false;
    })
    .catch(() => false);
}

async function findPrimaryPostCount(page: Page): Promise<Locator | null> {
  const article = page.locator('article').first();
  const root = (await article.count()) > 0 ? article : page.locator('main').first();
  const candidates = root.locator('button, [role="button"]');

  // O layout atual mostra apenas o número (por exemplo, "329") ao lado do
  // coração. Ele deve ter prioridade sobre "2 curtidas" de um comentário.
  for (let index = 0; index < (await candidates.count()); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    const text = ((await candidate.textContent().catch(() => '')) ?? '')
      .replace(/\s+/g, ' ')
      .trim();
    if (
      /^[0-9][0-9.,]*(?:\s*(?:k|m|mil|mi))?$/i.test(text) &&
      (await hasNearbyLikeControl(candidate))
    ) {
      return candidate;
    }
  }

  return null;
}

async function findLikersTrigger(page: Page): Promise<Locator | null> {
  const route = currentPostRoute(page);
  const exactLink = page.locator('a[href$="/liked_by/"]');
  let fallback: Locator | null = null;
  for (let index = 0; index < (await exactLink.count()); index += 1) {
    const candidate = exactLink.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    if (route && !isCurrentPostLikersHref(await candidate.getAttribute('href'), route)) {
      continue;
    }
    fallback ??= candidate;
    const text = `${(await candidate.textContent().catch(() => '')) ?? ''} ${(await candidate.getAttribute('aria-label').catch(() => '')) ?? ''}`;
    if (
      /(?:\b[0-9][0-9.,]*(?:\s*(?:k|m|mil|mi))?\s+(?:likes|curtidas)\b|\boutras?\s+[0-9][0-9.,]*(?:\s*(?:k|m|mil|mi))?\s+pessoas?\b|\b[0-9][0-9.,]*(?:\s*(?:k|m|mil|mi))?\s+others?\b)/i.test(
        text,
      )
    ) {
      return candidate;
    }
  }
  if (fallback) {
    return fallback;
  }

  if (route) {
    // Na página real, nunca cai para botões de comentários ou de posts
    // relacionados. Se a contagem principal não for reconhecida, falha fechada.
    return findPrimaryPostCount(page);
  }

  const candidates = page.locator(postLocators.likersTrigger);
  for (let index = 0; index < (await candidates.count()); index += 1) {
    const candidate = candidates.nth(index);
    if (!(await candidate.isVisible().catch(() => false))) {
      continue;
    }
    const text = ((await candidate.textContent().catch(() => '')) ?? '').trim();
    const ariaLabel = ((await candidate.getAttribute('aria-label').catch(() => '')) ?? '').trim();
    if (
      /\b[0-9][0-9.,]*(?:\s*(?:k|m|mil|mi))?\s+(?:likes|curtidas)\b/i.test(`${text} ${ariaLabel}`)
    ) {
      return candidate;
    }
  }
  return null;
}

async function collectLikerUsernames(dialog: Locator): Promise<string[]> {
  const hrefs = await dialog.evaluate((root) =>
    [...root.querySelectorAll('a[href]')].map((anchor) => anchor.getAttribute('href') ?? ''),
  );
  const usernames: string[] = [];
  for (const href of hrefs) {
    const username = extractUsernameFromHref(href);
    if (username) {
      usernames.push(username);
    }
  }
  return uniquePreserveOrder(usernames);
}

async function visibleCount(locator: Locator): Promise<number> {
  let visible = 0;
  for (let index = 0; index < (await locator.count()); index += 1) {
    if (
      await locator
        .nth(index)
        .isVisible()
        .catch(() => false)
    ) {
      visible += 1;
    }
  }
  return visible;
}

async function recognizedDialog(page: Page): Promise<Locator | null> {
  const dialogs = page.locator(postLocators.likersDialog);
  for (let index = (await dialogs.count()) - 1; index >= 0; index -= 1) {
    const dialog = dialogs.nth(index);
    if (!(await dialog.isVisible().catch(() => false))) {
      continue;
    }
    const fixtureDialog = (await dialog.getAttribute('data-testid')) === 'likers-dialog';
    const title = dialog.getByText(LIKERS_DIALOG_TITLE, { exact: true });
    if (fixtureDialog || (await title.count()) > 0) {
      return dialog;
    }
  }
  return null;
}

async function titledOverlay(page: Page): Promise<Locator | null> {
  const titles = page.getByText(LIKERS_DIALOG_TITLE, { exact: true });
  for (let index = 0; index < (await titles.count()); index += 1) {
    const title = titles.nth(index);
    if (!(await title.isVisible().catch(() => false))) {
      continue;
    }
    let ancestor = title.locator('..');
    for (let depth = 0; depth < 12; depth += 1) {
      const recognized = await ancestor
        .evaluate((element) => {
          const getComputedStyle = Reflect.get(globalThis, 'getComputedStyle');
          const style = Reflect.apply(getComputedStyle, globalThis, [element]) as Record<
            string,
            unknown
          >;
          return (
            element.getAttribute('aria-modal') === 'true' ||
            Reflect.get(style, 'position') === 'fixed'
          );
        })
        .catch(() => false);
      if (recognized) {
        return ancestor;
      }
      ancestor = ancestor.locator('..');
    }
  }
  return null;
}

function currentPathname(page: Page): string {
  try {
    return new URL(page.url()).pathname;
  } catch {
    return '';
  }
}

async function findLikersArea(
  page: Page,
  visibleDialogsBeforeClick: number,
): Promise<LikersAreaSearch> {
  const deadline = Date.now() + 8_000;
  let unknownDialogSince: number | null = null;
  while (Date.now() < deadline) {
    const fixturePage = page.locator(postLocators.likersPage).last();
    if ((await fixturePage.count()) > 0 && (await fixturePage.isVisible().catch(() => false))) {
      return {
        area: { root: fixturePage, allowWindowScroll: true, description: 'página de curtidores' },
        reason: '',
      };
    }

    const pathname = currentPathname(page);
    if (LIKED_BY_ROUTE.test(pathname)) {
      const main = page.locator('main').last();
      const root = (await main.count()) > 0 ? main : page.locator('body');
      return {
        area: { root, allowWindowScroll: true, description: `rota ${pathname}` },
        reason: '',
      };
    }

    const dialog = await recognizedDialog(page);
    if (dialog) {
      return {
        area: { root: dialog, allowWindowScroll: false, description: 'diálogo de curtidores' },
        reason: '',
      };
    }

    const overlay = await titledOverlay(page);
    if (overlay) {
      return {
        area: { root: overlay, allowWindowScroll: false, description: 'painel de curtidores' },
        reason: '',
      };
    }

    const visibleDialogs = await visibleCount(page.locator(postLocators.likersDialog));
    if (visibleDialogs > visibleDialogsBeforeClick) {
      unknownDialogSince ??= Date.now();
      if (Date.now() - unknownDialogSince >= 600) {
        return {
          area: null,
          reason: `novo diálogo não reconhecido (rota: ${pathname || 'desconhecida'})`,
        };
      }
    } else {
      unknownDialogSince = null;
    }
    await page.waitForTimeout(200);
  }
  const pathname = currentPathname(page);
  return {
    area: null,
    reason: `nenhuma área de curtidores reconhecida após o clique (rota: ${pathname || 'desconhecida'})`,
  };
}

async function advanceLikersList(
  root: Locator,
  page: Page,
  allowWindowScroll: boolean,
): Promise<LikersScrollState> {
  const localScroll = await root.evaluate((element, explicitSelector) => {
    const explicit = element.querySelector(explicitSelector);
    let scroller: typeof explicit = null;
    let largestOverflow = 2;
    if (explicit) {
      const height = Number(Reflect.get(explicit, 'scrollHeight') ?? 0);
      const visible = Number(Reflect.get(explicit, 'clientHeight') ?? 0);
      if (height > visible + 2) {
        scroller = explicit;
      }
    } else {
      for (const candidate of [element, ...element.querySelectorAll('div, ul')]) {
        const height = Number(Reflect.get(candidate, 'scrollHeight') ?? 0);
        const visible = Number(Reflect.get(candidate, 'clientHeight') ?? 0);
        const overflow = height - visible;
        if (overflow > largestOverflow) {
          largestOverflow = overflow;
          scroller = candidate;
        }
      }
    }
    if (!scroller) {
      return { foundScroller: false, before: 0, after: 0 };
    }
    const before = Number(Reflect.get(scroller, 'scrollTop') ?? 0);
    const height = Number(Reflect.get(scroller, 'scrollHeight') ?? 0);
    const visible = Number(Reflect.get(scroller, 'clientHeight') ?? 0);
    const step = Math.max(Math.floor(visible * 0.8), 250);
    Reflect.set(scroller, 'scrollTop', Math.min(before + step, height));
    return {
      foundScroller: true,
      before,
      after: Number(Reflect.get(scroller, 'scrollTop') ?? 0),
    };
  }, postLocators.likersScrollContainer);
  if (localScroll.foundScroller || !allowWindowScroll) {
    return localScroll;
  }
  return page.evaluate(() => {
    const browserDocument = Reflect.get(globalThis, 'document');
    const scrollingElement =
      Reflect.get(browserDocument, 'scrollingElement') ??
      Reflect.get(browserDocument, 'documentElement');
    const before = Number(Reflect.get(scrollingElement, 'scrollTop') ?? 0);
    const scrollHeight = Number(Reflect.get(scrollingElement, 'scrollHeight') ?? 0);
    const clientHeight = Number(Reflect.get(scrollingElement, 'clientHeight') ?? 0);
    const viewportHeight = Number(Reflect.get(globalThis, 'innerHeight') ?? 0);
    const maximum = Math.max(0, scrollHeight - clientHeight);
    Reflect.set(
      scrollingElement,
      'scrollTop',
      Math.min(before + Math.max(viewportHeight * 0.8, 300), maximum),
    );
    return {
      foundScroller: maximum > 2,
      before,
      after: Number(Reflect.get(scrollingElement, 'scrollTop') ?? 0),
    };
  });
}

/**
 * Abre e percorre a área de curtidores de uma publicação. Reconhece diálogo,
 * painel visual e rota `/liked_by/`; qualquer outra interface falha fechada.
 */
export async function readPostLikers(page: Page, max = 50): Promise<LikersResult> {
  const requestedMax = Number.isFinite(max) && max > 0 ? Math.floor(max) : 0;
  if (requestedMax === 0) {
    return {
      accessible: false,
      complete: false,
      expectedCount: null,
      usernames: [],
      reason: 'limite de curtidores deve ser positivo',
    };
  }

  // Gancho determinístico mantido para fixtures; não aceita links amplos da página.
  const fixtureUsernames = await readUsernames(page, postLocators.liker, requestedMax);
  if (fixtureUsernames.length > 0) {
    return {
      accessible: true,
      complete: true,
      expectedCount: fixtureUsernames.length,
      usernames: fixtureUsernames,
      reason: 'curtidores disponíveis diretamente',
    };
  }

  const trigger = await findLikersTrigger(page);
  if (!trigger) {
    const text = await bodyText(page);
    return {
      accessible: false,
      complete: false,
      expectedCount: null,
      usernames: [],
      reason: LIKERS_HIDDEN_TEXT.test(text)
        ? 'lista de curtidores oculta'
        : 'controle de curtidores não encontrado',
    };
  }

  const triggerText = `${(await trigger.textContent().catch(() => '')) ?? ''} ${(await trigger.getAttribute('aria-label').catch(() => '')) ?? ''}`;
  const expectedCount = expectedLikersFromText(triggerText);
  try {
    const visibleDialogsBeforeClick = await visibleCount(page.locator(postLocators.likersDialog));
    await trigger.click({ timeout: 4_000 });
    const areaSearch = await findLikersArea(page, visibleDialogsBeforeClick);
    if (!areaSearch.area) {
      return {
        accessible: false,
        complete: false,
        expectedCount,
        usernames: [],
        reason: areaSearch.reason,
      };
    }
    const area = areaSearch.area;

    if (expectedCount !== 0) {
      await area.root
        .locator('a[href]')
        .first()
        .waitFor({ state: 'visible', timeout: 8_000 })
        .catch(() => undefined);
    }

    const usernames = new Set<string>();
    const targetCount =
      expectedCount === null ? requestedMax : Math.min(expectedCount, requestedMax);
    const maxPasses = Math.min(250, Math.max(12, Math.ceil(targetCount / 3) + 20));
    let stalledPasses = 0;
    let previousLoaded = -1;
    for (let pass = 0; pass < maxPasses; pass += 1) {
      for (const username of await collectLikerUsernames(area.root)) {
        usernames.add(username);
        if (usernames.size >= targetCount) {
          break;
        }
      }
      if (usernames.size >= targetCount) {
        return {
          accessible: true,
          complete: true,
          expectedCount,
          usernames: [...usernames],
          reason:
            expectedCount !== null && expectedCount <= requestedMax
              ? 'lista completa carregada'
              : 'limite solicitado atingido',
        };
      }

      const scroll = await advanceLikersList(area.root, page, area.allowWindowScroll);
      const progressed = scroll.after > scroll.before || usernames.size > previousLoaded;
      stalledPasses = progressed ? 0 : stalledPasses + 1;
      previousLoaded = usernames.size;
      if (!scroll.foundScroller || stalledPasses >= 4) {
        break;
      }
      await page.waitForTimeout(300);
    }

    const loaded = [...usernames];
    const complete =
      expectedCount !== null ? loaded.length >= Math.min(expectedCount, requestedMax) : false;
    return {
      accessible: true,
      complete,
      expectedCount,
      usernames: loaded,
      reason: complete
        ? `lista completa carregada em ${area.description}`
        : expectedCount === null
          ? `carregamento estabilizado em ${loaded.length} em ${area.description}; total não identificado`
          : `lista incompleta (${loaded.length}/${Math.min(expectedCount, requestedMax)})`,
    };
  } catch (error) {
    return {
      accessible: false,
      complete: false,
      expectedCount,
      usernames: [],
      reason: `falha ao abrir ou ler curtidores: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}
