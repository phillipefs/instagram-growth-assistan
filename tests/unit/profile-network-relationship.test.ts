import { describe, expect, it } from 'vitest';
import {
  findPositiveRelationshipForUsername,
  findPositiveRelationshipInFollowMutation,
} from '../../src/browser/profile-network-relationship.js';

describe('findPositiveRelationshipForUsername', () => {
  it('confirma following somente para o username exato', () => {
    const payload = {
      data: {
        edges: [
          { node: { user: { username: 'sugestao', friendship_status: { following: true } } } },
          {
            node: {
              user: {
                username: 'Alvo.Exato',
                friendship_status: { following: true, outgoing_request: false },
              },
            },
          },
        ],
      },
    };
    expect(findPositiveRelationshipForUsername(payload, 'alvo.exato')).toBe('FOLLOWING');
    expect(findPositiveRelationshipForUsername(payload, 'outro')).toBeNull();
  });

  it('confirma solicitação enviada e nunca interpreta flags falsas', () => {
    expect(
      findPositiveRelationshipForUsername(
        { user: { username: 'privado', friendship_status: { outgoing_request: true } } },
        'privado',
      ),
    ).toBe('FOLLOW_REQUESTED');
    expect(
      findPositiveRelationshipForUsername(
        {
          user: {
            username: 'nao_confirmado',
            friendship_status: { following: false, outgoing_request: false },
          },
        },
        'nao_confirmado',
      ),
    ).toBeNull();
  });
});

describe('findPositiveRelationshipInFollowMutation', () => {
  it('aceita friendship_status sem username no endpoint de mutação', () => {
    expect(
      findPositiveRelationshipInFollowMutation({
        friendship_status: { following: true, outgoing_request: false },
      }),
    ).toBe('FOLLOWING');
    expect(
      findPositiveRelationshipInFollowMutation({
        friendship_status: { following: false, outgoing_request: true },
      }),
    ).toBe('FOLLOW_REQUESTED');
  });
});
