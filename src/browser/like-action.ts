import type { Page, Locator } from 'playwright';
import { postLocators } from '../instagram/post-locators.js';
import { gridPostAttributes, likeLocators } from '../instagram/like-locators.js';
import { extractShortcodeFromHref } from '../domain/username.js';
import type { PostCandidate } from '../domain/recent-post.js';
import type { LikeState } from '../workflows/like-result.js';

// Escopo do post principal: numa página /p/, o IG lista "more posts" com seus
// próprios botões de curtir; o post aberto é o primeiro <article>.
async function mainPostScope(page: Page): Promise<Page | Locator> {
  return (await page.locator('article').count()) > 0 ? page.locator('article').first() : page;
}

/** Lê as publicações visíveis na grade, com data/fixação quando disponíveis. */
export async function readGridPosts(page: Page, max = 12): Promise<PostCandidate[]> {
  let handles;
  try {
    handles = await page.locator(postLocators.postLink).elementHandles();
  } catch {
    return [];
  }
  const posts: PostCandidate[] = [];
  let position = 0;
  for (const handle of handles) {
    if (posts.length >= max) {
      break;
    }
    const href = await handle.getAttribute('href');
    const shortcode = href ? extractShortcodeFromHref(href) : null;
    if (!shortcode) {
      continue;
    }
    const publishedAt = await handle.getAttribute(gridPostAttributes.publishedAt);
    const pinned = await handle.getAttribute(gridPostAttributes.pinned);
    posts.push({
      shortcode,
      positionIndex: position,
      ...(publishedAt ? { publishedAt } : {}),
      isPinned: pinned === 'true',
    });
    position += 1;
  }
  return posts;
}

/** Lê o estado de curtida de uma publicação aberta. */
export async function readLikeState(page: Page): Promise<LikeState> {
  try {
    const scope = await mainPostScope(page);
    if ((await scope.locator(likeLocators.likedIndicator).count()) > 0) {
      return 'LIKED';
    }
    if ((await scope.locator(likeLocators.likeButton).count()) > 0) {
      return 'NOT_LIKED';
    }
  } catch {
    return 'UNKNOWN';
  }
  return 'UNKNOWN';
}

/** Clica em curtir uma única vez (botão do post, não dos comentários). */
export async function clickLike(page: Page): Promise<void> {
  const hook = page.locator('[data-testid="like-button"]');
  if ((await hook.count()) > 0) {
    await hook.first().click();
    return;
  }
  const scope = await mainPostScope(page);
  const likeSvg = scope
    .locator('svg[aria-label="Like"][height="24"], svg[aria-label="Curtir"][height="24"]')
    .first();
  // Clica no botão-ancestral (role=button) que envolve o ícone, não no svg.
  const button = likeSvg.locator('xpath=ancestor::*[@role="button"][1]');
  if ((await button.count()) > 0) {
    await button.first().click();
    return;
  }
  await likeSvg.click();
}

/** Executa no máximo uma curtida e retorna o estado observado. A confirmação
 * (Like→Unlike) tem um pequeno atraso; aguardamos por até ~5s (sem reclicar). */
export async function performLike(page: Page): Promise<LikeState> {
  await clickLike(page);
  const deadline = Date.now() + 5000;
  for (;;) {
    await page.waitForTimeout(250);
    const state = await readLikeState(page);
    if (state === 'LIKED' || Date.now() >= deadline) {
      return state;
    }
  }
}
