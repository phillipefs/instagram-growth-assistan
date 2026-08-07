/**
 * Interpretação dos contadores do cabeçalho de um perfil (publicações,
 * seguidores, seguindo). Best-effort: lida com números pequenos exatos e com
 * abreviações (`1.2K`, `10.5M`, `1,2 mil`). Retorna `null` quando não reconhece.
 */

export interface ProfileCounts {
  readonly followers: number | null;
  readonly following: number | null;
}

/** Converte um token como `2`, `1,234`, `1.2K` ou `3.4M` em número. */
export function parseCountToken(raw: string): number | null {
  const token = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (token.length === 0) {
    return null;
  }

  let multiplier = 1;
  let numeric = token;
  if (token.endsWith('mil')) {
    multiplier = 1_000;
    numeric = token.slice(0, -3);
  } else if (token.endsWith('mi')) {
    multiplier = 1_000_000;
    numeric = token.slice(0, -2);
  } else if (token.endsWith('k')) {
    multiplier = 1_000;
    numeric = token.slice(0, -1);
  } else if (token.endsWith('m')) {
    multiplier = 1_000_000;
    numeric = token.slice(0, -1);
  }

  let value: number;
  if (multiplier > 1) {
    // Com sufixo, vírgula/ponto são separadores decimais (1,2K = 1.2K).
    value = Number.parseFloat(numeric.replace(',', '.'));
  } else {
    // Sem sufixo, vírgula/ponto são separadores de milhar.
    const digits = numeric.replace(/[.,]/g, '');
    if (!/^\d+$/.test(digits)) {
      return null;
    }
    value = Number.parseInt(digits, 10);
  }

  return Number.isFinite(value) ? Math.round(value * multiplier) : null;
}

/**
 * Extrai `followers` e `following` do texto do cabeçalho. Procura o número
 * imediatamente antes de "followers"/"seguidores" e "following"/"seguindo".
 * O botão "Following" (sem número antes) é naturalmente ignorado.
 */
export function extractProfileCounts(text: string): ProfileCounts {
  const words = text.replace(/\s+/g, ' ').trim().split(' ');
  let followers: number | null = null;
  let following: number | null = null;

  for (let i = 1; i < words.length; i += 1) {
    const word = words[i] ?? '';
    const prev = words[i - 1] ?? '';
    if (followers === null && (/^follower/i.test(word) || /^seguidor/i.test(word))) {
      followers = parseCountToken(prev);
    } else if (following === null && (/^following/i.test(word) || /^seguindo/i.test(word))) {
      following = parseCountToken(prev);
    }
  }

  return { followers, following };
}
