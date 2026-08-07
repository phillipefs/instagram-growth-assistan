import fs from 'node:fs';
import { chromium, type BrowserContext, type Page } from 'playwright';
import { resolveDataPaths } from '../config/paths.js';
import { compareActiveAccount, type AccountComparison } from './account-guard.js';
import { readSessionSignals, type ReadSignalsOptions } from './read-signals.js';
import { assessSession, type SessionAssessment, type SessionSignals } from './session-detector.js';
import { readProfileSignals } from './read-profile.js';
import { assessProfile, type ProfileAssessment, type ProfileSignals } from './profile-detector.js';

const INSTAGRAM_URL = 'https://www.instagram.com/';

export interface BrowserSessionOptions {
  readonly profileDir?: string;
  readonly visible?: boolean;
}

export interface SessionReport {
  readonly assessment: SessionAssessment;
  readonly account: AccountComparison | null;
  readonly signals: SessionSignals;
}

export interface ProfileReport {
  readonly requestedUrl: string;
  readonly finalUrl: string;
  readonly assessment: ProfileAssessment;
  readonly signals: ProfileSignals;
}

/**
 * Sessão Playwright local com ciclo de vida previsível.
 *
 * Usa um contexto persistente exclusivo deste projeto, navegador visível e
 * login manual. Nunca preenche credenciais nem usa o perfil pessoal padrão.
 */
export class BrowserSession {
  private constructor(
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  static async open(options: BrowserSessionOptions = {}): Promise<BrowserSession> {
    const profileDir = options.profileDir ?? resolveDataPaths().browserProfile;
    fs.mkdirSync(profileDir, { recursive: true });
    const context = await chromium.launchPersistentContext(profileDir, {
      headless: options.visible === false,
      viewport: null,
    });
    const page = context.pages()[0] ?? (await context.newPage());
    return new BrowserSession(context, page);
  }

  get activePage(): Page {
    return this.page;
  }

  async goto(url: string = INSTAGRAM_URL): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
    // O Instagram é um SPA: aguardar a renderização assentar antes de ler.
    await this.page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
    await this.page.waitForTimeout(600);
  }

  /** Lê sinais e classifica a sessão, comparando com a conta configurada. */
  async assess(
    configuredAccount: string | null = null,
    readOptions?: ReadSignalsOptions,
  ): Promise<SessionReport> {
    const signals = await readSessionSignals(this.page, readOptions);
    const assessment = assessSession(signals);
    const account = configuredAccount
      ? compareActiveAccount(configuredAccount, assessment.activeAccount)
      : null;
    return { assessment, account, signals };
  }

  /** Abre um perfil e o reconhece em modo somente leitura (sem cliques). */
  async inspectProfile(url: string, readOptions?: ReadSignalsOptions): Promise<ProfileReport> {
    await this.goto(url);
    const signals = await readProfileSignals(this.page, readOptions);
    const assessment = assessProfile(signals);
    return { requestedUrl: url, finalUrl: this.page.url(), assessment, signals };
  }

  /** Aguarda o usuário fechar o navegador (usado no login manual). */
  async waitUntilClosed(): Promise<void> {
    await this.context.waitForEvent('close');
  }
  async close(): Promise<void> {
    await this.context.close();
  }
}
/**
 * Apaga o diretório de perfil local. Operação destrutiva; a CLI exige confirmação.
 */
export function clearBrowserProfile(profileDir?: string): string {
  const dir = profileDir ?? resolveDataPaths().browserProfile;
  fs.rmSync(dir, { recursive: true, force: true });
  return dir;
}
