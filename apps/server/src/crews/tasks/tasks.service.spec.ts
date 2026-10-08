import { CrewTaskPriority, CrewTaskStatus, Prisma } from '@prisma/client';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import * as Y from 'yjs';
import {
  ListCrewTaskOptionsQuerySchema,
  ListCrewTasksQuerySchema,
} from './project-dto';
import { CrewTasksService } from './tasks.service';
import * as cardApproval from './card-approval';

const CREW_ID = 'crew-1';
const TASK_ID = '01910d50-4c88-7c78-92d4-16892c06a010';
const OWNER_ID = 'owner-1';
const ASSIGNEE_ID = 'member-1';
const PRODUCTION_PROJECT_ID = '01910d50-4c88-7c78-92d4-16892c06a040';
const PRODUCTION_DOCUMENT_ID = '01910d50-4c88-7c78-92d4-16892c06a041';
const PRODUCTION_VERSION_ID = '01910d50-4c88-7c78-92d4-16892c06a042';
const WORKFLOW_STATE_IDS: Record<CrewTaskStatus, string> = {
  open: '01910d50-4c88-7c78-92d4-16892c06b001',
  in_progress: '01910d50-4c88-7c78-92d4-16892c06b002',
  submitted: '01910d50-4c88-7c78-92d4-16892c06b003',
  revision_requested: '01910d50-4c88-7c78-92d4-16892c06b004',
  approved: '01910d50-4c88-7c78-92d4-16892c06b005',
  cancelled: '01910d50-4c88-7c78-92d4-16892c06b006',
};

function workflowState(status: CrewTaskStatus) {
  return {
    id: WORKFLOW_STATE_IDS[status],
    crewId: CREW_ID,
    name: status,
    color: '#8B919B',
    semantic: status,
    systemKey: status,
    position: 0,
    archived: false,
    version: 1,
    createdByUserId: OWNER_ID,
    createdAt: new Date('2026-07-29T09:00:00.000Z'),
    updatedAt: new Date('2026-07-29T09:00:00.000Z'),
  };
}

function taskCanvasStates() {
  const production = new Y.Doc();
  const productionNode = new Y.Map<string>();
  productionNode.set('id', 'main-node');
  production.getMap('nodes').set('main-node', productionNode);
  const productionState = Y.encodeStateAsUpdate(production);

  const branch = new Y.Doc();
  Y.applyUpdate(branch, productionState);
  const branchNode = new Y.Map<string>();
  branchNode.set('id', 'task-node');
  branch.getMap('nodes').set('task-node', branchNode);
  const branchState = Y.encodeStateAsUpdate(branch);

  production.destroy();
  branch.destroy();
  return {
    productionState: Buffer.from(productionState),
    branchState: Buffer.from(branchState),
  };
}

const CANVAS_STATES = taskCanvasStates();

function firstCallArgument<T>(mockFn: { mock: { calls: unknown[][] } }): T {
  const value = mockFn.mock.calls.at(0)?.at(0);
  if (value === undefined) throw new Error('Expected the mock to be called.');
  return value as T;
}

function task(overrides: Record<string, unknown> = {}) {
  const { status: statusOverride, ...taskOverrides } = overrides;
  const status =
    (statusOverride as CrewTaskStatus | undefined) ?? CrewTaskStatus.submitted;
  return {
    id: TASK_ID,
    crewId: CREW_ID,
    number: 10,
    title: 'Finish SC.010 storyboard',
    description: 'Deliver the revised sequence.',
    workflowStateId: WORKFLOW_STATE_IDS[status],
    workflowState: workflowState(status),
    priority: CrewTaskPriority.high,
    startAt: null,
    dueAt: null,
    estimatePoints: 5,
    computeBudgetPoints: 500,
    revisionLimit: 2,
    revisionRoundsUsed: 0,
    parentId: null,
    cycleId: null,
    rank: new Prisma.Decimal(10240),
    version: 1,
    canvasProjectId: '01910d50-4c88-7c78-92d4-16892c06a011',
    canvasDocumentId: '01910d50-4c88-7c78-92d4-16892c06a012',
    createdByUserId: OWNER_ID,
    approvedByUserId: null,
    submittedAt: new Date('2026-07-29T09:30:00.000Z'),
    approvedAt: null,
    cancelledAt: null,
    createdAt: new Date('2026-07-29T09:00:00.000Z'),
    updatedAt: new Date('2026-07-29T09:30:00.000Z'),
    crew: {
      ownership: { member: { userId: OWNER_ID } },
      productionProjectId: PRODUCTION_PROJECT_ID,
    },
    parent: null,
    children: [],
    cycle: null,
    labels: [],
    assignees: [
      {
        id: 'assignee-1',
        taskId: TASK_ID,
        crewMemberId: 'crew-member-1',
        userId: ASSIGNEE_ID,
        currency: 'USD',
        rewardAmountMinor: 120000n as bigint | null,
        assignedAt: new Date('2026-07-29T09:00:00.000Z'),
      },
    ],
    submissions: [
      {
        id: 'submission-1',
        taskId: TASK_ID,
        versionNumber: 1,
        submittedByUserId: ASSIGNEE_ID,
        note: 'Ready for review.',
        canvasVersionId: '01910d50-4c88-7c78-92d4-16892c06a013',
        productionVersionId: null,
        reviewNote: null,
        reviewedByUserId: null,
        reviewedAt: null,
        mergedAt: null,
        createdAt: new Date('2026-07-29T09:30:00.000Z'),
        canvasVersion: {
          id: '01910d50-4c88-7c78-92d4-16892c06a013',
          documentId: '01910d50-4c88-7c78-92d4-16892c06a012',
          versionNumber: 2,
          schemaVersion: '2026-05-27',
          sequence: 1,
          title: 'Task canvas',
          label: 'Task submission v1',
          source: 'manual',
          sourceId: TASK_ID,
          snapshot: {},
          crdtState: CANVAS_STATES.branchState,
          metadata: {},
          createdById: ASSIGNEE_ID,
          createdAt: new Date('2026-07-29T09:30:00.000Z'),
          document: {
            collaborationDialect: 'fizzdragon.document.v1',
          },
        },
        assets: [],
      },
    ],
    dependenciesAsBlocked: [],
    dependenciesAsBlocker: [],
    customFieldValues: [],
    timelineItems: [],
    ...taskOverrides,
  };
}

function build() {
  const current = task();
  const approved = task({
    status: CrewTaskStatus.approved,
    approvedByUserId: OWNER_ID,
    approvedAt: new Date('2026-07-29T10:00:00.000Z'),
    updatedAt: new Date('2026-07-29T10:00:00.000Z'),
  });
  const tx = {
    crewApplication: { findFirst: jest.fn().mockResolvedValue(null) },
    crewAssetNode: { findFirst: jest.fn().mockResolvedValue({ id: TASK_ID }) },
    crewTaskCommitment: { findFirst: jest.fn().mockResolvedValue(null) },
    crewParticipationRecord: { findFirst: jest.fn().mockResolvedValue(null) },
    $queryRaw: jest.fn().mockImplementation((query: Prisma.Sql) =>
      Promise.resolve(
        query.sql?.includes('SELECT d.crdt_state')
          ? [
              {
                crdt_state: CANVAS_STATES.productionState,
                content_snapshot: {
                  nodes: { 'main-node': { id: 'main-node' } },
                },
                snapshot_sequence: 0,
                current_sequence: 0,
                updates: [],
                unsupported_sequence: null,
              },
            ]
          : [],
      ),
    ),
    $executeRaw: jest.fn().mockResolvedValue(1),
    crewMember: {
      findMany: jest
        .fn()
        .mockResolvedValue([{ id: 'crew-member-1', userId: ASSIGNEE_ID }]),
    },
    crewPosition: { findMany: jest.fn().mockResolvedValue([]) },
    crewTaskAssignee: {
      deleteMany: jest.fn(),
      update: jest.fn(),
      create: jest.fn(),
    },
    crewTaskSubmission: {
      update: jest.fn().mockResolvedValue({}),
    },
    crewTask: {
      findUniqueOrThrow: jest.fn().mockResolvedValue(current),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(approved),
      updateMany: jest.fn(),
      count: jest.fn().mockResolvedValue(0),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    crewTaskDependency: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    crewTaskFieldDefinition: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    crewTaskFieldValue: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    crewTaskTimelineItem: {
      create: jest.fn().mockResolvedValue({}),
      findFirst: jest.fn().mockResolvedValue(null),
    },
    studioDocument: {
      findFirst: jest.fn().mockResolvedValue({
        id: PRODUCTION_DOCUMENT_ID,
        workspaceId: '01910d50-4c88-7c78-92d4-16892c06a043',
        projectId: PRODUCTION_PROJECT_ID,
        type: 'canvas',
        status: 'active',
        title: 'Crew production',
        slug: null,
        schemaVersion: '2026-05-27',
        collaborationDialect: 'fizzdragon.document.v1',
        collaborationRoomId: '01910d50-4c88-7c78-92d4-16892c06a044',
        contentSnapshot: { nodes: { 'main-node': { id: 'main-node' } } },
        crdtState: CANVAS_STATES.productionState,
        currentSequence: 0,
        snapshotSequence: 0,
        lastCompactedAt: null,
        currentVersionId: '01910d50-4c88-7c78-92d4-16892c06a045',
        createdById: OWNER_ID,
        updatedById: null,
        version: 0,
        archivedAt: null,
        createdAt: new Date('2026-07-29T09:00:00.000Z'),
        updatedAt: new Date('2026-07-29T09:00:00.000Z'),
        deletedAt: null,
      }),
      update: jest.fn().mockResolvedValue({}),
    },
    studioDocumentOperation: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    studioDocumentVersion: {
      findFirst: jest
        .fn()
        .mockImplementation(
          ({ where }: { where: { sourceId?: string | null } }) =>
            Promise.resolve(
              where.sourceId
                ? null
                : {
                    id: '01910d50-4c88-7c78-92d4-16892c06a045',
                    versionNumber: 3,
                  },
            ),
        ),
      create: jest.fn().mockResolvedValue({
        id: PRODUCTION_VERSION_ID,
        documentId: PRODUCTION_DOCUMENT_ID,
        versionNumber: 4,
      }),
    },
    crewTaskWorkflowState: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      count: jest.fn().mockResolvedValue(0),
      aggregate: jest.fn().mockResolvedValue({ _max: { position: 5 } }),
      findMany: jest.fn().mockResolvedValue([]),
      findUniqueOrThrow: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn(),
      delete: jest.fn(),
      findFirst: jest
        .fn()
        .mockImplementation(
          ({
            where,
          }: {
            where: { id?: string; systemKey?: CrewTaskStatus };
          }) => {
            const status = where.systemKey
              ? where.systemKey
              : (Object.entries(WORKFLOW_STATE_IDS).find(
                  ([, id]) => id === where.id,
                )?.[0] as CrewTaskStatus | undefined);
            return status ? workflowState(status) : null;
          },
        ),
    },
    crewTaskCycle: {
      findUniqueOrThrow: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    crewTaskView: {
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn(),
    },
  };
  const prisma = {
    crewMember: { findMany: jest.fn().mockResolvedValue([]) },
    crewTask: {
      findUnique: jest.fn().mockResolvedValue(current),
      findMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    crewTaskView: {
      findFirst: jest.fn(),
    },
    crewTaskCycle: {
      findUnique: jest.fn(),
    },
    crewTaskLabel: {
      findUnique: jest.fn(),
      findUniqueOrThrow: jest.fn(),
      updateMany: jest.fn(),
      delete: jest.fn(),
      create: jest.fn(),
    },
    crewTaskWorkflowState: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
    },
    aiCostLedgerEntry: {
      aggregate: jest.fn().mockResolvedValue({
        _sum: { internalCredits: 84 },
      }),
      groupBy: jest.fn().mockResolvedValue([]),
    },
    aiJob: {
      findMany: jest.fn().mockResolvedValue([]),
    },
    $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
      callback(tx),
    ),
  };
  // Transactional and direct reads share the same label fixture.
  Object.assign(tx, { crewTaskLabel: prisma.crewTaskLabel });
  const roles = {
    require: jest.fn().mockResolvedValue('admin'),
    requireMembership: jest.fn().mockResolvedValue({
      permissions: ['tasks.submit_assigned'],
    }),
    resolve: jest.fn().mockResolvedValue('admin'),
  };
  const assetAccess = {
    requireNodesPermission: jest.fn().mockResolvedValue(undefined),
  };
  const notifications = { send: jest.fn().mockResolvedValue({}) };
  const conversations = {
    broadcastCrewTaskChange: jest.fn().mockResolvedValue(undefined),
    broadcastCrewTaskProjectChange: jest.fn().mockResolvedValue(undefined),
  };
  const earnings = {
    postTaskRewardTx: jest.fn().mockResolvedValue({
      id: 'earning-1',
    }),
  };
  return {
    tx,
    prisma,
    roles,
    notifications,
    conversations,
    service: new CrewTasksService(
      prisma as never,
      roles as never,
      assetAccess as never,
      notifications as never,
      conversations as never,
      earnings as never,
    ),
    assetAccess,
    earnings,
  };
}

describe('CrewTasksService', () => {
  it.each([
    null,
    new Date(new Date().toISOString().slice(0, 10)),
    new Date('2000-01-01'),
  ])(
    'reports recruitment from open positions and inclusive closing dates (%s)',
    async (closeDate) => {
      const t = build();
      t.prisma.crewTask.findUnique.mockResolvedValue(
        task({ recruitmentPositions: [{ closeDate }] }),
      );
      const result = await t.service.get(TASK_ID, OWNER_ID);
      expect(result.isRecruiting).toBe(
        closeDate === null || closeDate.getUTCFullYear() !== 2000,
      );
      expect(t.prisma.crewTask.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({
          include: expect.objectContaining({
            recruitmentPositions: {
              where: {
                status: 'open',
                deletedAt: null,
                moderationStatus: 'ok',
              },
              select: { closeDate: true },
            },
          }) as unknown,
        }),
      );
    },
  );

  it('rejects missing or cross-crew contract assets before changing a task', async () => {
    const t = build();
    t.tx.crewAssetNode.findFirst.mockResolvedValue(null as never);
    await expect(
      t.service.update(TASK_ID, OWNER_ID, {
        expectedVersion: 1,
        contractAssetNodeId: TASK_ID,
      }),
    ).rejects.toThrow('The contract file is unavailable in this crew.');
    expect(t.tx.crewAssetNode.findFirst).toHaveBeenCalledWith({
      where: { id: TASK_ID, crewId: CREW_ID, status: 'active', kind: 'file' },
      select: { id: true },
    });
    expect(t.tx.crewTask.update).not.toHaveBeenCalled();
  });
  it('rejects a contract file the actor cannot view', async () => {
    const t = build();
    t.assetAccess.requireNodesPermission.mockRejectedValue(
      new ForbiddenException('File access denied'),
    );
    await expect(
      t.service.update(TASK_ID, OWNER_ID, {
        expectedVersion: 1,
        contractAssetNodeId: TASK_ID,
      }),
    ).rejects.toThrow('File access denied');
    expect(t.tx.crewTask.update).not.toHaveBeenCalled();
  });
  it.each([TASK_ID, null])(
    'rejects replacement or removal of an attached contract (%s)',
    async (assetId) => {
      const t = build();
      const current = task({
        canvasProjectId: null,
        metadata: { clipId: 'clip-1', contractAssetNodeId: 'old-file' },
      });
      t.prisma.crewTask.findUnique.mockResolvedValue(current);
      t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(current);
      t.tx.crewTask.update.mockResolvedValue(current);
      await expect(
        t.service.update(TASK_ID, OWNER_ID, {
          expectedVersion: 1,
          contractAssetNodeId: assetId,
        }),
      ).rejects.toMatchObject({
        response: { code: 'CREW_TASK_CONTRACT_LOCKED' },
      });
      expect(t.tx.crewTask.update).not.toHaveBeenCalled();
    },
  );

  it.each([undefined, 'old-file'])(
    'keeps the attached contract when updating other task details (%s)',
    async (contractAssetNodeId) => {
      const t = build();
      const current = task({
        canvasProjectId: null,
        metadata: { clipId: 'clip-1', contractAssetNodeId: 'old-file' },
      });
      t.prisma.crewTask.findUnique.mockResolvedValue(current);
      t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(current);
      t.tx.crewTask.update.mockResolvedValue(current);
      await t.service.update(TASK_ID, OWNER_ID, {
        expectedVersion: 1,
        title: 'Updated task title',
        contractAssetNodeId,
      });
      const update = firstCallArgument<Prisma.CrewTaskUpdateArgs>(
        t.tx.crewTask.update,
      );
      expect(update.data.title).toBe('Updated task title');
      if (update.data.metadata)
        expect(update.data.metadata).toMatchObject({
          contractAssetNodeId: 'old-file',
        });
    },
  );

  it('rejects past deadlines before creating a task', async () => {
    const t = build();
    await expect(
      t.service.create(CREW_ID, OWNER_ID, {
        blockedByTaskIds: [],
        customFieldValues: [],
        labelIds: [],
        title: 'Past deadline',
        description: '',
        priority: 'normal',
        assignees: [],
        dueAt: '2000-01-01T00:00:00.000Z',
      }),
    ).rejects.toThrow('Choose today or a future deadline.');
    expect(t.prisma.$transaction).not.toHaveBeenCalled();
  });
  it.each([
    [
      { paymentTerms: 'monthly' as const },
      { rewardUsdMinor: 3000, profitShareBps: 250, paymentTerms: 'monthly' },
    ],
    [{ rewardUsdMinor: 0 }, { rewardUsdMinor: 0, profitShareBps: 250 }],
    [{ profitShareBps: null }, { rewardUsdMinor: 3000, profitShareBps: null }],
  ])(
    'preserves the other compensation term on partial update (%j)',
    async (patch, expected) => {
      const t = build();
      const current = task({
        canvasProjectId: null,
        metadata: {
          clipId: 'clip-1',
          compensation: { rewardUsdMinor: 3000, profitShareBps: 250 },
        },
      });
      t.prisma.crewTask.findUnique.mockResolvedValue(current);
      t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(current);
      t.tx.crewTask.update.mockResolvedValue(current);
      await t.service.update(TASK_ID, OWNER_ID, {
        expectedVersion: 1,
        ...patch,
      });
      const update = firstCallArgument<Prisma.CrewTaskUpdateArgs>(
        t.tx.crewTask.update,
      );
      expect(update.data.metadata).toEqual({
        clipId: 'clip-1',
        compensation: expected,
      });
    },
  );

  it('persists compensation without losing canvas metadata and exposes the saved terms', async () => {
    const t = build();
    const metadata = {
      clipId: 'clip-1',
      compensation: { rewardUsdMinor: 3000, profitShareBps: 0 },
    };
    const current = task({ canvasProjectId: null, metadata });
    t.prisma.crewTask.findUnique.mockResolvedValue(current);
    t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(current);
    t.tx.crewTask.update.mockResolvedValue(
      task({
        canvasProjectId: null,
        metadata: {
          ...metadata,
          compensation: { rewardUsdMinor: 3025, profitShareBps: 250 },
        },
      }),
    );
    const result = await t.service.update(TASK_ID, OWNER_ID, {
      expectedVersion: 1,
      rewardUsdMinor: 3025,
      profitShareBps: 250,
    });
    const update = firstCallArgument<Prisma.CrewTaskUpdateArgs>(
      t.tx.crewTask.update,
    );
    expect(update.data.metadata).toEqual({
      clipId: 'clip-1',
      compensation: { rewardUsdMinor: 3025, profitShareBps: 250 },
    });
    expect(result).toMatchObject({ rewardUsdMinor: 3025, profitShareBps: 250 });
  });

  it.each(['CNY', 'USD'])(
    'keeps %s reward currency while editing the amount',
    async (rewardCurrency) => {
      const t = build();
      const current = task({
        canvasProjectId: null,
        metadata: { compensation: { rewardCurrency, rewardUsdMinor: 3000 } },
      });
      t.prisma.crewTask.findUnique.mockResolvedValue(current);
      t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(current);
      t.tx.crewTask.update.mockResolvedValue(current);
      const result = await t.service.update(TASK_ID, OWNER_ID, {
        expectedVersion: 1,
        rewardUsdMinor: 5000,
      });
      expect(
        firstCallArgument<Prisma.CrewTaskUpdateArgs>(t.tx.crewTask.update).data
          .metadata,
      ).toMatchObject({
        compensation: { rewardCurrency, rewardUsdMinor: 5000 },
      });
      expect(result.rewardCurrency).toBe(rewardCurrency);
    },
  );

  it('exposes stable asset categories without exposing raw metadata', async () => {
    const t = build();
    t.prisma.crewTask.findUnique.mockResolvedValue(
      task({ metadata: { templateKey: 'character_art', internal: 'private' } }),
    );
    const result = await t.service.get(TASK_ID, OWNER_ID);
    expect(result.assetCategory).toBe('characters');
    expect(result).not.toHaveProperty('metadata');
  });

  it.each([null, { clipId: 'clip-1' }, { clipId: 123 }])(
    'exposes only the linked storyboard clip identifier (%s)',
    async (metadata) => {
      const t = build();
      t.prisma.crewTask.findUnique.mockResolvedValue(
        task({ canvasProjectId: null, metadata }),
      );
      const result = await t.service.get(TASK_ID, OWNER_ID);
      expect(result.storyboardClipId).toBe(
        typeof metadata?.clipId === 'string' ? metadata.clipId : null,
      );
      expect(result).not.toHaveProperty('metadata');
    },
  );
  it.each([
    [null, 'USD', 1000, 'USD'],
    [1000n, 'CNY', 1000, 'USD'],
    [1000n, 'CNY', 1200, 'CNY'],
  ] as const)(
    'saves reward and currency together (%s %s → %s %s)',
    async (before, previousCurrency, amount, currency) => {
      const t = build();
      const current = task();
      current.assignees[0] = {
        ...current.assignees[0],
        rewardAmountMinor: before,
        currency: previousCurrency,
      };
      t.prisma.crewTask.findUnique.mockResolvedValue(current);
      t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(current);
      t.tx.crewTask.update.mockResolvedValue(current);
      await t.service.update(TASK_ID, OWNER_ID, {
        expectedVersion: 1,
        assignees: [
          { userId: ASSIGNEE_ID, rewardAmountMinor: amount, currency },
        ],
      });
      expect(t.tx.crewTaskAssignee.update).toHaveBeenCalledWith({
        where: { id: 'assignee-1' },
        data: { rewardAmountMinor: BigInt(amount), currency },
      });
    },
  );

  it('records the actor in task update notifications', async () => {
    const t = build();
    const current = { ...task(), canvasProjectId: null };
    t.prisma.crewTask.findUnique.mockResolvedValue(current);
    t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(current);
    t.tx.crewTask.update.mockResolvedValue({
      ...current,
      title: 'Revised brief',
      version: 2,
    });
    await t.service.update(TASK_ID, OWNER_ID, {
      expectedVersion: 1,
      title: 'Revised brief',
    });
    expect(t.notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'crew.task.updated',
        meta: expect.objectContaining({
          actorUserId: OWNER_ID,
          taskTitle: 'Revised brief',
        }) as unknown,
      }),
      t.tx,
    );
  });

  it('limits the center to authorized Crews and applies assignment and cursor filters', async () => {
    const t = build();
    t.prisma.crewTask.groupBy.mockResolvedValue([]);
    t.prisma.crewMember.findMany.mockResolvedValue([
      { crewId: 'allowed', crew: { name: 'Allowed' } },
      { crewId: 'denied', crew: { name: 'Denied' } },
    ]);
    t.roles.resolve
      .mockResolvedValueOnce({ permissions: ['tasks.view'] })
      .mockResolvedValueOnce({ permissions: [] });
    t.prisma.crewTask.findMany.mockResolvedValue([
      {
        id: 'page-end',
        crew: { id: 'allowed', name: 'Allowed' },
        assignees: [],
        workflowState: { semantic: 'open', name: 'Planning', systemKey: null },
      },
      { id: 'next', workflowState: { semantic: 'open' } },
    ]);
    const result = await t.service.listCenter(ASSIGNEE_ID, {
      scope: 'mine',
      status: 'active',
      limit: 1,
      cursor: TASK_ID,
      query: 'review',
    });
    expect(result).toMatchObject({
      items: [
        {
          id: 'page-end',
          status: 'open',
          deadlineRisk: null,
          workflowState: {
            semantic: 'open',
            name: 'Planning',
            systemKey: null,
          },
        },
      ],
      nextCursor: 'page-end',
    });
    expect(t.prisma.crewTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          crewId: { in: ['allowed'] },
          workflowState: { semantic: { notIn: ['approved', 'cancelled'] } },
          OR: [
            { title: { contains: 'review', mode: 'insensitive' } },
            { crew: { name: { contains: 'review', mode: 'insensitive' } } },
          ],
          crew: {
            deletedAt: null,
            members: { some: { userId: ASSIGNEE_ID, status: 'active' } },
          },
          assignees: { some: { userId: ASSIGNEE_ID } },
          id: { lt: TASK_ID },
          deletedAt: null,
        }) as unknown,
        take: 2,
      }),
    );
  });

  it('omits a concurrently deleted Crew but propagates authorization failures', async () => {
    const t = build();
    t.prisma.crewTask.groupBy.mockResolvedValue([]);
    t.prisma.crewMember.findMany.mockResolvedValue([
      { crewId: 'deleted', crew: { name: 'Deleted' } },
    ]);
    t.roles.resolve.mockRejectedValueOnce(
      new NotFoundException('Crew not found'),
    );
    const query = { scope: 'all' as const, status: 'all' as const, limit: 30 };
    await expect(
      t.service.listCenter(ASSIGNEE_ID, query),
    ).resolves.toMatchObject({
      items: [],
      nextCursor: null,
    });
    expect(t.prisma.crewTask.findMany).not.toHaveBeenCalled();
    t.roles.resolve.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(t.service.listCenter(ASSIGNEE_ID, query)).rejects.toThrow(
      'Database unavailable',
    );
  });

  it('does not query tasks when no Crew grants task access', async () => {
    const t = build();
    t.prisma.crewTask.groupBy.mockResolvedValue([]);
    t.prisma.crewMember.findMany.mockResolvedValue([
      { crewId: 'denied', crew: { name: 'Denied' } },
    ]);
    t.roles.resolve.mockResolvedValue({ permissions: [] });
    await expect(
      t.service.listCenter(ASSIGNEE_ID, {
        scope: 'all',
        status: 'all',
        limit: 30,
      }),
    ).resolves.toMatchObject({ items: [], nextCursor: null });
    expect(t.prisma.crewTask.findMany).not.toHaveBeenCalled();
  });

  it('restricts Producer view to authorized crews and counts the full filtered scope', async () => {
    const t = build();
    t.prisma.crewTask.groupBy.mockResolvedValue([]);
    t.prisma.crewMember.findMany.mockResolvedValue([
      { crewId: 'producer', crew: { name: 'Production' } },
      { crewId: 'viewer', crew: { name: 'Other' } },
    ]);
    t.roles.resolve
      .mockResolvedValueOnce({ permissions: ['tasks.view', 'tasks.review'] })
      .mockResolvedValueOnce({ permissions: ['tasks.view'] });
    t.prisma.crewTask.groupBy.mockResolvedValue([{ taskKind: 'edit' }]);
    t.prisma.crewTask.findMany.mockResolvedValue([
      {
        id: TASK_ID,
        title: 'Review cut',
        taskKind: 'edit',
        assignees: [],
        crew: { id: 'producer', name: 'Production' },
        dueAt: null,
        workflowState: {
          semantic: 'submitted',
          name: 'Review',
          systemKey: 'submitted',
        },
      },
    ]);
    t.prisma.crewTask.count.mockResolvedValueOnce(8).mockResolvedValueOnce(12);
    const result = await t.service.listCenter(ASSIGNEE_ID, {
      scope: 'managed',
      status: 'submitted',
      taskKind: 'edit',
      limit: 1,
    });
    expect(result.crews).toEqual([{ id: 'producer', name: 'Production' }]);
    expect(result.stats).toEqual({ dueSoon: 8, pendingReviews: 12 });
    const warning = firstCallArgument<{
      where: { dueAt: { gte: Date; lte: Date }; workflowState: unknown };
    }>(t.prisma.crewTask.count);
    expect(warning.where.workflowState).toEqual({
      semantic: { notIn: ['approved', 'cancelled', 'submitted'] },
    });
    expect(
      warning.where.dueAt.lte.getTime() - warning.where.dueAt.gte.getTime(),
    ).toBe(72 * 60 * 60 * 1000);
    expect(result.items[0]).toMatchObject({
      canReview: true,
      canSubmit: false,
    });
    expect(
      (
        t.prisma.crewTask.findMany.mock.calls as Array<[{ where: unknown }]>
      )[0][0].where,
    ).toMatchObject({
      crewId: { in: ['producer'] },
      taskKind: 'edit',
      workflowState: { semantic: 'submitted' },
    });
    expect(
      (t.prisma.crewTask.count.mock.calls as Array<[{ where: unknown }]>)[1][0]
        .where,
    ).not.toHaveProperty('id');
  });

  it('excludes tasks awaiting review from the task-center overdue filter', async () => {
    const t = build();
    t.prisma.crewTask.groupBy.mockResolvedValue([]);
    t.prisma.crewMember.findMany.mockResolvedValue([
      { crewId: 'producer', crew: { name: 'Production' } },
    ]);
    t.roles.resolve.mockResolvedValue({
      permissions: ['tasks.view', 'tasks.review'],
    });
    t.prisma.crewTask.findMany.mockResolvedValue([]);
    t.prisma.crewTask.count.mockResolvedValue(0);
    await t.service.listCenter(ASSIGNEE_ID, {
      scope: 'managed',
      status: 'overdue',
      limit: 30,
    });
    const request = firstCallArgument<{ where: { workflowState: unknown } }>(
      t.prisma.crewTask.findMany,
    );
    expect(request.where.workflowState).toEqual({
      semantic: { notIn: ['approved', 'cancelled', 'submitted'] },
    });
  });
  it('offers submission only with submit permission and assignment or management authority', async () => {
    const t = build();
    t.prisma.crewTask.groupBy.mockResolvedValue([]);
    t.prisma.crewMember.findMany.mockResolvedValue([
      { crewId: CREW_ID, crew: { name: 'Film' } },
    ]);
    t.roles.resolve.mockResolvedValue({
      permissions: ['tasks.view', 'tasks.submit_assigned'],
    });
    t.prisma.crewTask.findMany.mockResolvedValue([
      {
        id: 'assigned',
        crew: { id: CREW_ID },
        assignees: [{ userId: ASSIGNEE_ID }],
        workflowState: { semantic: 'in_progress' },
      },
      {
        id: 'other',
        crew: { id: CREW_ID },
        assignees: [],
        workflowState: { semantic: 'in_progress' },
      },
      {
        id: 'closed',
        crew: { id: CREW_ID },
        assignees: [{ userId: ASSIGNEE_ID }],
        workflowState: { semantic: 'approved' },
      },
    ]);
    const result = await t.service.listCenter(ASSIGNEE_ID, {
      scope: 'all',
      status: 'all',
      limit: 30,
    });
    expect(result.items.map((task) => task.canSubmit)).toEqual([
      true,
      false,
      false,
    ]);
    expect(result.items.every((task) => !task.canReview)).toBe(true);
  });
  it('does not expand authorization through a requested crew filter', async () => {
    const t = build();
    t.prisma.crewTask.groupBy.mockResolvedValue([]);
    t.prisma.crewMember.findMany.mockResolvedValue([
      { crewId: CREW_ID, crew: { name: 'Film' } },
    ]);
    t.roles.resolve.mockResolvedValue({ permissions: ['tasks.view'] });
    const result = await t.service.listCenter(ASSIGNEE_ID, {
      scope: 'mine',
      status: 'overdue',
      crewId: 'other',
      limit: 30,
    });
    expect(result.items).toEqual([]);
    expect(result.stats).toEqual({ dueSoon: 0, pendingReviews: 0 });
    expect(t.prisma.crewTask.findMany).not.toHaveBeenCalled();
  });

  it('updates a production cycle only from the expected revision', async () => {
    const t = build();
    const cycle = {
      id: '01910d50-4c88-7c78-92d4-16892c06d001',
      crewId: CREW_ID,
      number: 1,
      name: 'Episode 01',
      goal: 'Finish the storyboard',
      status: 'planned',
      startAt: new Date('2026-07-29T00:00:00.000Z'),
      endAt: new Date('2026-08-12T23:59:59.000Z'),
      createdByUserId: OWNER_ID,
      createdAt: new Date('2026-07-29T09:00:00.000Z'),
      updatedAt: new Date('2026-07-29T09:00:00.000Z'),
    };
    t.prisma.crewTaskCycle.findUnique.mockResolvedValue(cycle);
    t.tx.crewTaskCycle.findUniqueOrThrow.mockResolvedValue(cycle);
    t.tx.crewTaskCycle.findFirst.mockResolvedValue(null);
    t.tx.crewTaskCycle.update.mockResolvedValue({
      ...cycle,
      name: 'Episode 01 · Final',
      status: 'active',
      updatedAt: new Date('2026-07-29T10:00:00.000Z'),
    });

    await expect(
      t.service.updateCycle(cycle.id, OWNER_ID, {
        expectedUpdatedAt: cycle.updatedAt.toISOString(),
        name: 'Episode 01 · Final',
        status: 'active',
      }),
    ).resolves.toMatchObject({
      name: 'Episode 01 · Final',
      status: 'active',
      updatedAt: '2026-07-29T10:00:00.000Z',
    });
    expect(t.conversations.broadcastCrewTaskProjectChange).toHaveBeenCalledWith(
      CREW_ID,
      'cycle',
      cycle.id,
      'updated',
      OWNER_ID,
    );
  });

  it('rejects a stale production cycle edit under the crew lock', async () => {
    const t = build();
    const cycle = {
      id: '01910d50-4c88-7c78-92d4-16892c06d002',
      crewId: CREW_ID,
      updatedAt: new Date('2026-07-29T10:00:00.000Z'),
    };
    t.prisma.crewTaskCycle.findUnique.mockResolvedValue(cycle);
    t.tx.crewTaskCycle.findUniqueOrThrow.mockResolvedValue(cycle);

    await expect(
      t.service.updateCycle(cycle.id, OWNER_ID, {
        expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
        status: 'active',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CREW_TASK_CYCLE_CONFLICT' },
    });
    expect(t.tx.crewTaskCycle.update).not.toHaveBeenCalled();
  });

  it('deletes a cycle, returns its tasks to Backlog, and repairs saved view filters', async () => {
    const t = build();
    const cycle = {
      id: '01910d50-4c88-7c78-92d4-16892c06d003',
      crewId: CREW_ID,
    };
    t.prisma.crewTaskCycle.findUnique.mockResolvedValue(cycle);
    t.tx.crewTaskView.findMany.mockResolvedValue([
      {
        id: '01910d50-4c88-7c78-92d4-16892c06d010',
        filters: {
          cycleIds: [cycle.id, '01910d50-4c88-7c78-92d4-16892c06d011'],
          priorities: ['high'],
        },
      },
    ]);
    t.tx.crewTask.updateMany.mockResolvedValue({ count: 2 });
    t.tx.crewTaskCycle.delete.mockResolvedValue(cycle);

    await expect(
      t.service.deleteCycle(cycle.id, OWNER_ID),
    ).resolves.toBeUndefined();
    expect(t.tx.crewTaskView.update).toHaveBeenCalledWith({
      where: { id: '01910d50-4c88-7c78-92d4-16892c06d010' },
      data: {
        filters: {
          cycleIds: ['01910d50-4c88-7c78-92d4-16892c06d011'],
          priorities: ['high'],
        },
      },
    });
    expect(t.tx.crewTask.updateMany).toHaveBeenCalledWith({
      where: { cycleId: cycle.id },
      data: { cycleId: null, version: { increment: 1 } },
    });
    expect(t.conversations.broadcastCrewTaskProjectChange).toHaveBeenCalledWith(
      CREW_ID,
      'cycle',
      cycle.id,
      'deleted',
      OWNER_ID,
    );
  });

  it('updates a task label with optimistic concurrency', async () => {
    const t = build();
    const label = {
      id: '01910d50-4c88-7c78-92d4-16892c06c001',
      crewId: CREW_ID,
      name: 'Environment',
      color: '#63a8ff',
      description: 'Scene environment work',
      createdByUserId: OWNER_ID,
      createdAt: new Date('2026-07-29T09:00:00.000Z'),
      updatedAt: new Date('2026-07-29T09:00:00.000Z'),
    };
    t.prisma.crewTaskLabel.findUnique.mockResolvedValue(label);
    t.prisma.crewTaskLabel.updateMany.mockResolvedValue({ count: 1 });
    t.prisma.crewTaskLabel.findUniqueOrThrow.mockResolvedValue({
      ...label,
      name: 'Locations',
      color: '#e12b32',
      updatedAt: new Date('2026-07-29T10:00:00.000Z'),
    });

    await expect(
      t.service.updateLabel(label.id, OWNER_ID, {
        expectedUpdatedAt: label.updatedAt.toISOString(),
        name: 'Locations',
        color: '#E12B32',
      }),
    ).resolves.toMatchObject({
      id: label.id,
      name: 'Locations',
      color: '#e12b32',
      updatedAt: '2026-07-29T10:00:00.000Z',
    });
    expect(t.prisma.crewTaskLabel.updateMany).toHaveBeenCalledWith({
      where: { id: label.id, updatedAt: label.updatedAt },
      data: {
        name: 'Locations',
        color: '#e12b32',
        description: undefined,
      },
    });
  });

  it('rejects a stale task label edit without overwriting newer settings', async () => {
    const t = build();
    const label = {
      id: '01910d50-4c88-7c78-92d4-16892c06c002',
      crewId: CREW_ID,
      name: 'Risk',
      color: '#f59e0b',
      description: '',
      createdByUserId: OWNER_ID,
      createdAt: new Date('2026-07-29T09:00:00.000Z'),
      updatedAt: new Date('2026-07-29T10:00:00.000Z'),
    };
    t.prisma.crewTaskLabel.findUnique.mockResolvedValue(label);
    t.prisma.crewTaskLabel.updateMany.mockResolvedValue({ count: 0 });

    await expect(
      t.service.updateLabel(label.id, OWNER_ID, {
        expectedUpdatedAt: '2026-07-29T09:00:00.000Z',
        name: 'Production risk',
      }),
    ).rejects.toMatchObject({
      response: { code: 'CREW_TASK_LABEL_CONFLICT' },
    });
    expect(t.prisma.crewTaskLabel.findUniqueOrThrow).not.toHaveBeenCalled();
  });

  it('deletes a task label and its assignment links with task-management permission', async () => {
    const t = build();
    const label = {
      id: '01910d50-4c88-7c78-92d4-16892c06c003',
      crewId: CREW_ID,
    };
    t.prisma.crewTaskLabel.findUnique.mockResolvedValue(label);
    t.prisma.crewTaskLabel.delete.mockResolvedValue(label);

    await expect(
      t.service.deleteLabel(label.id, OWNER_ID),
    ).resolves.toBeUndefined();
    expect(t.roles.require).toHaveBeenCalledWith(
      CREW_ID,
      OWNER_ID,
      'tasks.manage',
    );
    expect(t.prisma.crewTaskLabel.delete).toHaveBeenCalledWith({
      where: { id: label.id },
    });
  });

  it('validates bounded task view and picker queries', () => {
    expect(
      ListCrewTasksQuerySchema.parse({
        viewId: '01910d50-4c88-7c78-92d4-16892c06b101',
      }),
    ).toEqual({
      viewId: '01910d50-4c88-7c78-92d4-16892c06b101',
      limit: 50,
    });
    expect(
      ListCrewTaskOptionsQuerySchema.parse({ activeOnly: 'true' }),
    ).toEqual({
      activeOnly: true,
      limit: 30,
    });
    expect(
      ListCrewTasksQuerySchema.safeParse({
        viewId: '01910d50-4c88-7c78-92d4-16892c06b101',
        limit: 101,
      }).success,
    ).toBe(false);
  });

  it('uses an unfiltered, bounded production view without consulting personal saved views', async () => {
    const t = build();
    t.prisma.crewTask.findMany.mockResolvedValue([]);
    t.prisma.crewTask.count.mockResolvedValue(0);
    t.prisma.crewTask.groupBy.mockResolvedValue([]);
    await t.service.list(
      CREW_ID,
      OWNER_ID,
      ListCrewTasksQuerySchema.parse({ viewId: 'production' }),
    );
    expect(t.roles.require).toHaveBeenCalledWith(
      CREW_ID,
      OWNER_ID,
      'tasks.view',
    );
    expect(t.prisma.crewTaskView.findFirst).not.toHaveBeenCalled();
    expect(t.prisma.crewTask.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { crewId: CREW_ID, AND: [{ deletedAt: null }] },
        take: 51,
      }),
    );
  });

  it('evaluates persisted task views on the server and cursor-paginates a bounded page', async () => {
    const t = build();
    const viewId = '01910d50-4c88-7c78-92d4-16892c06b101';
    const first = task({ id: TASK_ID });
    const second = task({
      id: '01910d50-4c88-7c78-92d4-16892c06a099',
      number: 11,
    });
    t.prisma.crewTaskView.findFirst.mockResolvedValue({
      id: viewId,
      crewId: CREW_ID,
      completedMode: 'hidden',
      showSubIssues: true,
      filters: {
        priorities: ['high', 'urgent'],
        assigneeUserIds: [ASSIGNEE_ID],
      },
      sorts: [{ field: 'priority', direction: 'asc' }],
    });
    t.prisma.crewTask.findMany.mockResolvedValue([first, second]);
    t.prisma.crewTask.count.mockResolvedValue(7);
    t.prisma.crewTask.groupBy.mockResolvedValue([
      {
        workflowStateId: WORKFLOW_STATE_IDS.submitted,
        _count: { _all: 7 },
      },
    ]);
    t.prisma.aiJob.findMany.mockResolvedValue([
      { id: 'job-1', projectId: first.canvasProjectId },
    ]);
    t.prisma.aiCostLedgerEntry.groupBy.mockResolvedValue([
      { jobId: 'job-1', _sum: { internalCredits: 84 } },
    ]);

    const page = await t.service.list(CREW_ID, OWNER_ID, {
      viewId,
      query: '#10',
      limit: 1,
    });

    expect(page.items).toHaveLength(1);
    expect(page.items[0]?.computeUsedPoints).toBe(84);
    expect(page.nextCursor).toBe(TASK_ID);
    expect(page.total).toBe(7);
    expect(page.workflowCounts).toEqual({
      [WORKFLOW_STATE_IDS.submitted]: 7,
    });
    const listInput = firstCallArgument<{
      take: number;
      orderBy: unknown;
      where: { crewId: string; AND: unknown[] };
    }>(t.prisma.crewTask.findMany);
    expect(listInput.take).toBe(2);
    expect(listInput.orderBy).toEqual([{ priority: 'desc' }, { id: 'asc' }]);
    expect(listInput.where.crewId).toBe(CREW_ID);
    expect(listInput.where.AND).toEqual(
      expect.arrayContaining([
        {
          workflowState: {
            semantic: {
              notIn: [CrewTaskStatus.approved, CrewTaskStatus.cancelled],
            },
          },
        },
        { priority: { in: ['high', 'urgent'] } },
        {
          assignees: { some: { userId: { in: [ASSIGNEE_ID] } } },
        },
      ]),
    );
    expect(t.prisma.aiCostLedgerEntry.aggregate).not.toHaveBeenCalled();
  });

  it('returns exact task pulse totals without loading task rows', async () => {
    const t = build();
    t.prisma.crewTaskWorkflowState.findMany.mockResolvedValue([
      { semantic: CrewTaskStatus.open, _count: { tasks: 3 } },
      { semantic: CrewTaskStatus.submitted, _count: { tasks: 2 } },
      { semantic: CrewTaskStatus.approved, _count: { tasks: 5 } },
    ]);
    t.prisma.crewTask.count.mockResolvedValue(2);

    await expect(t.service.summary(CREW_ID, OWNER_ID)).resolves.toMatchObject({
      total: 10,
      active: 5,
      myActive: 2,
      pendingReview: 2,
      completed: 5,
    });
    expect(t.prisma.crewTask.findMany).not.toHaveBeenCalled();
  });

  it('restricts recruitment options to managed, unassigned recruitable tasks', async () => {
    const t = build();
    t.prisma.crewTask.findMany.mockResolvedValue([]);
    await t.service.listOptions(
      CREW_ID,
      OWNER_ID,
      ListCrewTaskOptionsQuerySchema.parse({ recruitmentOnly: 'true' }),
    );
    expect(t.roles.require).toHaveBeenCalledWith(
      CREW_ID,
      OWNER_ID,
      'tasks.manage',
    );
    expect(
      firstCallArgument<{ where: Prisma.CrewTaskWhereInput }>(
        t.prisma.crewTask.findMany,
      ).where,
    ).toMatchObject({
      crewId: CREW_ID,
      deletedAt: null,
      assignees: { none: {} },
      workflowState: {
        semantic: {
          notIn: [
            CrewTaskStatus.approved,
            CrewTaskStatus.cancelled,
            CrewTaskStatus.submitted,
          ],
        },
      },
    });
  });

  it('denies recruitment options before reading tasks when manage permission is lost', async () => {
    const t = build();
    t.roles.require
      .mockResolvedValueOnce('admin')
      .mockRejectedValueOnce(new ForbiddenException());
    await expect(
      t.service.listOptions(
        CREW_ID,
        OWNER_ID,
        ListCrewTaskOptionsQuerySchema.parse({ recruitmentOnly: 'true' }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.prisma.crewTask.findMany).not.toHaveBeenCalled();
  });

  it('searches lightweight task options with a bounded cursor', async () => {
    const t = build();
    const persistedOption = {
      id: TASK_ID,
      number: 10,
      title: 'Finish SC.010 storyboard',
      workflowState: { semantic: CrewTaskStatus.open },
      priority: CrewTaskPriority.high,
      workflowStateId: WORKFLOW_STATE_IDS.open,
      parentId: null,
    };
    t.prisma.crewTask.findMany.mockResolvedValue([
      persistedOption,
      {
        ...persistedOption,
        id: '01910d50-4c88-7c78-92d4-16892c06a099',
      },
    ]);

    const page = await t.service.listOptions(CREW_ID, OWNER_ID, {
      query: 'storyboard',
      activeOnly: true,
      limit: 1,
    });

    const { workflowState: _workflowState, ...option } = persistedOption;
    expect(_workflowState.semantic).toBe(CrewTaskStatus.open);
    expect(page).toEqual({
      items: [{ ...option, status: CrewTaskStatus.open }],
      nextCursor: TASK_ID,
    });
    const optionInput = firstCallArgument<{
      take: number;
      orderBy: unknown;
      where: {
        crewId: string;
        workflowState: {
          semantic: { notIn: CrewTaskStatus[] };
        };
      };
    }>(t.prisma.crewTask.findMany);
    expect(optionInput).toMatchObject({
      take: 2,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      where: {
        crewId: CREW_ID,
        workflowState: {
          semantic: {
            notIn: [CrewTaskStatus.approved, CrewTaskStatus.cancelled],
          },
        },
      },
    });
  });

  it.each(['2147483648', '#2147483648', '9007199254740991'])(
    'keeps out-of-range task number %s as a text search',
    async (query) => {
      const t = build();
      t.prisma.crewTask.findMany.mockResolvedValue([]);
      await t.service.listOptions(
        CREW_ID,
        OWNER_ID,
        ListCrewTaskOptionsQuerySchema.parse({ query }),
      );
      const input = firstCallArgument<{ where: { OR: unknown[] } }>(
        t.prisma.crewTask.findMany,
      );
      expect(input.where.OR).toEqual([
        { title: { contains: query, mode: 'insensitive' } },
        { description: { contains: query, mode: 'insensitive' } },
        {
          labels: {
            some: { label: { name: { contains: query, mode: 'insensitive' } } },
          },
        },
      ]);
    },
  );

  it.each(['2147483647', '#2147483647'])(
    'searches the maximum task number %s',
    async (query) => {
      const t = build();
      t.prisma.crewTask.findMany.mockResolvedValue([]);
      await t.service.listOptions(
        CREW_ID,
        OWNER_ID,
        ListCrewTaskOptionsQuerySchema.parse({ query }),
      );
      const input = firstCallArgument<{ where: { OR: unknown[] } }>(
        t.prisma.crewTask.findMany,
      );
      expect(input.where.OR).toContainEqual({ number: 2147483647 });
    },
  );

  it('rejects a stale task edit before mutating task or canvas state', async () => {
    const t = build();

    try {
      await t.service.update(TASK_ID, OWNER_ID, {
        expectedVersion: 7,
        title: 'A stale title',
      });
      throw new Error('Expected a task version conflict');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CREW_TASK_VERSION_CONFLICT',
        expectedVersion: 7,
        currentVersion: 1,
      });
    }

    expect(t.tx.crewTask.update).not.toHaveBeenCalled();
    expect(t.conversations.broadcastCrewTaskChange).not.toHaveBeenCalled();
  });

  it('rejects a reorder when an anchor version changed concurrently', async () => {
    const t = build();
    const beforeId = '01910d50-4c88-7c78-92d4-16892c06a020';
    const current = task({
      status: CrewTaskStatus.open,
      submittedAt: null,
    });
    t.prisma.crewTask.findUnique.mockResolvedValue(current);
    t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(current);
    t.tx.crewTask.findMany.mockResolvedValue([
      {
        id: beforeId,
        rank: new Prisma.Decimal(2048),
        workflowStateId: WORKFLOW_STATE_IDS.open,
        cycleId: null,
        version: 4,
      },
    ]);

    try {
      await t.service.reorder(TASK_ID, OWNER_ID, {
        expectedVersion: 1,
        beforeTaskId: beforeId,
        beforeTaskVersion: 3,
        afterTaskId: null,
        afterTaskVersion: null,
        workflowStateId: WORKFLOW_STATE_IDS.open,
      });
      throw new Error('Expected a reorder conflict');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CREW_TASK_REORDER_CONFLICT',
      });
    }

    expect(t.tx.crewTask.update).not.toHaveBeenCalled();
  });

  it('orders a board across cycles without changing the moved task cycle', async () => {
    const t = build();
    const beforeId = '01910d50-4c88-7c78-92d4-16892c06a020';
    const current = task({
      status: CrewTaskStatus.open,
      submittedAt: null,
      cycleId: '01910d50-4c88-7c78-92d4-16892c06a030',
    });
    t.prisma.crewTask.findUnique.mockResolvedValue(current);
    t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(current);
    t.tx.crewTask.findMany.mockResolvedValue([
      {
        id: beforeId,
        rank: new Prisma.Decimal(2048),
        workflowStateId: WORKFLOW_STATE_IDS.in_progress,
        cycleId: '01910d50-4c88-7c78-92d4-16892c06a031',
        version: 4,
      },
    ]);
    t.tx.crewTask.update.mockResolvedValue({
      ...current,
      workflowStateId: WORKFLOW_STATE_IDS.in_progress,
      rank: new Prisma.Decimal(3072),
      version: 2,
    });

    await t.service.reorder(TASK_ID, OWNER_ID, {
      expectedVersion: 1,
      beforeTaskId: beforeId,
      beforeTaskVersion: 4,
      afterTaskId: null,
      afterTaskVersion: null,
      workflowStateId: WORKFLOW_STATE_IDS.in_progress,
    });

    expect(t.tx.crewTask.count).toHaveBeenCalledWith({
      where: {
        crewId: CREW_ID,
        deletedAt: null,
        id: { notIn: [TASK_ID, beforeId] },
        workflowStateId: WORKFLOW_STATE_IDS.in_progress,
        rank: { gte: new Prisma.Decimal(2048) },
      },
    });
    // The lightweight Prisma mock intentionally leaves Jest's call tuple untyped.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
    const updateInput = t.tx.crewTask.update.mock.calls[0]?.[0] as {
      where: { id: string };
      data: {
        workflowStateId: string;
        cycleId: string | null;
        rank: Prisma.Decimal;
      };
    };
    expect(updateInput.where).toEqual({ id: TASK_ID, deletedAt: null });
    expect(updateInput.data).toMatchObject({
      workflowStateId: WORKFLOW_STATE_IDS.in_progress,
      cycleId: current.cycleId,
      rank: new Prisma.Decimal(3072),
    });
  });

  it('rejects a reorder when another task already occupies the requested gap', async () => {
    const t = build();
    const beforeId = '01910d50-4c88-7c78-92d4-16892c06a020';
    const afterId = '01910d50-4c88-7c78-92d4-16892c06a021';
    const current = task({
      status: CrewTaskStatus.open,
      submittedAt: null,
    });
    t.prisma.crewTask.findUnique.mockResolvedValue(current);
    t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(current);
    t.tx.crewTask.findMany.mockResolvedValue([
      {
        id: beforeId,
        rank: new Prisma.Decimal(2048),
        workflowStateId: WORKFLOW_STATE_IDS.open,
        cycleId: null,
        version: 2,
      },
      {
        id: afterId,
        rank: new Prisma.Decimal(4096),
        workflowStateId: WORKFLOW_STATE_IDS.open,
        cycleId: null,
        version: 5,
      },
    ]);
    t.tx.crewTask.count.mockResolvedValue(1);

    try {
      await t.service.reorder(TASK_ID, OWNER_ID, {
        expectedVersion: 1,
        beforeTaskId: beforeId,
        beforeTaskVersion: 2,
        afterTaskId: afterId,
        afterTaskVersion: 5,
        workflowStateId: WORKFLOW_STATE_IDS.open,
      });
      throw new Error('Expected a reorder conflict');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CREW_TASK_REORDER_CONFLICT',
      });
    }

    expect(t.tx.crewTask.update).not.toHaveBeenCalled();
  });

  it('rejects an edit that would create a circular blocking dependency', async () => {
    const t = build();
    const blockerId = '01910d50-4c88-7c78-92d4-16892c06a099';
    t.tx.crewTask.count.mockResolvedValue(1);
    t.tx.crewTaskDependency.findMany.mockResolvedValue([
      {
        blockingTaskId: TASK_ID,
        blockedTaskId: blockerId,
      },
    ]);

    try {
      await t.service.update(TASK_ID, OWNER_ID, {
        expectedVersion: 1,
        blockedByTaskIds: [blockerId],
      });
      throw new Error('Expected a dependency cycle rejection');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CREW_TASK_DEPENDENCY_CYCLE',
      });
    }

    expect(t.tx.crewTask.update).not.toHaveBeenCalled();
  });

  it('rejects a former assignee after reassignment while their submission waited for the task lock', async () => {
    const t = build();
    const original = task({
      status: CrewTaskStatus.in_progress,
      submittedAt: null,
    });
    t.prisma.crewTask.findUnique.mockResolvedValue(original);
    t.tx.crewTask.findUniqueOrThrow.mockResolvedValue({
      ...original,
      assignees: [],
    });
    await expect(
      t.service.submit(TASK_ID, ASSIGNEE_ID, {
        note: 'Late submission',
        assetNodeIds: [],
      }),
    ).rejects.toThrow('Only a current task assignee can submit this task.');
    expect(t.tx.crewTask.update).not.toHaveBeenCalled();
    expect(t.conversations.broadcastCrewTaskChange).not.toHaveBeenCalled();
  });

  it('blocks a manager submitting work while an assigned creator has withdrawn', async () => {
    const t = build();
    const active = task({
      status: CrewTaskStatus.in_progress,
      submittedAt: null,
    });
    t.prisma.crewTask.findUnique.mockResolvedValue(active);
    t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(active);
    t.roles.requireMembership.mockResolvedValue({
      permissions: ['tasks.submit_assigned', 'tasks.manage'],
    });
    t.tx.crewTaskCommitment.findFirst.mockResolvedValue({
      status: 'withdrawn',
    } as never);
    await expect(
      t.service.submit(TASK_ID, OWNER_ID, {
        note: 'Submitting for the team',
        assetNodeIds: [],
      }),
    ).rejects.toThrow('withdrawal');
    expect(t.tx.crewTask.update).not.toHaveBeenCalled();
    expect(t.earnings.postTaskRewardTx).not.toHaveBeenCalled();
  });

  it('prevents submission while a blocking task is unresolved', async () => {
    const t = build();
    const blockerId = '01910d50-4c88-7c78-92d4-16892c06a099';
    const blocked = task({
      status: CrewTaskStatus.in_progress,
      submittedAt: null,
      dependenciesAsBlocked: [
        {
          crewId: CREW_ID,
          blockingTaskId: blockerId,
          blockedTaskId: TASK_ID,
          createdByUserId: OWNER_ID,
          createdAt: new Date(),
          blockingTask: {
            id: blockerId,
            number: 9,
            title: 'Approve the environment',
            status: CrewTaskStatus.in_progress,
            workflowState: workflowState(CrewTaskStatus.in_progress),
            parentId: null,
          },
        },
      ],
    });
    t.prisma.crewTask.findUnique.mockResolvedValue(blocked);
    t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(blocked);

    try {
      await t.service.submit(TASK_ID, ASSIGNEE_ID, {
        note: 'Ready',
        assetNodeIds: [],
      });
      throw new Error('Expected a blocked task rejection');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        code: 'CREW_TASK_BLOCKED',
      });
    }
  });

  it('rejects self-mentions before writing a task comment', async () => {
    const t = build();

    try {
      await t.service.createComment(TASK_ID, ASSIGNEE_ID, {
        body: '@Member please review',
        mentions: [{ userId: ASSIGNEE_ID, label: 'Member' }],
        attachments: [],
        clientKey: 'comment-retry-key',
      });
      throw new Error('Expected a self-mention rejection');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({
        message: 'You cannot mention yourself.',
      });
    }

    expect(t.tx.crewTaskTimelineItem.create).not.toHaveBeenCalled();
  });

  it.each(['approve', 'request_revision'] as const)(
    'rejects %s when review permission is revoked while waiting for the task lock',
    async (decision) => {
      const t = build();
      t.tx.$executeRaw.mockImplementationOnce(() => {
        t.roles.require.mockRejectedValue(
          new ForbiddenException('Permission revoked'),
        );
        return Promise.resolve(1);
      });
      await expect(
        t.service.review(TASK_ID, OWNER_ID, {
          decision,
          note: 'Review',
          expectedSubmissionId: 'submission-1',
        }),
      ).rejects.toThrow(ForbiddenException);
      expect(t.tx.crewTaskSubmission.update).not.toHaveBeenCalled();
      expect(t.tx.crewTask.update).not.toHaveBeenCalled();
      expect(t.earnings.postTaskRewardTx).not.toHaveBeenCalled();
      expect(t.conversations.broadcastCrewTaskChange).not.toHaveBeenCalled();
    },
  );

  it.each(['approve', 'request_revision'] as const)(
    'rejects %s after permission is withdrawn during notification writes',
    async (decision) => {
      const t = build();
      t.notifications.send.mockImplementation(() => {
        t.roles.require.mockRejectedValue(
          new ForbiddenException('Permission revoked'),
        );
        return Promise.resolve({});
      });
      await expect(
        t.service.review(TASK_ID, OWNER_ID, {
          decision,
          note: 'Review',
          expectedSubmissionId: 'submission-1',
        }),
      ).rejects.toThrow('Permission revoked');
      expect(t.tx.crewTask.update).toHaveBeenCalled();
      expect(t.conversations.broadcastCrewTaskChange).not.toHaveBeenCalled();
    },
  );

  it.each(['half_upfront', 'on_completion', 'demo_promise'])(
    'does not auto-release a reward under %s terms',
    async (paymentTerms) => {
      const t = build();
      t.tx.crewApplication.findFirst.mockResolvedValue({
        termsVersion: 1,
        terms: [{ version: 1, paymentTerms, confirmedAt: new Date() }],
      });
      await t.service.review(TASK_ID, OWNER_ID, {
        expectedSubmissionId: 'submission-1',
        decision: 'approve',
        note: 'Approved.',
      });
      expect(t.earnings.postTaskRewardTx).not.toHaveBeenCalled();
    },
  );

  it.each([true, false])(
    'validates card approval before writing review or payment (valid=%s)',
    async (valid) => {
      const t = build();
      const marked = task();
      Object.assign(marked.submissions[0], {
        professionalDelivery: {
          definition: { approvalPolicy: 'fd3_or_production_lead' },
        },
      });
      t.prisma.crewTask.findUnique.mockResolvedValue(marked);
      t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(marked);
      const validate = jest.fn(() =>
        valid
          ? Promise.resolve()
          : Promise.reject(new ConflictException('Director changed')),
      );
      const spy = jest
        .spyOn(cardApproval, 'prepareCardApproval')
        .mockResolvedValue({
          evidence: {
            policy: 'fd3_or_production_lead',
            method: 'production_lead',
            reviewerUserId: OWNER_ID,
            verifiedAt: new Date().toISOString(),
          },
          validate,
        });
      try {
        const result = t.service.review(
          TASK_ID,
          OWNER_ID,
          {
            expectedSubmissionId: 'submission-1',
            decision: 'approve',
            note: 'Accepted',
          },
          'session',
        );
        if (valid) {
          await result;
          expect(t.tx.crewTask.update).toHaveBeenCalledWith(
            expect.objectContaining({
              data: expect.objectContaining({
                metadata: expect.objectContaining({
                  cardApproval: expect.objectContaining({
                    submissionId: 'submission-1',
                    reviewerUserId: OWNER_ID,
                  }) as unknown,
                }) as unknown,
              }) as unknown,
            }),
          );
        } else {
          await expect(result).rejects.toThrow('Director changed');
          expect(t.tx.crewTaskSubmission.update).not.toHaveBeenCalled();
          expect(t.earnings.postTaskRewardTx).not.toHaveBeenCalled();
        }
        expect(validate).toHaveBeenCalledWith(t.tx);
        expect(t.prisma.$transaction).toHaveBeenCalledWith(
          expect.any(Function),
          { isolationLevel: 'Serializable' },
        );
      } finally {
        spy.mockRestore();
      }
    },
  );

  it('posts an approved task reward through the immutable earnings ledger', async () => {
    const t = build();

    await expect(
      t.service.review(TASK_ID, OWNER_ID, {
        expectedSubmissionId: 'submission-1',
        decision: 'approve',
        note: 'Approved for delivery.',
      }),
    ).resolves.toMatchObject({
      id: TASK_ID,
      status: CrewTaskStatus.approved,
      computeUsedPoints: 84,
    });

    expect(t.roles.require).toHaveBeenCalledWith(
      CREW_ID,
      OWNER_ID,
      'tasks.review',
    );
    expect(t.earnings.postTaskRewardTx).toHaveBeenCalledWith(t.tx, {
      currency: 'USD',
      crewId: CREW_ID,
      taskId: TASK_ID,
      taskNumber: 10,
      taskTitle: 'Finish SC.010 storyboard',
      crewMemberId: 'crew-member-1',
      userId: ASSIGNEE_ID,
      amountMinor: 120000n,
      approvedByUserId: OWNER_ID,
    });
    const operationCreateCalls = t.tx.studioDocumentOperation.create.mock
      .calls as unknown as Array<
      [
        {
          data: {
            documentId: string;
            operationType: string;
            idempotencyKey: string;
            yjsUpdate: Buffer;
          };
        },
      ]
    >;
    const operationCreate = operationCreateCalls[0]?.[0];
    expect(operationCreate?.data.documentId).toBe(PRODUCTION_DOCUMENT_ID);
    expect(operationCreate?.data.operationType).toBe('yjs_update');
    expect(operationCreate?.data.idempotencyKey).toBe(
      'crew-task-merge:submission-1',
    );
    expect(operationCreate?.data.yjsUpdate).toEqual(CANVAS_STATES.branchState);

    const submissionUpdateCalls = t.tx.crewTaskSubmission.update.mock
      .calls as unknown as Array<
      [
        {
          where: { id: string };
          data: { productionVersionId: string; mergedAt: unknown };
        },
      ]
    >;
    const submissionUpdate = submissionUpdateCalls[0]?.[0];
    expect(submissionUpdate?.where.id).toBe('submission-1');
    expect(submissionUpdate?.data.productionVersionId).toBe(
      PRODUCTION_VERSION_ID,
    );
    expect(submissionUpdate?.data.mergedAt).toBeInstanceOf(Date);

    const documentUpdateCalls = t.tx.studioDocument.update.mock
      .calls as unknown as Array<[{ where: { id: string }; data: unknown }]>;
    const productionUpdate = documentUpdateCalls.find(
      ([input]) => input.where.id === PRODUCTION_DOCUMENT_ID,
    )?.[0] as
      | {
          data: {
            contentSnapshot: {
              nodes: Record<string, unknown>;
            };
          };
        }
      | undefined;
    expect(
      Object.keys(productionUpdate!.data.contentSnapshot.nodes).sort(),
    ).toEqual(['main-node', 'task-node']);
    expect(t.notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ASSIGNEE_ID,
        type: 'crew.task.approved',
        meta: expect.objectContaining({ actorUserId: OWNER_ID }) as unknown,
      }),
      t.tx,
    );
    expect(t.conversations.broadcastCrewTaskChange).toHaveBeenCalledWith(
      CREW_ID,
      TASK_ID,
      'reviewed',
      OWNER_ID,
    );
  });

  it('requests a new version without posting task income', async () => {
    const t = build();
    t.tx.crewTask.update.mockResolvedValue(
      task({
        status: CrewTaskStatus.revision_requested,
        submittedAt: null,
      }),
    );

    await expect(
      t.service.review(TASK_ID, OWNER_ID, {
        expectedSubmissionId: 'submission-1',
        decision: 'request_revision',
        note: 'Tighten the last two shots.',
      }),
    ).resolves.toMatchObject({
      status: CrewTaskStatus.revision_requested,
    });

    expect(t.earnings.postTaskRewardTx).not.toHaveBeenCalled();
    const [updateInput] = t.tx.crewTask.update.mock.calls[0] as unknown as [
      {
        where: { id: string };
        data: {
          submittedAt: Date | null;
        };
        include: unknown;
      },
    ];
    expect(updateInput).toMatchObject({
      where: { id: TASK_ID },
      data: {
        submittedAt: null,
        revisionRoundsUsed: { increment: 1 },
      },
    });
    expect(updateInput.include).toBeDefined();
    expect(t.conversations.broadcastCrewTaskChange).toHaveBeenCalledWith(
      CREW_ID,
      TASK_ID,
      'reviewed',
      OWNER_ID,
    );
  });

  it('refuses another revision request after the agreed limit is used', async () => {
    const t = build();
    t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(
      task({
        revisionLimit: 2,
        revisionRoundsUsed: 2,
      }),
    );

    await expect(
      t.service.review(TASK_ID, OWNER_ID, {
        expectedSubmissionId: 'submission-1',
        decision: 'request_revision',
        note: 'One more adjustment.',
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CREW_TASK_REVISION_LIMIT_REACHED',
        message:
          'This task has used every included revision round. Increase the revision limit or approve the current submission.',
        revisionLimit: 2,
        revisionRoundsUsed: 2,
      },
    });

    expect(t.tx.crewTask.update).not.toHaveBeenCalled();
  });

  it('rejects stale workflow column ordering before mutating positions', async () => {
    const t = build();
    const current = workflowState(CrewTaskStatus.open);
    t.tx.crewTaskWorkflowState.findMany.mockResolvedValue([current]);

    await expect(
      t.service.reorderWorkflowStates(CREW_ID, OWNER_ID, {
        states: [{ id: current.id, expectedVersion: current.version + 1 }],
      }),
    ).rejects.toMatchObject({
      response: {
        code: 'CREW_TASK_WORKFLOW_ORDER_CONFLICT',
      },
    });

    expect(t.tx.crewTaskWorkflowState.update).not.toHaveBeenCalled();
  });

  it('restores an archived workflow column at the end of the active board', async () => {
    const t = build();
    const archived = {
      ...workflowState(CrewTaskStatus.in_progress),
      id: '01910d50-4c88-7c78-92d4-16892c06b099',
      name: 'Lighting pass',
      systemKey: null,
      position: 2,
      archived: true,
      version: 4,
    };
    const restored = {
      ...archived,
      position: 6,
      archived: false,
      version: 5,
    };
    t.prisma.crewTaskWorkflowState.findUnique.mockResolvedValue(archived);
    t.tx.crewTaskWorkflowState.findUniqueOrThrow.mockResolvedValue(archived);
    t.tx.crewTaskWorkflowState.count.mockResolvedValue(6);
    t.tx.crewTaskWorkflowState.aggregate.mockResolvedValue({
      _max: { position: 5 },
    });
    t.tx.crewTaskWorkflowState.update.mockResolvedValue(restored);

    await expect(
      t.service.updateWorkflowState(archived.id, OWNER_ID, {
        expectedVersion: 4,
        archived: false,
      }),
    ).resolves.toMatchObject({
      id: archived.id,
      position: 6,
      archived: false,
      version: 5,
    });

    const [updateInput] = t.tx.crewTaskWorkflowState.update.mock
      .calls[0] as unknown as [
      {
        where: { id: string };
        data: {
          archived: boolean;
          position: number;
          version: { increment: number };
        };
      },
    ];
    expect(updateInput).toMatchObject({
      where: { id: archived.id },
      data: {
        archived: false,
        position: 6,
        version: { increment: 1 },
      },
    });
  });

  it('requires a custom workflow column to be archived before permanent deletion', async () => {
    const t = build();
    const activeCustomState = {
      ...workflowState(CrewTaskStatus.in_progress),
      id: '01910d50-4c88-7c78-92d4-16892c06b098',
      name: 'Lighting pass',
      systemKey: null,
      archived: false,
    };
    t.prisma.crewTaskWorkflowState.findUnique.mockResolvedValue(
      activeCustomState,
    );
    t.tx.crewTaskWorkflowState.findUniqueOrThrow.mockResolvedValue(
      activeCustomState,
    );

    await expect(
      t.service.deleteWorkflowState(activeCustomState.id, OWNER_ID),
    ).rejects.toMatchObject({
      response: {
        message:
          'Archive a custom workflow column before permanently deleting it.',
      },
    });

    expect(t.tx.crewTaskWorkflowState.delete).not.toHaveBeenCalled();
  });
});

it.each(['approve', 'request_revision'] as const)(
  'rejects stale %s before reviewing or rewarding an unseen submission',
  async (decision) => {
    const t = build();
    const seen = task();
    t.tx.crewTask.findUniqueOrThrow.mockResolvedValue(
      task({
        version: 3,
        revisionRoundsUsed: 1,
        submissions: [
          { ...seen.submissions[0], id: 'submission-2', versionNumber: 2 },
        ],
      }),
    );
    await expect(
      t.service.review(TASK_ID, OWNER_ID, {
        decision,
        note: 'Review of version 1',
        expectedSubmissionId: 'submission-1',
      }),
    ).rejects.toThrow('A newer submission is available');
    expect(t.tx.crewTaskSubmission.update).not.toHaveBeenCalled();
    expect(t.tx.crewTask.update).not.toHaveBeenCalled();
    expect(t.earnings.postTaskRewardTx).not.toHaveBeenCalled();
    expect(t.notifications.send).not.toHaveBeenCalled();
  },
);

describe('assignment agreement quotes', () => {
  it('requires task management before exposing any fee', async () => {
    const f = build();
    f.roles.require.mockRejectedValue(new ForbiddenException());
    await expect(
      f.service.recruitmentTerms(TASK_ID, 'outsider', ASSIGNEE_ID),
    ).rejects.toThrow(ForbiddenException);
  });
  it('returns only effective confirmed project fees and excludes private terms text', async () => {
    const f = build();
    const findMany = jest.fn().mockResolvedValue([
      {
        termsVersion: 2,
        terms: [
          {
            version: 1,
            confirmedAt: new Date(),
            feePeriod: 'project',
            currency: 'USD',
            feeAmount: 100n,
          },
          {
            version: 2,
            confirmedAt: new Date(),
            feePeriod: 'project',
            currency: 'USD',
            feeAmount: 250n,
            scope: 'private',
          },
          {
            version: 3,
            confirmedAt: null,
            feePeriod: 'project',
            currency: 'USD',
            feeAmount: 300n,
          },
        ],
      },
    ]);
    Object.assign(f.prisma, {
      crewPosition: {
        findMany: jest.fn().mockResolvedValue([{ id: 'position' }]),
      },
      crewApplication: { findMany },
    });
    expect(
      await f.service.recruitmentTerms(TASK_ID, OWNER_ID, ASSIGNEE_ID),
    ).toEqual({
      required: true,
      items: [{ version: 2, currency: 'USD', feeAmount: '250' }],
    });
    const args =
      firstCallArgument<Prisma.CrewApplicationFindManyArgs>(findMany);
    expect(args.where).toMatchObject({
      crewId: CREW_ID,
      applicantId: ASSIGNEE_ID,
      status: 'approved',
      position: {
        memberPositions: {
          some: {
            member: {
              userId: ASSIGNEE_ID,
              status: 'active',
              removedAt: null,
            },
          },
        },
      },
    });
  });
});
