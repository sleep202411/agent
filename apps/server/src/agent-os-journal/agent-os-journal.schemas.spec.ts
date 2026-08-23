import { AgentOsStartCommandSchema } from './agent-os-journal.schemas';

const ATTACHMENT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

function command(overrides: Record<string, unknown> = {}) {
  return {
    runId: '11111111-1111-4111-8111-111111111111',
    clientSubmissionId: '22222222-2222-4222-8222-222222222222',
    submissionFingerprint: 'a'.repeat(64),
    turnId: '33333333-3333-4333-8333-333333333333',
    messageId: '44444444-4444-4444-8444-444444444444',
    projectId: '55555555-5555-4555-8555-555555555555',
    conversationId: '66666666-6666-4666-8666-666666666666',
    actorId: 'actor-1',
    message: 'Create a scene',
    modelProfileId: 'qwen-plus',
    permissionMode: 'smart',
    projectKind: 'story',
    workbenchMode: 'story',
    workbenchContext: {
      chapterId: '77777777-7777-4777-8777-777777777777',
    },
    skillMountSnapshot: {
      schemaVersion: 'project-skill-resolution/v1',
      resolutionId: '88888888-8888-4888-8888-888888888888',
      ownerKind: 'story',
      projectId: '55555555-5555-4555-8555-555555555555',
      projectRevision: 1,
      scope: 'agent_prompt',
      workbenchMode: 'story',
      sourceSurface: 'agent_os:story',
      resolvedAt: '2026-08-21T12:00:00.000Z',
      skills: [],
      checksum: 'b'.repeat(64),
    },
    ...overrides,
  };
}

describe('AgentOsStartCommandSchema', () => {
  it('accepts an attachment-only turn with matching ordered summaries', () => {
    expect(
      AgentOsStartCommandSchema.parse(
        command({
          message: '',
          attachmentIds: [ATTACHMENT_ID],
          attachments: [{ id: ATTACHMENT_ID, filename: 'screenplay.pdf' }],
        }),
      ),
    ).toMatchObject({
      submissionFingerprint: 'a'.repeat(64),
      message: '',
      attachmentIds: [ATTACHMENT_ID],
    });
  });

  it('rejects divergent attachment identity and display metadata', () => {
    const result = AgentOsStartCommandSchema.safeParse(
      command({
        attachmentIds: [ATTACHMENT_ID],
        attachments: [
          {
            id: '99999999-9999-4999-8999-999999999999',
            filename: 'other.pdf',
          },
        ],
      }),
    );
    expect(result.success).toBe(false);
  });
});
