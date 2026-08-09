import type { Page, Response } from 'playwright';
import type { ObservedRelationship } from './profile-detector.js';

type PositiveRelationship = Extract<
  ObservedRelationship,
  'FOLLOWING' | 'FOLLOW_REQUESTED'
>;

function canonicalUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extrai somente estados positivos e explicitamente ligados ao username alvo.
 * Estados `false` nunca viram NOT_FOLLOWING: este sinal serve apenas para
 * confirmar, sem reclicar, uma ação cujo DOM visual ficou inconclusivo.
 */
export function findPositiveRelationshipForUsername(
  payload: unknown,
  expectedUsername: string,
): PositiveRelationship | null {
  const expected = canonicalUsername(expectedUsername);

  function visit(value: unknown): PositiveRelationship | null {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }
    if (!isRecord(value)) return null;

    if (
      typeof value.username === 'string' &&
      canonicalUsername(value.username) === expected &&
      isRecord(value.friendship_status)
    ) {
      const status = value.friendship_status;
      if (status.following === true) return 'FOLLOWING';
      if (status.outgoing_request === true || status.is_requesting === true) {
        return 'FOLLOW_REQUESTED';
      }
    }

    for (const child of Object.values(value)) {
      const found = visit(child);
      if (found) return found;
    }
    return null;
  }

  return visit(payload);
}

function isInstagramResponse(response: Response): boolean {
  try {
    const host = new URL(response.url()).hostname.toLowerCase();
    return host === 'instagram.com' || host.endsWith('.instagram.com');
  } catch {
    return false;
  }
}

export interface PositiveRelationshipObserver {
  current(): PositiveRelationship | null;
  waitFor(timeoutMs: number): Promise<PositiveRelationship | null>;
  dispose(): void;
}

/** Observa respostas normais da página; não dispara requisições nem ações. */
export function observePositiveProfileRelationship(
  page: Page,
  expectedUsername: string,
): PositiveRelationshipObserver {
  let observed: PositiveRelationship | null = null;
  const waiters = new Set<(value: PositiveRelationship) => void>();

  const handler = (response: Response): void => {
    if (!isInstagramResponse(response) || !response.ok()) return;
    const contentType = response.headers()['content-type'] ?? '';
    if (!contentType.toLowerCase().includes('json')) return;
    void response
      .json()
      .then((payload: unknown) => {
        const found = findPositiveRelationshipForUsername(payload, expectedUsername);
        if (!found) return;
        observed = found;
        for (const resolve of waiters) resolve(found);
        waiters.clear();
      })
      .catch(() => undefined);
  };
  page.on('response', handler);

  return {
    current: () => observed,
    waitFor: async (timeoutMs) => {
      if (observed) return observed;
      return new Promise<PositiveRelationship | null>((resolve) => {
        let settled = false;
        const finish = (value: PositiveRelationship | null): void => {
          if (settled) return;
          settled = true;
          waiters.delete(onObserved);
          clearTimeout(timer);
          resolve(value);
        };
        const onObserved = (value: PositiveRelationship): void => finish(value);
        const timer = setTimeout(() => finish(observed), Math.max(0, timeoutMs));
        waiters.add(onObserved);
      });
    },
    dispose: () => {
      page.off('response', handler);
      waiters.clear();
    },
  };
}
