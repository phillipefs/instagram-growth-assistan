import { describe, expect, it } from 'vitest';
import { calendarMonthRange, computeUnfollowWindow } from '../../src/domain/cohort.js';

const now = new Date('2026-08-06T12:00:00.000Z');

describe('computeUnfollowWindow', () => {
  it('janela móvel: seguidos há mais de N dias define o limite superior', () => {
    const w = computeUnfollowWindow({ olderThanDays: 15 }, now);
    expect(w.fromIso).toBeUndefined();
    expect(w.toIso).toBe('2026-07-22T12:00:00.000Z');
  });

  it('janela de ausência de follow-back também exige a idade mínima', () => {
    const w = computeUnfollowWindow({ noFollowBackAfterDays: 7 }, now);
    expect(w.fromIso).toBeUndefined();
    expect(w.toIso).toBe('2026-07-30T12:00:00.000Z');
    expect(w.label).toBe('sem follow-back após 7 dias');
  });

  it('rejeita prazo de follow-back inválido ou combinado com olderThanDays', () => {
    expect(() => computeUnfollowWindow({ noFollowBackAfterDays: 0 }, now)).toThrow();
    expect(() =>
      computeUnfollowWindow({ olderThanDays: 7, noFollowBackAfterDays: 7 }, now),
    ).toThrow();
  });

  it('janela móvel: seguidos nos últimos N dias define o limite inferior', () => {
    const w = computeUnfollowWindow({ followedWithinDays: 7 }, now);
    expect(w.fromIso).toBe('2026-07-30T12:00:00.000Z');
    expect(w.toIso).toBeUndefined();
  });

  it('combina móvel para formar um intervalo "entre"', () => {
    const w = computeUnfollowWindow({ followedWithinDays: 30, olderThanDays: 7 }, now);
    expect(w.fromIso).toBe('2026-07-07T12:00:00.000Z');
    expect(w.toIso).toBe('2026-07-30T12:00:00.000Z');
  });

  it('datas explícitas usam início e fim do dia', () => {
    const w = computeUnfollowWindow({ from: '2026-07-01', to: '2026-07-31' }, now);
    expect(w.fromIso).toBe('2026-07-01T00:00:00.000Z');
    expect(w.toIso).toBe('2026-07-31T23:59:59.999Z');
  });

  it('mês de calendário difere da janela móvel', () => {
    const w = computeUnfollowWindow({ calendarMonth: '2026-07' }, now);
    expect(w.fromIso).toBe('2026-07-01T00:00:00.000Z');
    expect(w.toIso).toBe('2026-07-31T23:59:59.999Z');
    expect(w.label).toContain('mês de calendário');
  });

  it('rejeita data e mês inválidos', () => {
    expect(() => computeUnfollowWindow({ from: '2026-13-40' }, now)).toThrow();
    expect(() => computeUnfollowWindow({ calendarMonth: '2026-7' }, now)).toThrow();
  });
});

describe('calendarMonthRange', () => {
  it('cobre o mês inteiro (fevereiro bissexto)', () => {
    const r = calendarMonthRange('2028-02');
    expect(r.fromIso).toBe('2028-02-01T00:00:00.000Z');
    expect(r.toIso).toBe('2028-02-29T23:59:59.999Z');
  });
});
