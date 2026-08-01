import { AgentDomainToolRequestSchema } from './agent-domain.dto';

const CONVERSATION_ID = '0197f4a2-0800-7000-8000-000000000004';

describe('Agent Domain request identity', () => {
  it('binds the business scope to the immutable conversation session', () => {
    expect(
      AgentDomainToolRequestSchema.parse({
        schemaVersion: 'agent-tool-request/v2',
        arguments: { schemaVersion: 'crew-read/v2' },
        actor: {
          id: 'actor-1',
          displayName: 'Actor One',
          roles: ['crew.admin'],
          permissions: ['crew.read'],
        },
        scope: {
          surface: 'crew-management',
          conversationId: CONVERSATION_ID,
          sessionName: `agent:v1:conversation:${CONVERSATION_ID}`,
          kind: 'crew',
          crewId: 'crew-1',
        },
      }),
    ).toMatchObject({
      scope: {
        conversationId: CONVERSATION_ID,
        crewId: 'crew-1',
      },
    });
  });

  it('rejects a session that does not match its conversation id', () => {
    expect(
      AgentDomainToolRequestSchema.safeParse({
        schemaVersion: 'agent-tool-request/v2',
        arguments: {},
        actor: {
          id: 'actor-1',
          displayName: 'Actor One',
          roles: [],
          permissions: [],
        },
        scope: {
          surface: 'crew-management',
          conversationId: CONVERSATION_ID,
          sessionName:
            'agent:v1:conversation:0197f4a2-0800-7000-8000-000000000005',
          kind: 'crew',
          crewId: 'crew-1',
        },
      }).success,
    ).toBe(false);
  });
});
