import type { Page, Response } from 'playwright';
import type { ObservedRelationship } from './profile-detector.js';

type PositiveRelationship = Extract<ObservedRelationship, 'FOLLOWING' | 'FOLLOW_REQUESTED'>;

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

/** Usa somente respostas comprovadamente originadas pelo endpoint de follow. */
export function findPositiveRelationshipInFollowMutation(
  payload: unknown,
): PositiveRelationship | null {
  function visit(value: unknown): PositiveRelationship | null {
    if (Array.isArray(value)) {
      for (const item of value) {
        const found = visit(item);
        if (found) return found;
      }
      return null;
    }
    if (!isRecord(value)) return null;
    if (isRecord(value.friendship_status)) {
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

function isFollowMutationResponse(response: Response): boolean {
  if (response.request().method().toUpperCase() !== 'POST') return false;
  try {
    const pathname = new URL(response.url()).pathname.toLowerCase();
    if (/\/friendships\/(?:create\/[^/]+|[^/]+\/follow)\/?$/.test(pathname)) {
      return true;
    }
    if (pathname !== '/api/graphql') return false;
    const params = new URLSearchParams(response.request().postData() ?? '');
    const friendlyName = params.get('fb_api_req_friendly_name') ?? '';
    return (
      /(?:follow.*mutation|mutation.*follow)/i.test(friendlyName) && !/unfollow/i.test(friendlyName)
    );
  } catch {
    return false;
  }
}

function responseDiagnostic(response: Response): string {
  const url = new URL(response.url());
  if (url.pathname !== '/api/graphql') return `${response.status()} ${url.pathname}`;
  const params = new URLSearchParams(response.request().postData() ?? '');
  const friendlyName = params.get('fb_api_req_friendly_name');
  return `${response.status()} ${url.pathname}${friendlyName ? ` (${friendlyName})` : ''}`;
}

function payloadShape(value: unknown, prefix = '', depth = 0, output: string[] = []): string {
  if (depth > 4 || output.length >= 30 || !isRecord(value)) return output.join('|');
  for (const [key, child] of Object.entries(value)) {
    if (output.length >= 30) break;
    const path = prefix ? `${prefix}.${key}` : key;
    output.push(path);
    if (isRecord(child)) payloadShape(child, path, depth + 1, output);
  }
  return output.join('|');
}

function graphqlErrorSummary(payload: unknown): string | null {
  if (!isRecord(payload) || !Array.isArray(payload.errors)) return null;
  const summaries = payload.errors.slice(0, 3).map((error) => {
    if (!isRecord(error)) return 'erro sem detalhes';
    const parts: string[] = [];
    for (const key of ['message', 'code', 'api_error_code', 'summary', 'severity']) {
      const value = error[key];
      if (typeof value === 'string' || typeof value === 'number') {
        parts.push(`${key}=${String(value).slice(0, 200)}`);
      }
    }
    return parts.join(' ') || 'erro sem detalhes';
  });
  return summaries.join(' | ');
}

export interface PositiveRelationshipObserver {
  current(): PositiveRelationship | null;
  failure(): string | null;
  diagnostic(): string | null;
  waitFor(timeoutMs: number): Promise<PositiveRelationship | null>;
  dispose(): void;
}

/** Observa respostas normais da página; não dispara requisições nem ações. */
export function observePositiveProfileRelationship(
  page: Page,
  expectedUsername: string,
): PositiveRelationshipObserver {
  let observed: PositiveRelationship | null = null;
  let failure: string | null = null;
  const postsObserved: string[] = [];
  const waiters = new Set<(value: PositiveRelationship) => void>();

  const handler = (response: Response): void => {
    if (!isInstagramResponse(response)) return;
    if (response.request().method().toUpperCase() === 'POST' && postsObserved.length < 8) {
      try {
        postsObserved.push(responseDiagnostic(response));
      } catch {
        // URL inválida não participa do diagnóstico.
      }
    }
    const followMutation = isFollowMutationResponse(response);
    if (!response.ok()) {
      if (followMutation) failure = `endpoint de follow respondeu HTTP ${response.status()}`;
      return;
    }
    const contentType = response.headers()['content-type'] ?? '';
    if (!contentType.toLowerCase().includes('json') && !followMutation) return;
    void response
      .json()
      .then((payload: unknown) => {
        const found =
          findPositiveRelationshipForUsername(payload, expectedUsername) ??
          (followMutation ? findPositiveRelationshipInFollowMutation(payload) : null);
        if (!found) {
          if (followMutation) {
            const graphqlError = graphqlErrorSummary(payload);
            failure = graphqlError
              ? `mutação GraphQL rejeitada: ${graphqlError}`
              : `mutação de follow sem estado positivo; campos=${payloadShape(payload) || 'nenhum'}`;
          }
          return;
        }
        observed = found;
        for (const resolve of waiters) resolve(found);
        waiters.clear();
      })
      .catch(() => undefined);
  };
  page.on('response', handler);

  return {
    current: () => observed,
    failure: () => failure,
    diagnostic: () => (postsObserved.length > 0 ? postsObserved.join(', ') : null),
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
