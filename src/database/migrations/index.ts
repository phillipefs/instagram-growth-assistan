import type { Migration } from '../migrator.js';
import { migration001 } from './001_initial_schema.js';
import { migration002 } from './002_discovery_and_engagement.js';
import { migration003 } from './003_action_reconciliations.js';
import { migration004 } from './004_target_observations.js';

/** Todas as migrações conhecidas, em ordem de versão. */
export const MIGRATIONS: readonly Migration[] = [
  migration001,
  migration002,
  migration003,
  migration004,
];
