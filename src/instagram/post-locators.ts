/**
 * Localizadores para reconhecimento de publicações e engajamento.
 *
 * Ganchos `data-testid` permitem fixtures determinísticas; seletores
 * estruturais aproximam o DOM real do Instagram.
 */
export const postLocators = {
  postLink: 'a[href*="/p/"], a[href*="/reel/"], [data-testid="post"]',
  commenter: '[data-testid="commenter"], article ul li a[href^="/"]',
  liker: '[data-testid="liker"]',
  likersTrigger:
    'a[href$="/liked_by/"], article button, article [role="button"], main button, main [role="button"]',
  likersDialog: '[data-testid="likers-dialog"], [role="dialog"]',
  likersPage: '[data-testid="likers-page"]',
  likersScrollContainer: '[data-testid="likers-scroll"]',
} as const;

/** Título aceito para reconhecer, de forma fechada, o diálogo de curtidores. */
export const LIKERS_DIALOG_TITLE = /^(likes|curtidas)$/i;

/** Texto que indica que a lista de curtidores está oculta/limitada. */
export const LIKERS_HIDDEN_TEXT =
  /(likes hidden|curtidas ocultas|and others|e outras pessoas|others liked)/i;
