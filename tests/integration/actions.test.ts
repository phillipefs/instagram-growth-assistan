import { beforeEach, describe, expect, it } from 'vitest';
import type { SqliteDatabase } from '../../src/database/connection.js';
import { openDatabase, withTransaction } from '../../src/database/connection.js';
import { runMigrations } from '../../src/database/migrator.js';
import { MIGRATIONS } from '../../src/database/migrations/index.js';
import { LocalAccountRepo } from '../../src/database/repositories/accounts.js';
import { ProfileRepo } from '../../src/database/repositories/profiles.js';
import { ActionAttemptRepo } from '../../src/database/repositories/actions.js';
import { InvalidActionTransitionError } from '../../src/domain/action-attempt.js';
import { buildIdempotencyKey } from '../../src/domain/idempotency.js';

let db: SqliteDatabase;

function seedAccountAndProfile() {
  const account = new LocalAccountRepo(db).create({ username: 'minha_conta' });
  const profile = new ProfileRepo(db).upsert({ username: 'candidato' });
  return { account, profile };
}

beforeEach(() => {
  db = openDatabase(':memory:');
  runMigrations(db, MIGRATIONS);
});

describe('ActionAttemptRepo — idempotência e transições', () => {
  it('não duplica ações com a mesma idempotency key', () => {
    const { account, profile } = seedAccountAndProfile();
    const repo = new ActionAttemptRepo(db);
    const key = buildIdempotencyKey({
      localAccount: account.username,
      actionType: 'FOLLOW',
      targetEntityId: profile.usernameCanonical,
    });

    const first = repo.prepare({
      localAccountId: account.id,
      profileId: profile.id,
      actionType: 'FOLLOW',
      idempotencyKey: key,
    });
    const second = repo.prepare({
      localAccountId: account.id,
      profileId: profile.id,
      actionType: 'FOLLOW',
      idempotencyKey: key,
    });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(second.attempt.id).toBe(first.attempt.id);
  });

  it('rejeita chave duplicada no nível do banco (UNIQUE)', () => {
    const { account, profile } = seedAccountAndProfile();
    const insertRaw = () =>
      db
        .prepare(
          `INSERT INTO action_attempts
             (id, local_account_id, profile_id, action_type, idempotency_key, state, created_at, updated_at)
           VALUES (?, ?, ?, 'FOLLOW', 'dup-key', 'PREPARED', '2026-01-01', '2026-01-01')`,
        )
        .run(crypto.randomUUID(), account.id, profile.id);
    insertRaw();
    expect(insertRaw).toThrow(/UNIQUE/i);
  });

  it('persiste o caminho PREPARED → PENDING → CONFIRMED', () => {
    const { account, profile } = seedAccountAndProfile();
    const repo = new ActionAttemptRepo(db);
    const { attempt } = repo.prepare({
      localAccountId: account.id,
      profileId: profile.id,
      actionType: 'FOLLOW',
      idempotencyKey: 'k1',
    });
    repo.transition(attempt.id, 'PENDING');
    const confirmed = repo.transition(attempt.id, 'CONFIRMED', { result: 'FOLLOWING' });
    expect(confirmed.state).toBe('CONFIRMED');
    expect(confirmed.endedAt).not.toBeNull();
  });

  it('rejeita transição inválida', () => {
    const { account, profile } = seedAccountAndProfile();
    const repo = new ActionAttemptRepo(db);
    const { attempt } = repo.prepare({
      localAccountId: account.id,
      profileId: profile.id,
      actionType: 'FOLLOW',
      idempotencyKey: 'k2',
    });
    expect(() => repo.transition(attempt.id, 'CONFIRMED')).toThrow(InvalidActionTransitionError);
  });

  it('registra skip auditável sem alterar a tentativa ambígua', () => {
    const { account, profile } = seedAccountAndProfile();
    const repo = new ActionAttemptRepo(db);
    const { attempt } = repo.prepare({
      localAccountId: account.id,
      profileId: profile.id,
      actionType: 'FOLLOW',
      idempotencyKey: 'ambiguous-to-skip',
    });
    repo.transition(attempt.id, 'PENDING');
    repo.transition(attempt.id, 'AMBIGUOUS', { result: 'sem confirmação visual' });

    const first = repo.reconcileAmbiguousAsSkipped(attempt.id, 'revisão manual');
    const second = repo.reconcileAmbiguousAsSkipped(attempt.id, 'revisão repetida');

    expect(first.resolution).toBe('SKIP_NO_RETRY');
    expect(second.id).toBe(first.id);
    expect(repo.findById(attempt.id)?.state).toBe('AMBIGUOUS');
  });

  it('confirma tentativa ambígua após observação posterior sem nova ação', () => {
    const { account, profile } = seedAccountAndProfile();
    const repo = new ActionAttemptRepo(db);
    const { attempt } = repo.prepare({
      localAccountId: account.id,
      profileId: profile.id,
      actionType: 'FOLLOW',
      idempotencyKey: 'ambiguous-confirmed-later',
    });
    repo.transition(attempt.id, 'PENDING');
    repo.transition(attempt.id, 'AMBIGUOUS', { result: 'sem confirmação visual' });

    const confirmed = repo.reconcileAmbiguousAsConfirmed(
      attempt.id,
      'reconciliado por leitura posterior: FOLLOW_REQUESTED',
    );

    expect(confirmed.state).toBe('CONFIRMED');
    expect(confirmed.result).toContain('FOLLOW_REQUESTED');
  });

  it('reconcilia UNFOLLOW com falha após leitura posterior sem nova ação', () => {
    const { account, profile } = seedAccountAndProfile();
    const repo = new ActionAttemptRepo(db);
    const { attempt } = repo.prepare({
      localAccountId: account.id,
      profileId: profile.id,
      actionType: 'UNFOLLOW',
      idempotencyKey: 'failed-unfollow-confirmed-later',
    });
    repo.transition(attempt.id, 'PENDING');
    repo.transition(attempt.id, 'FAILED', { result: 'DOM substituído após o clique' });

    const confirmed = repo.reconcileUnfollowAsConfirmed(
      attempt.id,
      'reconciliado por leitura posterior: NOT_FOLLOWING',
    );

    expect(confirmed.state).toBe('CONFIRMED');
    expect(confirmed.result).toContain('NOT_FOLLOWING');
  });
});

describe('transações', () => {
  it('reverte tudo quando a transação falha', () => {
    const profiles = new ProfileRepo(db);
    expect(() =>
      withTransaction(db, () => {
        profiles.upsert({ username: 'parcial' });
        throw new Error('falha proposital');
      }),
    ).toThrow('falha proposital');
    expect(profiles.findByUsername('parcial')).toBeUndefined();
  });
});
