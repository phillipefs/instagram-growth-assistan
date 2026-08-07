import type { SafetyState } from '../domain/states.js';
import type { BrowserSession } from '../browser/browser-session.js';
import { assessSession } from '../browser/session-detector.js';
import { readSessionSignals } from '../browser/read-signals.js';
import { assessProfile } from '../browser/profile-detector.js';
import { readProfileSignals } from '../browser/read-profile.js';
import {
  readPostCommenters,
  readPostLikers,
  readRecentPostShortcodes,
  loadAllComments,
} from '../browser/read-posts.js';
import { compareActiveAccount } from '../browser/account-guard.js';
import type { DiscoveredItem } from './collect.js';

const INSTAGRAM_BASE = 'https://www.instagram.com';

export interface CollectOptions {
  readonly targetUrl: string;
  readonly limit: number;
  readonly postsLimit?: number;
  readonly skipPosts?: number;
  readonly includeLikers?: boolean;
  readonly configuredAccount?: string | null;
}

export interface CollectBrowserResult {
  readonly items: DiscoveredItem[];
  readonly postsVisited: number;
  readonly likersUnavailable: number;
  readonly stoppedReason: string | null;
  readonly safetyState: SafetyState;
}

/**
 * Coleta candidatos engajados a partir das publicações recentes do perfil-alvo,
 * em modo somente leitura. Prioriza comentaristas; curtidores são best-effort.
 * Para diante de qualquer estado de segurança ou divergência de conta.
 */
export async function collectFromTarget(
  session: BrowserSession,
  options: CollectOptions,
): Promise<CollectBrowserResult> {
  const page = session.activePage;

  await session.goto(INSTAGRAM_BASE + '/');
  const sessionAssessment = assessSession(await readSessionSignals(page));
  if (sessionAssessment.safetyState !== 'SAFE') {
    return empty(sessionAssessment.safetyState, `sessão não segura: ${sessionAssessment.safetyState}`);
  }
  if (sessionAssessment.sessionStatus !== 'authenticated') {
    return empty('SAFE', 'sessão não autenticada; faça login com session:open');
  }
  if (options.configuredAccount) {
    const comparison = compareActiveAccount(options.configuredAccount, sessionAssessment.activeAccount);
    if (comparison.shouldStop) {
      return empty('ACCOUNT_CHANGED', `conta ativa divergente (${comparison.match})`);
    }
  }

  await session.goto(options.targetUrl);
  const profile = assessProfile(await readProfileSignals(page));
  if (profile.safetyState !== 'SAFE') {
    return empty(profile.safetyState, `perfil-alvo não seguro: ${profile.safetyState}`);
  }
  if (profile.profileType !== 'PUBLIC') {
    return empty('SAFE', `perfil-alvo não coletável: ${profile.profileType}`);
  }

  // Exclui o próprio alvo e a conta ativa dos candidatos coletados.
  const exclude = new Set<string>();
  if (profile.username) {
    exclude.add(profile.username.toLowerCase());
  }
  if (options.configuredAccount) {
    exclude.add(options.configuredAccount.toLowerCase());
  }

  // Pula os primeiros posts do grid (onde ficam os fixados) para que re-execuções
  // peguem publicações mais novas em vez de repetir sempre o post fixado.
  const postsLimit = options.postsLimit ?? 6;
  const skipPosts = Math.max(0, options.skipPosts ?? 0);
  const shortcodes = (await readRecentPostShortcodes(page, postsLimit + skipPosts)).slice(skipPosts);
  const items: DiscoveredItem[] = [];
  const seen = new Set<string>();
  let postsVisited = 0;
  let likersUnavailable = 0;

  for (const shortcode of shortcodes) {
    if (seen.size >= options.limit) {
      break;
    }
    await session.goto(`${INSTAGRAM_BASE}/p/${shortcode}/`);
    postsVisited += 1;
    await loadAllComments(page, { maxRounds: 15 });

    for (const username of await readPostCommenters(page)) {
      if (exclude.has(username)) {
        continue;
      }
      items.push({ username, source: 'RECENT_POST_COMMENTERS', signal: { type: 'COMMENT', mediaShortcode: shortcode } });
      seen.add(username);
    }

    if (options.includeLikers) {
      const likers = await readPostLikers(page);
      if (!likers.accessible) {
        likersUnavailable += 1;
      }
      for (const username of likers.usernames) {
        if (exclude.has(username)) {
          continue;
        }
        items.push({ username, source: 'RECENT_POST_LIKERS', signal: { type: 'LIKE', mediaShortcode: shortcode } });
        seen.add(username);
      }
    }
  }

  return { items, postsVisited, likersUnavailable, stoppedReason: null, safetyState: 'SAFE' };
}

function empty(safetyState: SafetyState, reason: string): CollectBrowserResult {
  return { items: [], postsVisited: 0, likersUnavailable: 0, stoppedReason: reason, safetyState };
}
