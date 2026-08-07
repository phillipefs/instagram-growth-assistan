import { createHash } from 'node:crypto';

/**
 * Serializa um valor de forma estável (chaves de objeto ordenadas), preservando
 * a ordem de arrays. Útil para gerar hashes determinísticos de critérios.
 */
export function stableStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalize);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return Object.fromEntries(entries.map(([k, v]) => [k, normalize(v)]));
  }
  return value;
}

/** Hash sha256 determinístico de um objeto (independe da ordem das chaves). */
export function hashObject(value: unknown): string {
  return createHash('sha256').update(stableStringify(value)).digest('hex');
}
