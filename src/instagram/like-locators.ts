/**
 * Localizadores para curtir uma publicação. Ganchos `data-testid` permitem
 * fixtures determinísticas; seletores por `aria-label` aproximam o DOM real.
 */
export const likeLocators = {
  likeButton:
    '[data-testid="like-button"], svg[aria-label="Like"][height="24"], svg[aria-label="Curtir"][height="24"]',
  likedIndicator:
    '[data-testid="like-button"][data-liked="true"], svg[aria-label="Unlike"][height="24"], svg[aria-label="Descurtir"][height="24"]',
} as const;

/** Ganchos opcionais nas publicações da grade para data/fixação. */
export const gridPostAttributes = {
  publishedAt: 'data-published-at',
  pinned: 'data-pinned',
} as const;
