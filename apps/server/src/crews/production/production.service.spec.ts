import { BadRequestException, ConflictException } from '@nestjs/common';
import {
  CrewAssetNodeKind,
  CrewAssetNodeStatus,
  CrewEpisodeDeliveryStatus,
  CrewEpisodeStatus,
  CrewProductionResourceKind,
  CrewProductionStatus,
  CrewTaskPriority,
  MediaAssetKind,
  MediaAssetStatus,
  ProjectMemberRole,
  Prisma,
  WorkspaceMemberRole,
} from '@prisma/client';
import {
  CrewProductionDocumentSchema,
  CreateProductionActivitySchema,
  ReviewEpisodeDeliverySchema,
  UpdateProductionDocumentSchema,
} from './production.dto';
import { createDefaultProductionDocument } from './production-document';
import { CrewProductionService } from './production.service';

const CREW_ID = 'crew-1';
const USER_ID = 'owner-1';
const EPISODE_ID = '01910d50-4c88-7c78-92d4-16892c06e001';
const DELIVERY_ID = '01910d50-4c88-7c78-92d4-16892c06e002';
const ASSET_ID = '01910d50-4c88-7c78-92d4-16892c06e003';

function activityDocument(text: string) {
  return {
    type: 'doc' as const,
    content: [
      {
        type: 'paragraph',
        attrs: { id: '01910d50-4c88-7c78-92d4-16892c06e099' },
        content: [{ type: 'text', text }],
      },
    ],
  };
}

function build() {
  const prisma = {
    crewProductionPage: {
      findUnique: jest.fn().mockResolvedValue({ crewId: CREW_ID }),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    crewProductionResource: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      create: jest.fn(),
      delete: jest.fn(),
    },
    crewProductionActivity: {
      findFirst: jest.fn().mockResolvedValue(null),
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn(),
    },
    crewProductionLabelAssignment: {
      findMany: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    crewTaskLabel: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    crewMember: {
      findFirst: jest.fn(),
    },
    crew: {
      findUniqueOrThrow: jest.fn().mockResolvedValue({ studioProject: null }),
      findFirstOrThrow: jest.fn(),
      update: jest.fn(),
    },
    workspaceMember: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    platformProject: {
      findFirst: jest.fn(),
    },
    crewEpisode: {
      findUnique: jest.fn(),
      delete: jest.fn(),
      updateMany: jest.fn(),
      update: jest.fn(),
    },
    crewEpisodeDelivery: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      aggregate: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    crewTask: {
      count: jest.fn(),
    },
    crewAssetNode: {
      findFirst: jest.fn(),
    },
    $executeRaw: jest.fn().mockResolvedValue(1),
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  const authorization = {
    require: jest.fn().mockResolvedValue({
      isOwner: false,
      policyKeys: [],
      permissions: [
        'production.view',
        'production.manage',
        'production.deliver',
        'production.review',
      ],
    }),
  };
  const assetAccess = {
    requireNodePermission: jest.fn().mockResolvedValue(undefined),
  };
  const conversations = {
    broadcastCrewTaskProjectChange: jest.fn().mockResolvedValue(undefined),
  };
  const workspacePermissions = {
    requireProjectRole: jest.fn().mockResolvedValue(undefined),
  };
  return {
    prisma,
    authorization,
    assetAccess,
    conversations,
    workspacePermissions,
    service: new CrewProductionService(
      prisma as never,
      authorization as never,
      assetAccess as never,
      conversations as never,
      workspacePermissions as never,

      { revoke: jest.fn().mockResolvedValue(undefined) } as never,
    ),
  };
}

function episode(overrides: Record<string, unknown> = {}) {
  return {
    id: EPISODE_ID,
    crewId: CREW_ID,
    number: 1,
    title: 'Episode 1',
    synopsis: '',
    status: CrewEpisodeStatus.in_production,
    durationSeconds: null,
    plannedReleaseAt: null,
    rank: { toString: () => '1024' },
    version: 1,
    createdByUserId: USER_ID,
    createdAt: new Date('2026-08-01T12:00:00.000Z'),
    updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    deliveries: [],
    _count: { tasks: 0, deliveries: 0 },
    ...overrides,
  };
}

describe('CrewProductionService', () => {
  it('enables editable team projects even when they already serve a crew workflow', async () => {
    const t = build();
    t.prisma.crew.findUniqueOrThrow.mockResolvedValue({
      studioProjectId: null,
    });
    t.prisma.workspaceMember.findMany.mockResolvedValue([
      {
        role: WorkspaceMemberRole.owner,
        joinedAt: new Date(),
        workspace: {
          id: 'personal-1',
          name: 'Isaac',
          defaultForUserId: 'user-1',
          projects: [
            {
              id: 'project-personal',
              name: 'Personal draft',
              description: null,
              members: [],
              studioCrew: null,
              productionCrew: null,
              crewTaskCanvas: null,
            },
          ],
        },
      },
      {
        role: WorkspaceMemberRole.editor,
        joinedAt: new Date(),
        workspace: {
          id: 'team-1',
          name: 'Animation team',
          defaultForUserId: null,
          projects: [
            {
              id: 'project-team',
              name: 'Episode canvas',
              description: 'Production project',
              members: [{ role: ProjectMemberRole.editor }],
              studioCrew: null,
              productionCrew: { id: 'another-crew' },
              crewTaskCanvas: { id: 'task-canvas' },
            },
          ],
        },
      },
    ]);

    const result = await t.service.studioProjectOptions(CREW_ID, USER_ID);

    expect(result.workspaces).toHaveLength(2);
    expect(result.workspaces[0].projects[0]).toMatchObject({
      selectable: true,
      disabledReason: null,
    });
    expect(result.workspaces[1].projects[0]).toMatchObject({
      selectable: true,
      disabledReason: null,
    });
  });

  it('links a team Studio project without replacing the internal production project', async () => {
    const t = build();
    const projectId = '01910d50-4c88-7c78-92d4-16892c06e010';
    t.prisma.crew.findFirstOrThrow.mockResolvedValue({ studioProjectId: null });
    t.prisma.platformProject.findFirst.mockResolvedValue({
      id: projectId,
      name: 'Episode canvas',
      workspace: {
        id: 'team-1',
        name: 'Animation team',
        defaultForUserId: null,
      },
      studioCrew: null,
      productionCrew: { id: 'another-crew' },
      crewTaskCanvas: { id: 'task-canvas' },
    });

    const result = await t.service.linkStudioProject(CREW_ID, USER_ID, {
      projectId,
    });

    expect(t.prisma.crew.update).toHaveBeenCalledWith({
      where: { id: CREW_ID },
      data: { studioProjectId: projectId },
    });
    expect(result.studioProject).toMatchObject({
      id: projectId,
      name: 'Episode canvas',
    });
  });

  it.each(['crew', 'project'] as const)(
    'rejects a link when %s authority is withdrawn during admission',
    async (scope) => {
      const t = build();
      const check =
        scope === 'crew'
          ? t.authorization.require
          : t.workspacePermissions.requireProjectRole;
      check
        .mockResolvedValueOnce(undefined as never)
        .mockRejectedValueOnce(new Error('Access revoked'));
      await expect(
        t.service.linkStudioProject(CREW_ID, USER_ID, {
          projectId: '01910d50-4c88-7c78-92d4-16892c06e010',
        }),
      ).rejects.toThrow('Access revoked');
      expect(t.prisma.crew.update).not.toHaveBeenCalled();
      expect(t.prisma.crewProductionActivity.create).not.toHaveBeenCalled();
      expect(
        t.conversations.broadcastCrewTaskProjectChange,
      ).not.toHaveBeenCalled();
    },
  );

  it('rejects the transaction and suppresses broadcasts if unlink authority changes during its write', async () => {
    const t = build();
    t.prisma.crew.findFirstOrThrow.mockResolvedValue({
      studioProjectId: 'old-project',
    });
    t.prisma.crew.update.mockImplementation(() => {
      t.authorization.require.mockRejectedValue(new Error('Access revoked'));
    });
    await expect(
      t.service.linkStudioProject(CREW_ID, USER_ID, { projectId: null }),
    ).rejects.toThrow('Access revoked');
    expect(
      t.conversations.broadcastCrewTaskProjectChange,
    ).not.toHaveBeenCalled();
  });

  it.each([
    ['en-US', 'Production goal'],
    ['zh-CN', '制作目标'],
    ['zh-HK', '製作目標'],
  ] as const)(
    'creates a valid, editable %s production template',
    (locale, expectedHeading) => {
      const document = createDefaultProductionDocument(locale);
      const content = document.content as Prisma.InputJsonObject[];

      expect(CrewProductionDocumentSchema.safeParse(document).success).toBe(
        true,
      );
      expect(content.map((node) => node.type)).toEqual([
        'heading',
        'paragraph',
        'heading',
        'table',
        'heading',
        'bulletList',
        'heading',
        'paragraph',
      ]);
      expect(JSON.stringify(document)).toContain(expectedHeading);
    },
  );

  it('returns the canonical project metadata, resources, and latest update', async () => {
    const t = build();
    t.prisma.crewProductionPage.findUniqueOrThrow.mockResolvedValue({
      crewId: CREW_ID,
      document: createDefaultProductionDocument(),
      version: 1,
      status: CrewProductionStatus.backlog,
      priority: null,
      leadMemberId: null,
      startDate: null,
      startDateGranularity: 'day',
      targetDate: null,
      targetDateGranularity: 'day',
      metadataVersion: 1,
      createdByUserId: USER_ID,
      updatedByUserId: USER_ID,
      createdAt: new Date('2026-08-01T12:00:00.000Z'),
      updatedAt: new Date('2026-08-01T12:00:00.000Z'),
    });

    const overview = await t.service.overview(CREW_ID, USER_ID);

    expect(overview.capabilities).toEqual({
      manage: true,
      linkWorkspace: false,
    });
    expect(overview.project).toMatchObject({
      status: CrewProductionStatus.backlog,
      priority: null,
      leadMemberId: null,
      startDate: null,
      startDateGranularity: 'day',
      targetDate: null,
      targetDateGranularity: 'day',
      version: 1,
    });
    expect(overview.resources).toEqual([]);
    expect(overview.latestUpdate).toBeNull();
    expect(overview).not.toHaveProperty('metrics');
    expect(t.prisma.crewTask.count).not.toHaveBeenCalled();
  });

  it('keeps project comments and progress updates as distinct activity contracts', () => {
    expect(
      CreateProductionActivitySchema.safeParse({
        kind: 'comment',
        content: activityDocument('The opening shot is ready for review.'),
      }).success,
    ).toBe(true);
    expect(
      CreateProductionActivitySchema.safeParse({
        kind: 'update',
        health: 'on_track',
        content: activityDocument('Episode one moved into rough cut.'),
        progress: 45,
      }).success,
    ).toBe(true);
    expect(
      CreateProductionActivitySchema.safeParse({
        kind: 'comment',
        health: 'on_track',
        content: activityDocument('Comments do not carry project health.'),
      }).success,
    ).toBe(false);
    expect(
      CreateProductionActivitySchema.safeParse({
        kind: 'comment',
        content: activityDocument('   '),
      }).success,
    ).toBe(false);
  });

  it('updates project properties with independent optimistic versioning', async () => {
    const t = build();
    t.prisma.crewProductionPage.updateMany.mockResolvedValue({ count: 1 });
    t.prisma.crewProductionPage.findUniqueOrThrow.mockResolvedValue({
      crewId: CREW_ID,
      status: CrewProductionStatus.in_progress,
      priority: CrewTaskPriority.high,
      leadMemberId: null,
      startDate: new Date('2026-08-15T00:00:00.000Z'),
      startDateGranularity: 'day',
      targetDate: new Date('2026-09-01T00:00:00.000Z'),
      targetDateGranularity: 'day',
      metadataVersion: 4,
      updatedByUserId: USER_ID,
      updatedAt: new Date('2026-08-02T12:00:00.000Z'),
    });

    const result = await t.service.updateProperties(CREW_ID, USER_ID, {
      expectedVersion: 3,
      status: CrewProductionStatus.in_progress,
      priority: CrewTaskPriority.high,
      startDate: '2026-08-15',
      targetDate: '2026-09-01',
    });

    expect(t.prisma.crewProductionPage.updateMany).toHaveBeenCalledWith({
      where: { crewId: CREW_ID, metadataVersion: 3 },
      data: {
        status: CrewProductionStatus.in_progress,
        priority: CrewTaskPriority.high,
        leadMemberId: undefined,
        startDate: new Date('2026-08-15T00:00:00.000Z'),
        startDateGranularity: undefined,
        targetDate: new Date('2026-09-01T00:00:00.000Z'),
        targetDateGranularity: undefined,
        metadataVersion: { increment: 1 },
        updatedByUserId: USER_ID,
      },
    });
    expect(result.project.version).toBe(4);
    expect(result.project.startDate).toBe('2026-08-15');
  });

  it('rejects a target date before the project start date', async () => {
    const t = build();
    t.prisma.crewProductionPage.findUniqueOrThrow.mockResolvedValue({
      startDate: new Date('2026-09-01T00:00:00.000Z'),
      startDateGranularity: 'day',
      targetDate: null,
      targetDateGranularity: 'day',
    });

    await expect(
      t.service.updateProperties(CREW_ID, USER_ID, {
        expectedVersion: 1,
        targetDate: '2026-08-31',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.prisma.crewProductionPage.updateMany).not.toHaveBeenCalled();
  });

  it('rejects project dates that are not canonical for their time granularity', async () => {
    const t = build();
    t.prisma.crewProductionPage.findUniqueOrThrow.mockResolvedValue({
      startDate: null,
      startDateGranularity: 'day',
      targetDate: null,
      targetDateGranularity: 'day',
    });

    await expect(
      t.service.updateProperties(CREW_ID, USER_ID, {
        expectedVersion: 1,
        startDate: '2026-08-15',
        startDateGranularity: 'month',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(t.prisma.crewProductionPage.updateMany).not.toHaveBeenCalled();
  });

  it('accepts a coarse target period when it contains the exact start date', async () => {
    const t = build();
    t.prisma.crewProductionPage.updateMany.mockResolvedValue({ count: 1 });
    t.prisma.crewProductionPage.findUniqueOrThrow
      .mockResolvedValueOnce({
        startDate: new Date('2026-09-09T00:00:00.000Z'),
        startDateGranularity: 'day',
        targetDate: null,
        targetDateGranularity: 'day',
      })
      .mockResolvedValueOnce({
        crewId: CREW_ID,
        status: CrewProductionStatus.planned,
        priority: null,
        leadMemberId: null,
        startDate: new Date('2026-09-09T00:00:00.000Z'),
        startDateGranularity: 'day',
        targetDate: new Date('2026-09-01T00:00:00.000Z'),
        targetDateGranularity: 'month',
        metadataVersion: 2,
        updatedByUserId: USER_ID,
        updatedAt: new Date('2026-08-02T12:00:00.000Z'),
      });

    const result = await t.service.updateProperties(CREW_ID, USER_ID, {
      expectedVersion: 1,
      targetDate: '2026-09-01',
      targetDateGranularity: 'month',
    });

    expect(result.project.targetDateGranularity).toBe('month');
  });

  it('derives a stable title when an external resource omits one', async () => {
    const t = build();
    t.prisma.crewProductionResource.create.mockResolvedValue({
      id: ASSET_ID,
    });
    t.prisma.crewProductionResource.findUniqueOrThrow.mockResolvedValue({
      id: ASSET_ID,
      crewId: CREW_ID,
      kind: CrewProductionResourceKind.link,
      title: 'linear.app/project/reference',
      url: 'https://linear.app/project/reference/',
      assetNodeId: null,
      createdByUserId: USER_ID,
      createdAt: new Date('2026-08-02T12:00:00.000Z'),
      updatedAt: new Date('2026-08-02T12:00:00.000Z'),
      assetNode: null,
    });

    await t.service.createResource(CREW_ID, USER_ID, {
      kind: 'link',
      url: 'https://linear.app/project/reference/',
    });

    expect(t.prisma.crewProductionResource.create).toHaveBeenCalledWith({
      data: {
        crewId: CREW_ID,
        kind: CrewProductionResourceKind.link,
        title: 'linear.app/project/reference',
        url: 'https://linear.app/project/reference/',
        assetNodeId: null,
        createdByUserId: USER_ID,
      },
    });
  });

  it.each([
    ['100%', '100%'],
    ['%E0%A4', '%E0%A4'],
    ['hello%20world', 'hello world'],
  ])('derives a title for URL path %s', async (path, title) => {
    const t = build();
    t.prisma.crewProductionResource.create.mockResolvedValue({
      id: ASSET_ID,
    });
    t.prisma.crewProductionResource.findUniqueOrThrow.mockResolvedValue({
      id: ASSET_ID,
      crewId: CREW_ID,
      kind: CrewProductionResourceKind.link,
      title: `linear.app/${title}`,
      url: `https://linear.app/${path}`,
      assetNodeId: null,
      createdByUserId: USER_ID,
      createdAt: new Date('2026-08-02T12:00:00.000Z'),
      updatedAt: new Date('2026-08-02T12:00:00.000Z'),
      assetNode: null,
    });

    await t.service.createResource(CREW_ID, USER_ID, {
      kind: 'link',
      url: `https://linear.app/${path}`,
    });

    expect(t.prisma.crewProductionResource.create).toHaveBeenCalledWith({
      data: {
        crewId: CREW_ID,
        kind: CrewProductionResourceKind.link,
        title: `linear.app/${title}`,
        url: `https://linear.app/${path}`,
        assetNodeId: null,
        createdByUserId: USER_ID,
      },
    });
  });

  it('requires an actionable note when a final cut is rejected', () => {
    expect(
      ReviewEpisodeDeliverySchema.safeParse({ decision: 'reject', note: '' })
        .success,
    ).toBe(false);
    expect(
      ReviewEpisodeDeliverySchema.safeParse({
        decision: 'reject',
        note: 'Replace the temp audio before resubmitting.',
      }).success,
    ).toBe(true);
  });

  it('does not allow a completed episode to be manually reopened', async () => {
    const t = build();
    t.prisma.crewEpisode.findUnique.mockResolvedValue(
      episode({ status: CrewEpisodeStatus.completed }),
    );

    await expect(
      t.service.updateEpisode(EPISODE_ID, USER_ID, {
        expectedVersion: 1,
        status: CrewEpisodeStatus.in_production,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.prisma.crewEpisode.updateMany).not.toHaveBeenCalled();
  });

  it('preserves episode history by refusing to delete a non-empty episode', async () => {
    const t = build();
    t.prisma.crewEpisode.findUnique.mockResolvedValue(
      episode({ _count: { tasks: 1, deliveries: 0 } }),
    );

    await expect(
      t.service.deleteEpisode(EPISODE_ID, USER_ID),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.prisma.crewEpisode.delete).not.toHaveBeenCalled();
  });

  it('allows only one final cut to await review at a time', async () => {
    const t = build();
    t.prisma.crewEpisode.findUnique.mockResolvedValue(episode());
    t.prisma.crewAssetNode.findFirst.mockResolvedValue({
      id: ASSET_ID,
      crewId: CREW_ID,
      kind: CrewAssetNodeKind.file,
      status: CrewAssetNodeStatus.active,
      mediaAsset: {
        kind: MediaAssetKind.video,
        status: MediaAssetStatus.ready,
      },
    });
    t.prisma.crewEpisodeDelivery.aggregate.mockResolvedValue({
      _max: { versionNumber: 1 },
    });
    t.prisma.crewEpisodeDelivery.findFirst.mockResolvedValue({
      id: DELIVERY_ID,
      versionNumber: 1,
    });

    await expect(
      t.service.submitDelivery(EPISODE_ID, USER_ID, {
        assetNodeId: ASSET_ID,
        note: 'Second cut',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.prisma.crewEpisodeDelivery.create).not.toHaveBeenCalled();
  });

  it('blocks final approval while linked production tasks remain incomplete', async () => {
    const t = build();
    t.prisma.crewEpisodeDelivery.findUnique.mockResolvedValue({
      id: DELIVERY_ID,
      crewId: CREW_ID,
      episodeId: EPISODE_ID,
    });
    t.prisma.crewEpisodeDelivery.findUniqueOrThrow.mockResolvedValue({
      id: DELIVERY_ID,
      crewId: CREW_ID,
      episodeId: EPISODE_ID,
      status: CrewEpisodeDeliveryStatus.submitted,
    });
    t.prisma.crewTask.count.mockResolvedValue(2);

    await expect(
      t.service.reviewDelivery(DELIVERY_ID, USER_ID, {
        decision: 'approve',
        note: '',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.prisma.crewEpisodeDelivery.update).not.toHaveBeenCalled();
    expect(t.prisma.crewEpisode.update).not.toHaveBeenCalled();
  });

  it('validates the exact Tiptap document schema', () => {
    const valid = {
      expectedVersion: 1,
      document: {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            attrs: { id: '01910d50-4c88-7c78-92d4-16892c06e004' },
            content: [{ type: 'text', text: 'Production brief' }],
          },
          {
            type: 'codeBlock',
            attrs: {
              id: '01910d50-4c88-7c78-92d4-16892c06e005',
              language: null,
            },
            content: [{ type: 'text', text: 'renderProduction();' }],
          },
        ],
      },
    };
    expect(UpdateProductionDocumentSchema.safeParse(valid).success).toBe(true);
    expect(
      UpdateProductionDocumentSchema.safeParse({
        expectedVersion: 2,
        document: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: {
                id: '01910d50-4c88-7c78-92d4-16892c06e006',
                textAlign: null,
                backgroundColor: null,
                nodeTextAlign: null,
                nodeVerticalAlign: null,
                indent: 0,
              },
              content: [
                {
                  type: 'text',
                  text: 'Production plan',
                  marks: [
                    {
                      type: 'textStyle',
                      attrs: { color: 'var(--tt-color-text-blue)' },
                    },
                  ],
                },
                { type: 'emoji', attrs: { name: 'clapper' } },
              ],
            },
            {
              type: 'table',
              attrs: { id: '01910d50-4c88-7c78-92d4-16892c06e007' },
              content: [
                {
                  type: 'tableRow',
                  content: [
                    {
                      type: 'tableCell',
                      attrs: {
                        backgroundColor: null,
                        nodeTextAlign: null,
                        nodeVerticalAlign: null,
                        colspan: 1,
                        rowspan: 1,
                        colwidth: null,
                        align: null,
                      },
                      content: [
                        {
                          type: 'paragraph',
                          attrs: {
                            id: '01910d50-4c88-7c78-92d4-16892c06e008',
                            textAlign: null,
                            backgroundColor: null,
                            nodeTextAlign: null,
                            nodeVerticalAlign: null,
                            indent: 0,
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      }).success,
    ).toBe(true);
    expect(
      UpdateProductionDocumentSchema.safeParse({
        ...valid,
        document: {
          type: 'doc',
          content: [
            {
              type: 'episodeDatabase',
              attrs: {
                id: '01910d50-4c88-7c78-92d4-16892c06e005',
                layout: 'table',
              },
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      UpdateProductionDocumentSchema.safeParse({
        ...valid,
        document: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { id: '01910d50-4c88-7c78-92d4-16892c06e004' },
              content: [
                {
                  type: 'text',
                  text: 'unsafe',
                  marks: [
                    {
                      type: 'link',
                      attrs: { href: 'javascript:alert(1)' },
                    },
                  ],
                },
              ],
            },
          ],
        },
      }).success,
    ).toBe(false);
    expect(
      UpdateProductionDocumentSchema.safeParse({
        ...valid,
        document: {
          type: 'doc',
          content: [
            {
              type: 'codeBlock',
              attrs: {
                id: '01910d50-4c88-7c78-92d4-16892c06e005',
                language: null,
              },
              content: [
                {
                  type: 'text',
                  text: 'const value = 1;',
                  marks: [{ type: 'bold' }],
                },
              ],
            },
          ],
        },
      }).success,
    ).toBe(false);
  });

  it('updates the document with optimistic concurrency', async () => {
    const t = build();
    t.prisma.crewProductionPage.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      t.service.updateDocument(CREW_ID, USER_ID, {
        expectedVersion: 1,
        document: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              attrs: { id: '01910d50-4c88-7c78-92d4-16892c06e004' },
            },
          ],
        },
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(
      t.prisma.crewProductionPage.findUniqueOrThrow,
    ).not.toHaveBeenCalled();
  });
});
