import {
  CrewManagementArgumentsSchema,
  CrewReadArgumentsSchema,
  StoryApplyArgumentsSchema,
  StoryReadArgumentsSchema,
} from './agent-domain-tool.schemas';

describe('Agent Domain tool contracts', () => {
  it('defaults bounded Story pagination and rejects unknown fields', () => {
    expect(
      StoryReadArgumentsSchema.parse({ schemaVersion: 'story-read/v2' }),
    ).toEqual({
      schemaVersion: 'story-read/v2',
      nodeLimit: 50,
      includeStoryBible: true,
      includeAssets: false,
    });
    expect(
      StoryReadArgumentsSchema.safeParse({
        schemaVersion: 'story-read/v2',
        untrusted: true,
      }).success,
    ).toBe(false);
  });

  it('accepts one atomic Story change set with interdependent nodes', () => {
    expect(
      StoryApplyArgumentsSchema.safeParse({
        schemaVersion: 'story-apply/v1',
        changeSet: {
          schemaVersion: 'story-change-set/v2',
          chapterId: '0197f4a2-0800-7000-8000-000000000002',
          baseDraftRevision: 7,
          baseContentHash: 'a'.repeat(64),
          baseLayoutRevision: 4,
          title: 'Add arrival',
          summary: 'Adds and links the new arrival scene atomically.',
          operations: [
            {
              kind: 'story_graph.put_node',
              payload: {
                intent: 'create',
                node: {
                  kind: 'clip',
                  nodeId: 'xinyi_arrival',
                  clipKey: 'XINYI_ARRIVAL',
                  description: 'Xinyi arrives.',
                  exit: { kind: 'auto', nextNodeId: null },
                },
              },
            },
            {
              kind: 'story_graph.put_node',
              payload: {
                intent: 'replace',
                node: {
                  kind: 'clip',
                  nodeId: 'intro_night',
                  clipKey: 'INTRO_NIGHT',
                  description: 'Night.',
                  exit: { kind: 'auto', nextNodeId: 'xinyi_arrival' },
                },
              },
            },
          ],
        },
      }).success,
    ).toBe(true);
  });

  it('requires episode scope for paginated assignment and activity reads', () => {
    expect(
      CrewReadArgumentsSchema.safeParse({
        schemaVersion: 'crew-read/v2',
        section: 'assignments',
      }).success,
    ).toBe(false);
    expect(
      CrewReadArgumentsSchema.safeParse({
        schemaVersion: 'crew-read/v2',
        section: 'assignments',
        episodeId: 'episode-1',
      }).success,
    ).toBe(true);
  });

  it('uses reviewable applications instead of accepting unverifiable user ids', () => {
    const envelope = {
      schemaVersion: 'crew-management-command/v2',
      baseRevision: 3,
      reason: 'The owner approved the submitted application.',
    };
    expect(
      CrewManagementArgumentsSchema.safeParse({
        ...envelope,
        command: {
          type: 'crew.application.approve',
          applicationId: 'application-1',
        },
      }).success,
    ).toBe(true);
    expect(
      CrewManagementArgumentsSchema.safeParse({
        ...envelope,
        command: {
          type: 'crew.member.add',
          userId: 'unverified-user',
          roleType: 'director',
        },
      }).success,
    ).toBe(false);
  });
});
