import { StorySourceMaterialDomainService } from './story-source-material-domain.service';
import {
  buildStorySourceMaterialIndex,
  STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION,
} from './story-source-material-index';

const ATTACHMENT_ID = '0197f4a2-0800-7000-8000-000000000009';

describe('StorySourceMaterialDomainService', () => {
  it('re-authorizes the Story scope and returns only bounded source chunks', async () => {
    const permissions = {
      requireProjectInTransaction: jest.fn().mockResolvedValue({
        project: { workspaceId: '0197f4a2-0800-7000-8000-000000000001' },
      }),
    };
    const text = Array.from({ length: 2_000 }, (_, index) =>
      index === 1_500
        ? '林夕：祖母留下的蓝色钥匙藏在旧火车站的钟后面。'
        : `场景 ${index}。角色继续沿着既定路线前进。`,
    ).join('\n');
    const contentHash = 'a'.repeat(64);
    const documentIndex = buildStorySourceMaterialIndex({
      text,
      fileName: 'script.txt',
      contentHash,
    });
    const findFirst = jest.fn(
      (input: {
        where: {
          id: string;
          conversationId: string;
          ownerActorId: string;
        };
        select: Record<string, boolean>;
      }) => {
        expect(input.where).toMatchObject({
          id: ATTACHMENT_ID,
          conversationId: '0197f4a2-0800-7000-8000-000000000004',
          ownerActorId: 'actor-1',
        });
        expect(input.select).toMatchObject({
          documentText: true,
          documentIndex: true,
          documentIndexVersion: true,
          contentHash: true,
        });
        return {
          id: ATTACHMENT_ID,
          fileName: 'script.txt',
          documentText: text,
          documentCharCount: text.length,
          contentHash,
          documentIndex,
          documentIndexVersion: STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION,
        };
      },
    );
    const tx = {
      agentPlatformAttachment: {
        findFirst,
      },
    };
    const service = new StorySourceMaterialDomainService(permissions as never);
    const result = await service.query(tx as never, request(), {
      schemaVersion: 'story-source-material-query/v1',
      attachmentId: ATTACHMENT_ID,
      mode: 'search',
      query: '祖母的蓝色钥匙',
      limit: 4,
    });

    expect(permissions.requireProjectInTransaction).toHaveBeenCalledWith(
      tx,
      'actor-1',
      '0197f4a2-0800-7000-8000-000000000003',
      'story.read',
    );
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') throw new Error('Expected success.');
    const payload = result.data as {
      chunks: Array<{ text: string }>;
      source: unknown;
      overview: unknown;
    };
    expect(payload.chunks[0]?.text).toContain('蓝色钥匙');
    expect(
      payload.chunks.reduce((total, chunk) => total + chunk.text.length, 0),
    ).toBeLessThanOrEqual(24_000);
    expect(payload.overview).toBeNull();
    expect(JSON.stringify(payload.source).length).toBeLessThan(2_000);
  });

  it('does not expose attachments outside the signed conversation', async () => {
    const permissions = {
      requireProjectInTransaction: jest.fn().mockResolvedValue({
        project: { workspaceId: '0197f4a2-0800-7000-8000-000000000001' },
      }),
    };
    const tx = {
      agentPlatformAttachment: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    };
    const service = new StorySourceMaterialDomainService(permissions as never);

    await expect(
      service.query(tx as never, request(), {
        schemaVersion: 'story-source-material-query/v1',
        attachmentId: ATTACHMENT_ID,
        mode: 'overview',
        limit: 5,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('returns a bounded final artifact only after exhaustive source coverage', async () => {
    const permissions = {
      requireProjectInTransaction: jest.fn().mockResolvedValue({
        project: { workspaceId: '0197f4a2-0800-7000-8000-000000000001' },
      }),
    };
    const text = exactLengthStory(65_000);
    const contentHash = 'b'.repeat(64);
    const documentIndex = buildStorySourceMaterialIndex({
      text,
      fileName: 'feature.txt',
      contentHash,
    });
    const chunkIds = documentIndex.chunks.map((chunk) => chunk.id);
    const quote = text.slice(
      documentIndex.chunks[0].start,
      documentIndex.chunks[0].start + 40,
    );
    const tx = {
      agentPlatformAttachment: {
        findFirst: jest.fn().mockResolvedValue({
          id: ATTACHMENT_ID,
          fileName: 'feature.txt',
          documentCharCount: text.length,
          contentHash,
          documentIndex,
          documentIndexVersion: STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION,
          analysisJobs: [
            {
              id: '0197f4a2-0800-7000-8000-000000000010',
              analysisVersion: 'story-document-analysis/v1',
              sourceContentHash: contentHash,
              status: 'succeeded',
              stage: 'completed',
              completedUnits: 44,
              totalUnits: 44,
              error: null,
              artifacts: [
                {
                  id: '0197f4a2-0800-7000-8000-000000000011',
                  sourceChunkIds: chunkIds,
                  content: {
                    schemaVersion: 'agent-document-final-analysis/v1',
                    executiveSummary: 'The complete screenplay was analyzed.',
                    sourceCoverage: {
                      chunkCount: chunkIds.length,
                      analyzedChunkCount: chunkIds.length,
                      missingChunkIds: [],
                    },
                    storyStructure: [
                      {
                        label: 'Opening movement',
                        analysis: 'x'.repeat(1_500),
                        evidence: [{ chunkId: chunkIds[0], quote }],
                      },
                    ],
                    characters: [],
                    locations: [],
                    plotThreads: [],
                    continuityFindings: [],
                    themes: [],
                    productionRecommendations: [],
                  },
                },
              ],
            },
          ],
        }),
      },
    };
    const service = new StorySourceMaterialDomainService(permissions as never);

    const result = await service.analysis(tx as never, request(), {
      schemaVersion: 'story-source-analysis-query/v1',
      attachmentId: ATTACHMENT_ID,
      lens: 'overview',
      limit: 8,
    });

    expect(result.status).toBe('succeeded');
    if (result.status !== 'succeeded') throw new Error('Expected success.');
    const serialized = JSON.stringify(result.data);
    expect(Buffer.byteLength(serialized)).toBeLessThanOrEqual(64 * 1024);
    expect(result.data).toMatchObject({
      status: 'ready',
      source: {
        contentHash,
        characterCount: 65_000,
        chunkCount: chunkIds.length,
      },
      analysis: {
        sourceCoverage: {
          chunkCount: chunkIds.length,
          analyzedChunkCount: chunkIds.length,
          missingChunkIds: [],
        },
        findings: [
          {
            category: 'storyStructure',
            label: 'Opening movement',
            evidence: [{ chunkId: chunkIds[0], quote }],
          },
        ],
      },
    });
    const projected = result.data as {
      analysis: { findings: Array<{ analysis: string }> };
    };
    expect(projected.analysis.findings[0]?.analysis.length).toBe(900);
  });

  it('returns durable progress instead of pretending an unfinished analysis is complete', async () => {
    const permissions = {
      requireProjectInTransaction: jest.fn().mockResolvedValue({
        project: { workspaceId: '0197f4a2-0800-7000-8000-000000000001' },
      }),
    };
    const text = exactLengthStory(65_000);
    const contentHash = 'c'.repeat(64);
    const documentIndex = buildStorySourceMaterialIndex({
      text,
      fileName: 'feature.txt',
      contentHash,
    });
    const tx = {
      agentPlatformAttachment: {
        findFirst: jest.fn().mockResolvedValue({
          id: ATTACHMENT_ID,
          fileName: 'feature.txt',
          documentCharCount: text.length,
          contentHash,
          documentIndex,
          documentIndexVersion: STORY_SOURCE_MATERIAL_INDEX_SCHEMA_VERSION,
          analysisJobs: [
            {
              id: '0197f4a2-0800-7000-8000-000000000010',
              analysisVersion: 'story-document-analysis/v1',
              sourceContentHash: contentHash,
              status: 'running',
              stage: 'mapping',
              completedUnits: 7,
              totalUnits: 44,
              error: null,
              artifacts: [],
            },
          ],
        }),
      },
    };
    const service = new StorySourceMaterialDomainService(permissions as never);

    await expect(
      service.analysis(tx as never, request(), {
        schemaVersion: 'story-source-analysis-query/v1',
        attachmentId: ATTACHMENT_ID,
        lens: 'overview',
        limit: 8,
      }),
    ).resolves.toMatchObject({
      status: 'succeeded',
      data: {
        status: 'processing',
        progress: {
          stage: 'mapping',
          completedUnits: 7,
          totalUnits: 44,
          percent: 15,
        },
        analysis: null,
      },
    });
  });
});

function request() {
  return {
    schemaVersion: 'agent-tool-request/v2' as const,
    actor: {
      id: 'actor-1',
      displayName: 'Actor One',
      roles: ['creator'],
      permissions: ['story.read'],
    },
    scope: {
      surface: 'story-studio' as const,
      conversationId: '0197f4a2-0800-7000-8000-000000000004',
      sessionName: 'agent:v1:conversation:0197f4a2-0800-7000-8000-000000000004',
      kind: 'story-project' as const,
      workspaceId: '0197f4a2-0800-7000-8000-000000000001',
      projectId: '0197f4a2-0800-7000-8000-000000000003',
    },
    arguments: {},
  };
}

function exactLengthStory(characterCount: number): string {
  const heading = 'INT. STUDIO - DAY\n\n';
  const paragraph =
    'A character enters, makes a consequential choice, and changes the story. ';
  let text = heading;
  while (text.length + paragraph.length <= characterCount) text += paragraph;
  return text + 'x'.repeat(characterCount - text.length);
}
