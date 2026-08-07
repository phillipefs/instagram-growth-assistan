import { randomUUID } from 'node:crypto';

/** Gera um identificador único para linhas do banco. */
export function newId(): string {
  return randomUUID();
}

/** Timestamp atual em ISO 8601 (UTC). O armazenamento é sempre em UTC. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Converte booleano para inteiro (SQLite não aceita boolean como bind). */
export function boolToInt(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

/** Converte inteiro do SQLite para booleano. */
export function intToBool(value: number | null | undefined): boolean {
  return value === 1;
}

/** Normaliza um username para comparação/deduplicação. */
export function canonicalUsername(username: string): string {
  return username.trim().replace(/^@/, '').toLowerCase();
}
