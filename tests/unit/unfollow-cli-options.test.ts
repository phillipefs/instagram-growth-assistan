import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import {
  parseUnfollowFilters,
  registerUnfollowPlanCommands,
  type UnfollowOptions,
} from '../../src/cli/commands/unfollow-plan-commands.js';

function parsedOptions(commandName: 'plan-unfollow' | 'plan:create-unfollow', args: string[]) {
  const program = new Command();
  registerUnfollowPlanCommands(program);
  const command = program.commands.find((candidate) => candidate.name() === commandName);
  if (!command) {
    throw new Error(`Comando não registrado: ${commandName}`);
  }
  command.parseOptions(args);
  return command.opts() as UnfollowOptions;
}

describe('--no-follow-back-after', () => {
  it.each(['plan-unfollow', 'plan:create-unfollow'] as const)(
    'preserva o argumento de dias em %s apesar do prefixo reservado --no-',
    (commandName) => {
      const options = parsedOptions(commandName, ['--no-follow-back-after', '6']);

      expect(options.followBackAfter).toBe('6');
      expect(parseUnfollowFilters(options)).toEqual({
        noFollowBackAfterDays: 6,
        excludeFollowers: true,
      });
    },
  );

  it('não cria filtro quando a opção não foi informada', () => {
    const options = parsedOptions('plan:create-unfollow', []);

    expect(options.followBackAfter).toBeUndefined();
    expect(parseUnfollowFilters(options)).toEqual({});
  });
});
