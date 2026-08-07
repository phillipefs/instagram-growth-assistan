import { describe, expect, it } from 'vitest';
import {
  extractShortcodeFromHref,
  extractUsernameFromHref,
  isValidInstagramUsername,
} from '../../src/domain/username.js';

describe('isValidInstagramUsername', () => {
  it('aceita usernames válidos', () => {
    expect(isValidInstagramUsername('investidor_a')).toBe(true);
    expect(isValidInstagramUsername('a.b_c')).toBe(true);
    expect(isValidInstagramUsername('@Trader')).toBe(true);
  });

  it('rejeita inválidos', () => {
    expect(isValidInstagramUsername('')).toBe(false);
    expect(isValidInstagramUsername('com espaco')).toBe(false);
    expect(isValidInstagramUsername('.'.repeat(3))).toBe(false);
    expect(isValidInstagramUsername('x'.repeat(31))).toBe(false);
  });
});

describe('extractUsernameFromHref', () => {
  it('extrai username de href de perfil', () => {
    expect(extractUsernameFromHref('/investidor_a/')).toBe('investidor_a');
    expect(extractUsernameFromHref('https://www.instagram.com/Trader/')).toBe('trader');
  });

  it('ignora posts, rotas reservadas e caminhos aninhados', () => {
    expect(extractUsernameFromHref('/p/ABC123/')).toBeNull();
    expect(extractUsernameFromHref('/explore/')).toBeNull();
    expect(extractUsernameFromHref('/user/tagged/')).toBeNull();
  });
});

describe('extractShortcodeFromHref', () => {
  it('extrai shortcode de publicação e reel', () => {
    expect(extractShortcodeFromHref('/p/ABC123/')).toBe('ABC123');
    expect(extractShortcodeFromHref('/reel/XYZ_9/')).toBe('XYZ_9');
  });

  it('retorna null para não-publicações', () => {
    expect(extractShortcodeFromHref('/user/')).toBeNull();
  });
});
