import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config/schema.js';

describe('loadConfig', () => {
  it('aplica padrões seguros sem entrada', () => {
    const config = loadConfig();
    expect(config.execution.mode).toBe('dry-run');
    expect(config.execution.automaticActionsEnabled).toBe(false);
    expect(config.execution.defaultRealActionLimit).toBe(0);
    expect(config.execution.defaultBatchSliceSize).toBe(0);
    expect(config.execution.dailyActionCap).toBe(0);
  });

  it('mantém as proteções por origem/whitelist ligadas; follow-backs não preservados', () => {
    const config = loadConfig();
    expect(config.unfollow.onlyToolRecordedFollows).toBe(true);
    expect(config.unfollow.preserveWhitelist).toBe(true);
    expect(config.unfollow.preserveProtected).toBe(true);
    // Decisão do usuário: todo follow da ferramenta é elegível, retribua ou não.
    expect(config.unfollow.preserveFollowBacks).toBe(false);
  });

  it('não permite retomada automática nem contas paralelas', () => {
    const config = loadConfig();
    expect(config.safety.automaticResume).toBe(false);
    expect(config.safety.parallelAccounts).toBe(false);
  });

  it('valida um modo de execução conhecido', () => {
    const config = loadConfig({ execution: { mode: 'supervised-batch' } });
    expect(config.execution.mode).toBe('supervised-batch');
  });

  it('rejeita um modo de execução inválido', () => {
    expect(() => loadConfig({ execution: { mode: 'autonomous' } })).toThrow();
  });

  it('rejeita limite real negativo', () => {
    expect(() => loadConfig({ execution: { defaultRealActionLimit: -1 } })).toThrow();
  });
});
