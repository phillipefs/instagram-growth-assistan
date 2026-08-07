import { describe, expect, it } from 'vitest';
import type { Run } from '../../src/database/repositories/runs.js';
import { formatDuration, formatRunReport } from '../../src/cli/format/run-report.js';

function fakeRun(overrides: Partial<Run> = {}): Run {
  return {
    id: 'run-1',
    type: 'FOLLOW',
    mode: 'supervised-batch',
    localAccountId: 'acc-1',
    planId: 'plan-1',
    configJson: null,
    status: 'COMPLETED',
    countersJson: null,
    stopReason: 'limite de ações reais atingido',
    startedAt: '2026-08-07T10:00:00.000Z',
    endedAt: '2026-08-07T10:02:30.000Z',
    createdAt: '2026-08-07T09:59:00.000Z',
    ...overrides,
  };
}

describe('formatDuration', () => {
  it('formata minutos e segundos', () => {
    expect(formatDuration('2026-08-07T10:00:00.000Z', '2026-08-07T10:02:30.000Z')).toBe('2m30s');
  });

  it('formata só segundos abaixo de um minuto', () => {
    expect(formatDuration('2026-08-07T10:00:00.000Z', '2026-08-07T10:00:12.000Z')).toBe('12s');
  });

  it('retorna travessão quando falta um instante', () => {
    expect(formatDuration(null, '2026-08-07T10:00:00.000Z')).toBe('—');
  });
});

describe('formatRunReport', () => {
  it('inclui cabeçalho, contadores e itens com evidência', () => {
    const report = formatRunReport({
      run: fakeRun(),
      items: [
        { username: 'u1', state: 'CONFIRMED', result: 'FOLLOWING', screenshotPath: '/e/u1.png' },
        { username: 'u2', state: 'CONFIRMED', result: 'FOLLOWING', screenshotPath: null },
        { username: 'u3', state: 'SKIPPED', result: 'já seguido', screenshotPath: null },
        { username: 'u4', state: 'AMBIGUOUS', result: 'estado desconhecido', screenshotPath: '/e/u4.png' },
      ],
    });
    expect(report).toContain('Run run-1 — FOLLOW (supervised-batch)');
    expect(report).toContain('Status:  COMPLETED');
    expect(report).toContain('Duração: 2m30s');
    expect(report).toContain('Parada:  limite de ações reais atingido');
    expect(report).toContain('confirmados: 2');
    expect(report).toContain('ambíguos:    1');
    expect(report).toContain('pulados:     1');
    expect(report).toContain('@u1');
    expect(report).toContain('[evidência: /e/u1.png]');
    expect(report).toContain('[evidência: /e/u4.png]');
  });

  it('mostra pendentes quando há tentativas não finalizadas', () => {
    const report = formatRunReport({
      run: fakeRun({ status: 'RUNNING', endedAt: null }),
      items: [{ username: 'u1', state: 'PENDING', result: null, screenshotPath: null }],
    });
    expect(report).toContain('pendentes:   1');
    expect(report).toContain('Duração: —');
  });
});
