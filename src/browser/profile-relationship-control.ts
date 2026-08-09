import type { Locator, Page } from 'playwright';
import { FOLLOW_BUTTON_TEXT, profileLocators } from '../instagram/profile-locators.js';
import type { FollowButtonState } from './profile-detector.js';

const STATES: readonly FollowButtonState[] = ['FOLLOWING', 'REQUESTED', 'FOLLOW'];
const SUGGESTIONS_TEXT =
  /^(suggestions for you|suggested for you|suggested accounts|sugestões para (você|ti)|sugestoes para (voce|ti)|contas sugeridas|sugerencias para ti)$/i;

export interface PrimaryRelationshipControl {
  readonly locator: Locator;
  readonly state: FollowButtonState;
}

function canonicalUsername(value: string): string {
  return value.trim().replace(/^@/, '').toLowerCase();
}

async function resolveUsername(page: Page, expectedUsername?: string): Promise<Locator | null> {
  const usernames = page.locator(profileLocators.username);
  const matches: Locator[] = [];
  for (let index = 0; index < (await usernames.count()); index += 1) {
    const candidate = usernames.nth(index);
    if (!(await candidate.isVisible())) {
      continue;
    }
    const text = (await candidate.textContent())?.trim();
    if (!text) {
      continue;
    }
    if (!expectedUsername || canonicalUsername(text) === canonicalUsername(expectedUsername)) {
      matches.push(candidate);
    }
  }
  return matches.length === 1 ? matches[0]! : null;
}

/**
 * Confirma que o candidato pertence ao bloco primário do perfil, não a um
 * cartão de "Sugestões para você" que também vive dentro do <header> real.
 */
async function belongsToPrimaryProfileArea(
  candidate: Locator,
  expectedUsername: string,
): Promise<boolean> {
  // Esta callback é serializada pelo Playwright e executada na página. Evite
  // helpers locais nomeados: o `tsx` pode reescrevê-los para `__name`, que não
  // existe no contexto do navegador.
  return candidate.evaluate(
    (button, input) => {
      const header = button.closest('header');
      if (!header) {
        return false;
      }
      const view = button.ownerDocument.defaultView;
      const usernameNodes = (
        Array.from(header.querySelectorAll(input.usernameSelector)) as Array<typeof button>
      ).filter((node) => {
        const style = view?.getComputedStyle(node);
        return (
          node.getClientRects().length > 0 &&
          style?.display !== 'none' &&
          style?.visibility !== 'hidden' &&
          (node.textContent ?? '').trim().replace(/^@/, '').toLowerCase() === input.expectedUsername
        );
      });
      if (usernameNodes.length !== 1) {
        return false;
      }
      const usernameNode = usernameNodes[0]!;

      // Defesa 1: qualquer controle depois do título de sugestões pertence a
      // um cartão sugerido, mesmo quando o Instagram o inclui no mesmo header.
      const suggestions = new RegExp(input.suggestionsSource, 'i');
      const afterSuggestions = (
        Array.from(header.querySelectorAll('*')) as Array<typeof button>
      ).some((node) => {
        const style = view?.getComputedStyle(node);
        const exactText = (node.textContent ?? '').trim().replace(/\s+/g, ' ');
        return (
          node.getClientRects().length > 0 &&
          style?.display !== 'none' &&
          style?.visibility !== 'hidden' &&
          suggestions.test(exactText) &&
          (node.compareDocumentPosition(button) & 4) !== 0
        );
      });
      if (afterSuggestions) {
        return false;
      }

      // Defesa 2: no card sugerido, o ancestral mais próximo contém um link
      // simples para outro username. A linha primária aponta para o próprio alvo.
      let ancestor = button.parentElement;
      while (ancestor && ancestor !== header) {
        const linkedUsernames = new Set<string>();
        for (const link of Array.from(ancestor.querySelectorAll('a[href]')) as Array<
          typeof button
        >) {
          const href = link.getAttribute('href');
          if (!href) {
            continue;
          }
          let path: string;
          try {
            path = href.startsWith('/')
              ? href.split(/[?#]/, 1)[0]!
              : new URL(href, button.ownerDocument.baseURI).pathname;
          } catch {
            continue;
          }
          const segments = path.split('/').filter(Boolean);
          if (segments.length === 1) {
            linkedUsernames.add(
              decodeURIComponent(segments[0]!).trim().replace(/^@/, '').toLowerCase(),
            );
          }
        }
        if (linkedUsernames.size === 1) {
          return linkedUsernames.has(input.expectedUsername);
        }
        if (linkedUsernames.size > 1) {
          break;
        }
        ancestor = ancestor.parentElement;
      }

      // Defesa 3: limita ao menor ancestral do username que também contém
      // as estatísticas do perfil. Destaques e sugestões ficam fora desse bloco.
      let profileArea = usernameNode.parentElement;
      while (profileArea) {
        const text = (profileArea.textContent ?? '').replace(/\s+/g, ' ');
        // `textContent` do Instagram concatena spans adjacentes sem espaço
        // (ex.: "9 posts122 seguidores864 seguindo"). Não use `\b` aqui.
        const hasPosts = /(posts?|publica(?:ções|coes))/i.test(text);
        const hasFollowers = /(followers?|seguidores?)/i.test(text);
        const hasFollowing = /(following|seguindo)/i.test(text);
        if (hasPosts && hasFollowers && hasFollowing) {
          if (profileArea.contains(button)) {
            return true;
          }
        }
        if (profileArea === header) {
          break;
        }
        profileArea = profileArea.parentElement;
      }

      // Fallback visual conservador para variações sem links/estatísticas:
      // o controle primário fica próximo ao heading; cards sugeridos ficam abaixo.
      const usernameBox = usernameNode.getBoundingClientRect();
      const buttonBox = button.getBoundingClientRect();
      return Math.abs(buttonBox.top - usernameBox.top) <= 220;
    },
    {
      expectedUsername: canonicalUsername(expectedUsername),
      usernameSelector: profileLocators.username,
      suggestionsSource: SUGGESTIONS_TEXT.source,
    },
  );
}

/** Resolve, por estrutura, o único controle de relacionamento do perfil-alvo. */
export async function resolvePrimaryRelationshipControl(
  page: Page,
  expectedUsername?: string,
): Promise<PrimaryRelationshipControl | null> {
  const username = await resolveUsername(page, expectedUsername);
  if (!username) {
    return null;
  }
  const usernameText = (await username.textContent())?.trim();
  if (!usernameText) {
    return null;
  }
  const canonicalExpected = canonicalUsername(expectedUsername ?? usernameText);
  const header = username.locator('xpath=ancestor::header[1]');
  if ((await header.count()) !== 1 || !(await header.isVisible())) {
    return null;
  }

  // Hook determinístico de fixtures. Ainda precisa estar no header ancorado ao
  // username correto; o DOM real segue pelo caminho acessível abaixo.
  const hooks = header.locator(profileLocators.followButton);
  if ((await hooks.count()) === 1) {
    const hook = hooks.first();
    const state = await hook.getAttribute('data-state');
    if (
      STATES.includes(state as FollowButtonState) &&
      (await hook.isVisible()) &&
      (await belongsToPrimaryProfileArea(hook, canonicalExpected))
    ) {
      return { locator: hook, state: state as FollowButtonState };
    }
    // Compatibilidade apenas para fixtures locais antigas, que não reproduzem
    // as estatísticas completas. Em página real nunca relaxa a ligação estrutural.
    const localFixture = page.url().startsWith('file:') || page.url() === 'about:blank';
    if (localFixture && STATES.includes(state as FollowButtonState) && (await hook.isVisible())) {
      return { locator: hook, state: state as FollowButtonState };
    }
    return null;
  }
  if ((await hooks.count()) > 1) {
    return null;
  }

  const controls: PrimaryRelationshipControl[] = [];
  for (const state of STATES) {
    const candidates = header.getByRole('button', { name: FOLLOW_BUTTON_TEXT[state] });
    for (let index = 0; index < (await candidates.count()); index += 1) {
      const candidate = candidates.nth(index);
      if (
        (await candidate.isVisible()) &&
        (await belongsToPrimaryProfileArea(candidate, canonicalExpected))
      ) {
        controls.push({ locator: candidate, state });
      }
    }
  }
  return controls.length === 1 ? controls[0]! : null;
}
