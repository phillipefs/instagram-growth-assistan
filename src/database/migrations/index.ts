import type { Migration } from '../migrator.js';
import { migration001 } from './001_initial_schema.js';
import { migration002 } from './002_discovery_and_engagement.js';

/** Todas as migrações conhecidas, em ordem de versão. */
export const MIGRATIONS: readonly Migration[] = [migration001, migration002];
