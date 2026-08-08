import { describe, expect, it } from 'vitest';
import {
  commentLoadRoundsFor,
  normalizeCommentsPerPost,
} from '../../src/workflows/collect-browser.js';

describe('configuração de comentários da coleta', () => {
  it('mantém 80 como padrão', () => {
    expect(normalizeCommentsPerPost(undefined)).toBe(80);
    expect(commentLoadRoundsFor(80)).toBe(15);
  });

  it('aumenta as rodadas proporcionalmente ao volume solicitado', () => {
    expect(normalizeCommentsPerPost(1000)).toBe(1000);
    expect(commentLoadRoundsFor(1000)).toBe(100);
    expect(commentLoadRoundsFor(10_000)).toBe(200);
  });
});
