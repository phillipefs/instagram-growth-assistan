/**
 * Validação e extração de usernames do Instagram.
 *
 * Usernames válidos têm letras, números, ponto e sublinhado, até 30 caracteres.
 * Segmentos reservados de rota não são usernames.
 */
const USERNAME_RE = /^[a-z0-9._]{1,30}$/i;

const RESERVED_SEGMENTS = new Set([
  'p',
  'reel',
  'reels',
  'explore',
  'accounts',
  'stories',
  'direct',
  'about',
  'developer',
  'legal',
  'privacy',
  'tags',
  'locations',
  'challenge',
  'session',
]);

export function isValidInstagramUsername(value: string): boolean {
  const v = value.trim().replace(/^@/, '');
  if (!USERNAME_RE.test(v)) {
    return false;
  }
  // Não aceitar apenas pontos.
  return /[a-z0-9_]/i.test(v);
}

/**
 * Extrai um username de um href de perfil (`/username/`). Retorna null quando o
 * href não é um perfil (posts, reels, rotas reservadas, caminhos aninhados).
 */
export function extractUsernameFromHref(href: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(href, 'https://www.instagram.com').pathname;
  } catch {
    return null;
  }
  const segments = pathname.split('/').filter((s) => s.length > 0);
  if (segments.length !== 1) {
    return null;
  }
  const segment = segments[0];
  if (segment === undefined || RESERVED_SEGMENTS.has(segment.toLowerCase())) {
    return null;
  }
  return isValidInstagramUsername(segment) ? segment.toLowerCase() : null;
}

/** Extrai o shortcode de um href de publicação (`/p/CODE/` ou `/reel/CODE/`). */
export function extractShortcodeFromHref(href: string): string | null {
  let pathname: string;
  try {
    pathname = new URL(href, 'https://www.instagram.com').pathname;
  } catch {
    return null;
  }
  const match = /\/(?:p|reel)\/([a-z0-9_-]+)\/?/i.exec(pathname);
  return match?.[1] ?? null;
}
