/**
 * Localizadores e heurísticas de reconhecimento de perfil do Instagram.
 *
 * Preferimos texto acessível, roles e relações estruturais. Ganchos
 * `data-testid` permitem fixtures determinísticas sem depender do DOM real.
 */
export const profileLocators = {
  profileHeader: 'header:has(h1), header:has(h2), header:has([data-testid="profile-username"])',
  username: '[data-testid="profile-username"], header h2, header h1',
  followButton: '[data-testid="follow-button"]',
  followersLink: 'a[href$="/followers/"]',
  postLink: 'a[href*="/p/"], a[href*="/reel/"], [data-testid="post"]',
} as const;

export const PROFILE_NOT_FOUND_TEXT =
  /(sorry, this page isn'?t available|esta página não está disponível|página não disponível|user not found|usuário não encontrado)/i;

export const PROFILE_PRIVATE_TEXT =
  /(this account is private|esta conta é privada|conta privada|account is private)/i;

/**
 * Textos de botão que indicam cada estado de relacionamento.
 *
 * No perfil, "Following"/"Requested" vêm com um ícone de seta cujo rótulo
 * acessível é concatenado ao nome (ex.: "Following Down chevron icon"); por isso
 * casamos por prefixo. "Follow" (não seguindo) não tem ícone: casamos exato.
 */
export const FOLLOW_BUTTON_TEXT = {
  FOLLOWING: /^(following|seguindo)\b/i,
  REQUESTED: /^(requested|solicitado)\b/i,
  FOLLOW: /^(follow|seguir)$/i,
} as const;

/**
 * Texto do botão que confirma a saída no diálogo/menu de unfollow. Cobre também
 * o cancelamento de solicitação pendente. Nunca casa um "Cancel"/"Cancelar"
 * isolado (esse é o botão de abortar o diálogo).
 */
export const UNFOLLOW_CONFIRM_TEXT =
  /^(unfollow|deixar de seguir|cancel request|cancelar solicitação)$/i;
