import { describe, expect, it } from 'vitest';
import { extractProfileCounts, parseCountToken } from '../../src/domain/profile-counts.js';

describe('parseCountToken', () => {
  it('lê números pequenos exatos', () => {
    expect(parseCountToken('0')).toBe(0);
    expect(parseCountToken('2')).toBe(2);
    expect(parseCountToken('19')).toBe(19);
  });

  it('remove separadores de milhar', () => {
    expect(parseCountToken('1,234')).toBe(1234);
    expect(parseCountToken('1.234')).toBe(1234);
  });

  it('interpreta abreviações K/M', () => {
    expect(parseCountToken('1.2K')).toBe(1200);
    expect(parseCountToken('10.5K')).toBe(10500);
    expect(parseCountToken('3.4M')).toBe(3_400_000);
  });

  it('interpreta abreviações em português', () => {
    expect(parseCountToken('1,2 mil')).toBe(1200);
  });

  it('retorna null para lixo', () => {
    expect(parseCountToken('abc')).toBeNull();
    expect(parseCountToken('')).toBeNull();
  });
});

describe('extractProfileCounts', () => {
  it('lê seguidores e seguindo (inglês)', () => {
    const counts = extractProfileCounts('sigaodavid David Bastos 0 posts 2 followers 0 following');
    expect(counts).toEqual({ posts: 0, followers: 2, following: 0 });
  });

  it('lê seguidores e seguindo (português)', () => {
    const counts = extractProfileCounts('fulano 3 publicações 150 seguidores 80 seguindo');
    expect(counts).toEqual({ posts: 3, followers: 150, following: 80 });
  });

  it('lê contador abreviado com espaço', () => {
    const counts = extractProfileCounts('fulano 1,2 mil publicações 10,5 mil seguidores');
    expect(counts).toEqual({ posts: 1200, followers: 10500, following: null });
  });

  it('ignora o botão "Following" sem número antes', () => {
    const counts = extractProfileCounts(
      'username Following Message 5 posts 900 followers 300 following',
    );
    expect(counts).toEqual({ posts: 5, followers: 900, following: 300 });
  });

  it('lê singular "1 follower"', () => {
    const counts = extractProfileCounts('x 0 posts 1 follower 0 following');
    expect(counts).toEqual({ posts: 0, followers: 1, following: 0 });
  });

  it('retorna null quando não encontra', () => {
    expect(extractProfileCounts('nada aqui')).toEqual({
      posts: null,
      followers: null,
      following: null,
    });
  });
});
