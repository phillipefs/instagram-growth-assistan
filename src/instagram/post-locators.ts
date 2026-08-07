/**
 * Localizadores para reconhecimento de publicações e engajamento.
 *
 * Ganchos `data-testid` permitem fixtures determinísticas; seletores
 * estruturais aproximam o DOM real do Instagram.
 */
export const postLocators = {
  postLink: 'a[href*="/p/"], a[href*="/reel/"], [data-testid="post"]',
  commenter: '[data-testid="commenter"], article ul li a[href^="/"]',
  liker: '[data-testid="liker"], a[href$="/liked_by/"]',
} as const;

/** Texto que indica que a lista de curtidores está oculta/limitada. */
export const LIKERS_HIDDEN_TEXT =
  /(likes hidden|curtidas ocultas|and others|e outras pessoas|others liked)/i;
