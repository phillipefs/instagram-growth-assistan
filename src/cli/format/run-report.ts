import type { Run } from '../../database/repositories/runs.js';
import type { ActionState } from '../../domain/states.js';
import type { BatchProgress } from '../../workflows/execution.js';

export interface RunReportItem {
  readonly username: string;
  readonly state: ActionState;
  readonly result: string | null;
  readonly screenshotPath: string | null;
}

export interface RunReportInput {
  readonly run: Run;
  readonly items: readonly RunReportItem[];
}

const STATE_ICON: Record<ActionState, string> = {
  PREPARED: '·',
  PENDING: '·',
  CONFIRMED: '✓',
  AMBIGUOUS: '?',
  FAILED: '✗',
  SKIPPED: '–',
};

const PROGRESS_LABEL: Record<BatchProgress['outcome'], string> = {
  CONFIRMED: 'confirmado ✓',
  SKIPPED: 'pulado',
  IDEMPOTENT_SKIP: 'já feito',
  REVIEW: 'revisar',
  AMBIGUOUS: 'ambíguo ?',
  FAILED: 'falha ✗',
  STOP: 'parou',
};

/**
 * Linha de progresso (uma por item) para acompanhar um lote em andamento.
 * Ex.: `  [ 12/100] @fulano — confirmado ✓  (ok: 10, pulados: 2)`.
 */
export function formatProgressLine(p: BatchProgress): string {
  const pos = `${p.processed}/${p.total}`.padStart(7);
  return `  [${pos}] @${p.targetEntityId} — ${PROGRESS_LABEL[p.outcome]}  (ok: ${p.confirmed}, pulados: ${p.skipped})`;
}

/** Formata a duração entre dois instantes ISO como `XmYYs` ou `Ys`. */
export function formatDuration(startIso: string | null, endIso: string | null): string {
  if (!startIso || !endIso) {
    return '—';
  }
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (!Number.isFinite(ms) || ms < 0) {
    return '—';
  }
  const totalSeconds = Math.round(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${seconds.toString().padStart(2, '0')}s` : `${seconds}s`;
}

/**
 * Relatório human-readable consolidado de uma execução: cabeçalho, contadores
 * derivados do estado das tentativas e a lista de itens com evidência.
 */
export function formatRunReport(input: RunReportInput): string {
  const { run, items } = input;
  const counts = { CONFIRMED: 0, AMBIGUOUS: 0, FAILED: 0, SKIPPED: 0, PENDING: 0 };
  for (const item of items) {
    switch (item.state) {
      case 'CONFIRMED':
        counts.CONFIRMED += 1;
        break;
      case 'AMBIGUOUS':
        counts.AMBIGUOUS += 1;
        break;
      case 'FAILED':
        counts.FAILED += 1;
        break;
      case 'SKIPPED':
        counts.SKIPPED += 1;
        break;
      default:
        counts.PENDING += 1;
        break;
    }
  }

  const lines: string[] = [];
  lines.push(`Run ${run.id} — ${run.type} (${run.mode})`);
  lines.push(`Status:  ${run.status}`);
  lines.push(`Início:  ${run.startedAt ?? '—'}`);
  lines.push(`Fim:     ${run.endedAt ?? '—'}`);
  lines.push(`Duração: ${formatDuration(run.startedAt, run.endedAt)}`);
  if (run.planId) {
    lines.push(`Plano:   ${run.planId}`);
  }
  if (run.stopReason) {
    lines.push(`Parada:  ${run.stopReason}`);
  }
  lines.push('');
  lines.push('Resultados:');
  lines.push(`  confirmados: ${counts.CONFIRMED}`);
  lines.push(`  ambíguos:    ${counts.AMBIGUOUS}`);
  lines.push(`  falhas:      ${counts.FAILED}`);
  lines.push(`  pulados:     ${counts.SKIPPED}`);
  if (counts.PENDING > 0) {
    lines.push(`  pendentes:   ${counts.PENDING}`);
  }

  if (items.length > 0) {
    lines.push('');
    lines.push('Itens:');
    for (const item of items) {
      const icon = STATE_ICON[item.state];
      const detail = item.result ? ` — ${item.result}` : '';
      const evidence = item.screenshotPath ? ` [evidência: ${item.screenshotPath}]` : '';
      lines.push(`  ${icon} ${item.state.padEnd(9)} @${item.username}${detail}${evidence}`);
    }
  }

  return lines.join('\n');
}
