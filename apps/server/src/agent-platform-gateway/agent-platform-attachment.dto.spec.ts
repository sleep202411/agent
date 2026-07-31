import {
  AgentAttachmentRegisterRequestSchema,
  AgentAttachmentResolveRequestSchema,
  agentAttachmentUri,
} from './agent-platform-attachment.dto';

const CONVERSATION_ID = '0197f4a2-0800-7000-8000-000000000004';
const ATTACHMENT_ID = '0197f4a2-0800-7000-8000-000000000009';

describe('Agent Platform attachment contracts', () => {
  it('accepts a canonical registration and stable internal URI', () => {
    expect(
      AgentAttachmentRegisterRequestSchema.parse({
        schemaVersion: 'agent-attachment-register/v1',
        conversationId: CONVERSATION_ID,
        mediaAssetId: ATTACHMENT_ID,
        fileName: '  剧本.md  ',
        locale: 'zh-cn',
      }),
    ).toMatchObject({
      fileName: '剧本.md',
      locale: 'zh-CN',
    });
    expect(agentAttachmentUri(ATTACHMENT_ID)).toBe(
      `fizzdragon-media://${ATTACHMENT_ID}`,
    );
  });

  it('rejects duplicate IDs and a session that is not conversation-derived', () => {
    expect(
      AgentAttachmentResolveRequestSchema.safeParse({
        schemaVersion: 'agent-attachment-resolve/v1',
        actor: { id: 'actor-1', displayName: 'Actor' },
        scope: {
          surface: 'crew-management',
          conversationId: CONVERSATION_ID,
          sessionName: 'agent:v1:conversation:different',
          kind: 'crew',
          crewId: 'crew-1',
        },
        locale: 'en-US',
        attachmentIds: [ATTACHMENT_ID, ATTACHMENT_ID],
      }).success,
    ).toBe(false);
  });

  it('rejects control characters in display filenames', () => {
    expect(
      AgentAttachmentRegisterRequestSchema.safeParse({
        schemaVersion: 'agent-attachment-register/v1',
        conversationId: CONVERSATION_ID,
        mediaAssetId: ATTACHMENT_ID,
        fileName: 'unsafe\nname.md',
        locale: 'en-US',
      }).success,
    ).toBe(false);
  });
});
