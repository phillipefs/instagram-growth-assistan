import { createInterface } from 'node:readline/promises';
import type { Confirmer } from '../../workflows/follow.js';

/** Confirmador que não confirma nada (usado em dry-run). */
export const NOOP_CONFIRMER: Confirmer = {
  confirmBatch: () => Promise.resolve(false),
  confirmItem: () => Promise.resolve(false),
  waitForManual: () => Promise.resolve(),
};

/** Confirmação explícita não interativa, usada somente com a flag CLI --yes. */
export const YES_CONFIRMER: Confirmer = {
  confirmBatch: () => Promise.resolve(true),
  confirmItem: () => Promise.resolve(true),
  waitForManual: () => Promise.reject(new Error('--yes não é compatível com modo manual')),
};

/** Confirmador interativo via terminal. */
export class StdinConfirmer implements Confirmer {
  private readonly rl = createInterface({ input: process.stdin, output: process.stdout });

  private async ask(message: string): Promise<boolean> {
    const answer = (await this.rl.question(`${message} [s/N] `)).trim().toLowerCase();
    return answer === 's' || answer === 'sim' || answer === 'y';
  }

  confirmBatch(message: string): Promise<boolean> {
    return this.ask(message);
  }

  confirmItem(message: string): Promise<boolean> {
    return this.ask(message);
  }

  async waitForManual(message: string): Promise<void> {
    await this.rl.question(`${message}\nPressione Enter quando terminar...`);
  }

  close(): void {
    this.rl.close();
  }
}
