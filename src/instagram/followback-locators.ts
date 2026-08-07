/**
 * Localizadores para o selo "segue você" exibido no perfil de quem já segue a
 * conta ativa. Gancho `data-testid` para fixtures; texto acessível para o real.
 */
export const followBackLocators = {
  followsYouBadge: '[data-testid="follows-you"]',
} as const;

export const FOLLOWS_YOU_TEXT = /(follows you|segue você|te segue)/i;
