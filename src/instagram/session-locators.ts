/**
 * Localizadores e heurísticas de sessão do Instagram, centralizados para
 * facilitar manutenção quando a interface mudar.
 *
 * Preferimos sinais estáveis (campos de formulário, texto acessível, URL) a
 * classes CSS geradas. Alguns ganchos `data-testid` existem para permitir
 * fixtures de teste determinísticas.
 */
export const sessionLocators = {
  loginUsernameInput: 'input[name="username"]',
  loginPasswordInput: 'input[name="password"]',
  captchaIframe: 'iframe[src*="recaptcha"], iframe[title*="captcha" i]',
  /** Gancho opcional para leitura da conta ativa (fixtures e futura extração). */
  activeAccount: '[data-testid="active-account"]',
} as const;

/** Domínios aceitos como o Instagram. */
export const ALLOWED_HOSTS: readonly string[] = ['instagram.com', 'www.instagram.com'];

/** Padrões de texto que indicam CAPTCHA. */
export const CAPTCHA_TEXT = /captcha/i;

/** Padrões que indicam desafio/checkpoint. */
export const CHALLENGE_TEXT =
  /(confirm it'?s you|it wasn'?t me|checkpoint|verifique que é você|confirme que é você|unusual activity|atividade incomum|suspicious login|suspеita)/i;

/** URLs que indicam desafio/checkpoint. */
export const CHALLENGE_URL = /\/(challenge|accounts\/suspended|checkpoint)\b/i;

/** Padrões que indicam aviso/limitação de atividade. */
export const WARNING_TEXT =
  /(action blocked|try again later|we restrict certain activity|ação bloqueada|tente novamente mais tarde|limitamos determinadas atividades)/i;

/**
 * Âncoras para extrair o username da conta ativa do HTML renderizado.
 * O bloco do viewer traz `"username":"X","is_supervised_user"` (específico da
 * conta logada). Um segundo padrão serve de reserva.
 */
export const VIEWER_USERNAME_PATTERNS: readonly RegExp[] = [
  /"username":"([^"]+)","is_supervised_user"/,
  /"viewer"\s*:\s*\{[^}]{0,400}?"username":"([^"]+)"/,
];
