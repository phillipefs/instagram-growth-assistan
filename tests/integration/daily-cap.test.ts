import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { ActionAttemptRepo } from '../../src/database/repositories/actions.js';
import type { ActionState } from '../../src/domain/states.js';
import { applyDailyCap, utcDayStartIso } from '../../src/workflows/daily-cap.js';

let db: SqliteDatabase;
let accountId: string;
let actions: ActionAttemptRepo;

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
  accountId = new LocalAccountRepo(db).create({ username: 'minha_conta' }).id;
  actions = new ActionAttemptRepo(db);
});

function seedFollow(username: string, finalState: ActionState): void {
  const profile = new ProfileRepo(db).upsert({ username });
  const { attempt } = actions.prepare({
    localAccountId: accountId,
    profileId: profile.id,
    actionType: 'FOLLOW',
    idempotencyKey: `k-${username}`,
  });
  if (finalState === 'SKIPPED') {
    actions.transition(attempt.id, 'SKIPPED');
    return;
  }
  actions.transition(attempt.id, 'PENDING');
  actions.transition(attempt.id, finalState);
}

describe('utcDayStartIso', () => {
  it('retorna o início do dia UTC', () => {
    expect(utcDayStartIso(new Date('2026-08-07T15:42:00.000Z'))).toBe('2026-08-07T00:00:00.000Z');
  });
});

describe('applyDailyCap', () => {
  it('cap 0 desliga o teto e devolve o limite pedido', () => {
    seedFollow('a', 'CONFIRMED');
    const result = applyDailyCap(actions, accountId, 'FOLLOW', 5, 0);
    expect(result).toEqual({ effectiveLimit: 5, alreadyToday: 0, cap: 0, capReached: false });
  });

  it('reduz o limite pelo que já foi feito hoje (conta CONFIRMED e AMBIGUOUS)', () => {
    seedFollow('a', 'CONFIRMED');
    seedFollow('b', 'AMBIGUOUS');
    seedFollow('c', 'SKIPPED'); // não conta
    const result = applyDailyCap(actions, accountId, 'FOLLOW', 5, 5);
    expect(result.alreadyToday).toBe(2);
    expect(result.effectiveLimit).toBe(3);
    expect(result.capReached).toBe(false);
  });

  it('marca capReached e zera o limite quando o teto já foi atingido', () => {
    seedFollow('a', 'CONFIRMED');
    seedFollow('b', 'CONFIRMED');
    const result = applyDailyCap(actions, accountId, 'FOLLOW', 10, 2);
    expect(result.capReached).toBe(true);
    expect(result.effectiveLimit).toBe(0);
  });

  it('ignora ações de dias anteriores ao dia UTC de referência', () => {
    seedFollow('a', 'CONFIRMED');
    seedFollow('b', 'CONFIRMED');
    // No dia seguinte, as ações de hoje não contam para o teto.
    const tomorrow = new Date(Date.now() + 86_400_000);
    const result = applyDailyCap(actions, accountId, 'FOLLOW', 4, 5, tomorrow);
    expect(result.alreadyToday).toBe(0);
    expect(result.effectiveLimit).toBe(4);
  });

  it('não mistura tipos de ação diferentes', () => {
    seedFollow('a', 'CONFIRMED');
    const result = applyDailyCap(actions, accountId, 'UNFOLLOW', 3, 3);
    expect(result.alreadyToday).toBe(0);
    expect(result.effectiveLimit).toBe(3);
  });
});
