/**
 * Janelas de tempo para coortes de unfollow.
 *
 * Diferencia janela móvel (últimos/há mais de N dias) de mês de calendário
 * (`YYYY-MM`). Todas as datas são tratadas em UTC.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MONTH_RE = /^\d{4}-\d{2}$/;

export interface UnfollowFilters {
  readonly olderThanDays?: number;
  /** Exige espera mínima e observação de follow-back após esse prazo. */
  readonly noFollowBackAfterDays?: number;
  readonly followedWithinDays?: number;
  readonly from?: string;
  readonly to?: string;
  readonly calendarMonth?: string;
  readonly excludeFollowers?: boolean;
  readonly limit?: number;
}

export interface CohortWindow {
  readonly fromIso?: string;
  readonly toIso?: string;
  readonly label: string;
}

function assertValidDate(value: string): void {
  if (!DATE_RE.test(value) || Number.isNaN(new Date(`${value}T00:00:00.000Z`).getTime())) {
    throw new Error(`Data inválida (esperado YYYY-MM-DD): ${value}`);
  }
}

export function startOfUtcDay(day: string): string {
  assertValidDate(day);
  return `${day}T00:00:00.000Z`;
}

export function endOfUtcDay(day: string): string {
  assertValidDate(day);
  return `${day}T23:59:59.999Z`;
}

export function calendarMonthRange(month: string): { fromIso: string; toIso: string } {
  if (!MONTH_RE.test(month)) {
    throw new Error(`Mês inválido (esperado YYYY-MM): ${month}`);
  }
  const [yearText, monthText] = month.split('-');
  const year = Number.parseInt(yearText as string, 10);
  const monthIndex = Number.parseInt(monthText as string, 10) - 1;
  if (monthIndex < 0 || monthIndex > 11) {
    throw new Error(`Mês inválido: ${month}`);
  }
  const from = new Date(Date.UTC(year, monthIndex, 1));
  const to = new Date(Date.UTC(year, monthIndex + 1, 1) - 1);
  return { fromIso: from.toISOString(), toIso: to.toISOString() };
}

export function subtractDays(now: Date, days: number): string {
  return new Date(now.getTime() - days * 86_400_000).toISOString();
}

/**
 * Deriva a janela `{fromIso, toIso}` a partir dos filtros. Mês de calendário tem
 * precedência; datas explícitas vêm antes das janelas móveis.
 */
export function computeUnfollowWindow(
  filters: UnfollowFilters,
  now: Date = new Date(),
): CohortWindow {
  if (
    filters.noFollowBackAfterDays !== undefined &&
    (!Number.isInteger(filters.noFollowBackAfterDays) || filters.noFollowBackAfterDays <= 0)
  ) {
    throw new Error('noFollowBackAfterDays exige um número inteiro positivo de dias.');
  }
  if (filters.olderThanDays !== undefined && filters.noFollowBackAfterDays !== undefined) {
    throw new Error('Use olderThanDays ou noFollowBackAfterDays, não ambos.');
  }
  if (filters.calendarMonth) {
    const range = calendarMonthRange(filters.calendarMonth);
    return {
      fromIso: range.fromIso,
      toIso: range.toIso,
      label: `mês de calendário ${filters.calendarMonth}`,
    };
  }

  let fromIso: string | undefined;
  let toIso: string | undefined;
  const parts: string[] = [];

  if (filters.from) {
    fromIso = startOfUtcDay(filters.from);
    parts.push(`de ${filters.from}`);
  }
  if (filters.to) {
    toIso = endOfUtcDay(filters.to);
    parts.push(`até ${filters.to}`);
  }
  if (fromIso === undefined && filters.followedWithinDays !== undefined) {
    fromIso = subtractDays(now, filters.followedWithinDays);
    parts.push(`seguidos nos últimos ${filters.followedWithinDays} dias`);
  }
  const minimumAgeDays = filters.noFollowBackAfterDays ?? filters.olderThanDays;
  if (toIso === undefined && minimumAgeDays !== undefined) {
    toIso = subtractDays(now, minimumAgeDays);
    parts.push(
      filters.noFollowBackAfterDays !== undefined
        ? `sem follow-back após ${minimumAgeDays} dias`
        : `seguidos há mais de ${minimumAgeDays} dias`,
    );
  }

  return {
    ...(fromIso ? { fromIso } : {}),
    ...(toIso ? { toIso } : {}),
    label: parts.length > 0 ? parts.join(', ') : 'sem janela (todos os follows da ferramenta)',
  };
}
