/** Localizadores da lista de seguidores da conta ativa. */
export const followersLocators = {
  dialog: '[data-testid="followers-dialog"], [role="dialog"]',
  scrollContainer: '[data-testid="followers-scroll"]',
} as const;

export const FOLLOWERS_DIALOG_TITLE = /^(followers|seguidores)$/i;
