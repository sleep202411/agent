import {
  CrewSettlementStatus,
  CrewTaskPriority,
  CrewTaskStatus,
  Prisma,
} from '@prisma/client';
import { BadRequestException, ConflictException } from '@nestjs/common';
import * as Y from 'yjs';
import { ListCrewSettlementsQuerySchema } from '../dto';
import {
  ListCrewTaskOptionsQuerySchema,
  ListCrewTasksQuerySchema,
} from './project-dto';
import { CrewTasksService } from './tasks.service';

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
  const status =
    (overrides.status as CrewTaskStatus | undefined) ??
    CrewTaskStatus.submitted;
  return {
    id: TASK_ID,
    crewId: CREW_ID,
    number: 10,
    title: 'Finish SC.010 storyboard',
    description: 'Deliver the revised sequence.',
    status,
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
        rewardPoints: 120000n,
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
    settlements: [],
    dependenciesAsBlocked: [],
    dependenciesAsBlocker: [],
    customFieldValues: [],
    timelineItems: [],
    ...overrides,
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
    $executeRaw: jest.fn().mockResolvedValue(1),
    crewTaskSubmission: {
      update: jest.fn().mockResolvedValue({}),
    },
    crewSettlementItem: {
      create: jest.fn().mockResolvedValue({}),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    walletAccount: {
      upsert: jest.fn().mockResolvedValue({
        id: 'wallet-account-1',
      }),
      findUnique: jest.fn(),
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
    platformDocument: {
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
    platformDocumentOperation: {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
    },
    platformDocumentVersion: {
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
    crewSettlementItem: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      groupBy: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    crewTaskWorkflowState: {
      findUnique: jest.fn(),
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
  const walletLedger = {
    postEntryTx: jest.fn().mockResolvedValue({
      transaction: { id: 'wallet-accrual-transaction-1' },
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
      walletLedger as never,
    ),
    assetAccess,
    walletLedger,
  };
}

describe('CrewTasksService', () => {
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
          status: {
            notIn: [CrewTaskStatus.approved, CrewTaskStatus.cancelled],
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
    t.prisma.crewTask.groupBy.mockResolvedValue([
      { status: CrewTaskStatus.open, _count: { _all: 3 } },
      { status: CrewTaskStatus.submitted, _count: { _all: 2 } },
      { status: CrewTaskStatus.approved, _count: { _all: 5 } },
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

  it('searches lightweight task options with a bounded cursor', async () => {
    const t = build();
    const option = {
      id: TASK_ID,
      number: 10,
      title: 'Finish SC.010 storyboard',
      status: CrewTaskStatus.open,
      priority: CrewTaskPriority.high,
      workflowStateId: WORKFLOW_STATE_IDS.open,
      parentId: null,
    };
    t.prisma.crewTask.findMany.mockResolvedValue([
      option,
      {
        ...option,
        id: '01910d50-4c88-7c78-92d4-16892c06a099',
      },
    ]);

    const page = await t.service.listOptions(CREW_ID, OWNER_ID, {
      query: 'storyboard',
      activeOnly: true,
      limit: 1,
    });

    expect(page).toEqual({ items: [option], nextCursor: TASK_ID });
    const optionInput = firstCallArgument<{
      take: number;
      orderBy: unknown;
      where: {
        crewId: string;
        status: { notIn: CrewTaskStatus[] };
      };
    }>(t.prisma.crewTask.findMany);
    expect(optionInput).toMatchObject({
      take: 2,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      where: {
        crewId: CREW_ID,
        status: {
          notIn: [CrewTaskStatus.approved, CrewTaskStatus.cancelled],
        },
      },
    });
  });

  it('validates bounded settlement pages and status filters', () => {
    expect(ListCrewSettlementsQuerySchema.parse({})).toEqual({ limit: 50 });
    expect(
      ListCrewSettlementsQuerySchema.parse({
        limit: '100',
        status: 'pending',
      }),
    ).toEqual({ limit: 100, status: 'pending' });
    expect(
      ListCrewSettlementsQuerySchema.safeParse({ limit: 101 }).success,
    ).toBe(false);
  });

  it('cursor-paginates the crew settlement ledger with exact status totals', async () => {
    const t = build();
    const row = {
      id: '01910d50-4c88-7c78-92d4-16892c06c001',
      crewId: CREW_ID,
      taskId: TASK_ID,
      crewMemberId: 'crew-member-1',
      userId: ASSIGNEE_ID,
      pointsAmount: 120000n,
      pointsPerUsd: 100,
      payoutAmountMinor: null,
      payoutCurrency: null,
      accrualTransactionId: '01910d50-4c88-7c78-92d4-16892c06c011',
      cashOutTransactionId: null,
      status: CrewSettlementStatus.pending,
      settledAt: null,
      settledByUserId: null,
      note: null,
      createdAt: new Date('2026-07-29T10:00:00.000Z'),
      updatedAt: new Date('2026-07-29T10:00:00.000Z'),
      task: { id: TASK_ID, title: 'Finish SC.010 storyboard' },
    };
    t.prisma.crewSettlementItem.findMany.mockResolvedValue([
      row,
      { ...row, id: '01910d50-4c88-7c78-92d4-16892c06c002' },
    ]);
    t.prisma.crewSettlementItem.groupBy.mockResolvedValue([
      {
        status: CrewSettlementStatus.pending,
        _count: { _all: 4 },
      },
      {
        status: CrewSettlementStatus.settled,
        _count: { _all: 6 },
      },
    ]);

    const page = await t.service.listSettlements(CREW_ID, OWNER_ID, {
      limit: 1,
      status: 'pending',
    });

    expect(t.prisma.crewSettlementItem.findMany).toHaveBeenCalledWith({
      where: { crewId: CREW_ID, status: 'pending' },
      include: { task: { select: { id: true, title: true } } },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: 2,
    });
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBe(row.id);
    expect(page.total).toBe(4);
    expect(page.summary).toEqual({
      total: 10,
      pending: 4,
      settled: 6,
    });
  });

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
        status: CrewTaskStatus;
        workflowStateId: string;
        cycleId: string | null;
        rank: Prisma.Decimal;
      };
    };
    expect(updateInput.where).toEqual({ id: TASK_ID });
    expect(updateInput.data).toMatchObject({
      status: CrewTaskStatus.in_progress,
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

  it('turns an approved task reward into a pending settlement item', async () => {
    const t = build();

    await expect(
      t.service.review(TASK_ID, OWNER_ID, {
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
    expect(t.walletLedger.postEntryTx).toHaveBeenCalledWith(
      t.tx,
      expect.objectContaining({
        accountId: 'wallet-account-1',
        amount: 120000n,
        availableDelta: 120000n,
        idempotencyKey: `crew-task-reward:${TASK_ID}:${ASSIGNEE_ID}`,
      }),
    );
    expect(t.tx.crewSettlementItem.create).toHaveBeenCalledWith({
      data: {
        crewId: CREW_ID,
        taskId: TASK_ID,
        crewMemberId: 'crew-member-1',
        userId: ASSIGNEE_ID,
        pointsAmount: 120000n,
        pointsPerUsd: 100,
        status: CrewSettlementStatus.pending,
        accrualTransactionId: 'wallet-accrual-transaction-1',
      },
    });
    const operationCreateCalls = t.tx.platformDocumentOperation.create.mock
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

    const documentUpdateCalls = t.tx.platformDocument.update.mock
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

  it('requests a new version without creating settlement rows', async () => {
    const t = build();
    t.tx.crewTask.update.mockResolvedValue(
      task({
        status: CrewTaskStatus.revision_requested,
        submittedAt: null,
      }),
    );

    await expect(
      t.service.review(TASK_ID, OWNER_ID, {
        decision: 'request_revision',
        note: 'Tighten the last two shots.',
      }),
    ).resolves.toMatchObject({
      status: CrewTaskStatus.revision_requested,
    });

    expect(t.tx.crewSettlementItem.create).not.toHaveBeenCalled();
    const [updateInput] = t.tx.crewTask.update.mock.calls[0] as unknown as [
      {
        where: { id: string };
        data: {
          status: CrewTaskStatus;
          submittedAt: Date | null;
        };
        include: unknown;
      },
    ];
    expect(updateInput).toMatchObject({
      where: { id: TASK_ID },
      data: {
        status: CrewTaskStatus.revision_requested,
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

  it('atomically debits accrued points when cashing out a settlement', async () => {
    const t = build();
    const pending = {
      id: '01910d50-4c88-7c78-92d4-16892c06c001',
      taskId: TASK_ID,
      crewMemberId: 'crew-member-1',
      userId: ASSIGNEE_ID,
      pointsAmount: 120000n,
      pointsPerUsd: 100,
      payoutAmountMinor: null,
      payoutCurrency: null,
      accrualTransactionId: 'wallet-accrual-transaction-1',
      cashOutTransactionId: null,
      status: CrewSettlementStatus.pending,
      settledAt: null,
      settledByUserId: null,
      note: null,
      createdAt: new Date('2026-07-29T10:00:00.000Z'),
      updatedAt: new Date('2026-07-29T10:00:00.000Z'),
      task: {
        id: TASK_ID,
        crewId: CREW_ID,
        title: 'Finish SC.010 storyboard',
      },
    };
    const settled = {
      ...pending,
      payoutAmountMinor: pending.pointsAmount,
      payoutCurrency: 'USD',
      cashOutTransactionId: 'wallet-cash-out-transaction-1',
      status: CrewSettlementStatus.settled,
      settledAt: new Date('2026-07-29T11:00:00.000Z'),
      settledByUserId: OWNER_ID,
      note: 'Paid in the July run.',
      updatedAt: new Date('2026-07-29T11:00:00.000Z'),
    };
    t.prisma.crewSettlementItem.findUnique.mockResolvedValue(pending);
    t.tx.crewSettlementItem.findUnique.mockResolvedValue(pending);
    t.tx.crewSettlementItem.update.mockResolvedValue(settled);
    t.tx.walletAccount.findUnique.mockResolvedValue({
      id: 'wallet-account-1',
    });
    t.walletLedger.postEntryTx.mockResolvedValue({
      transaction: { id: 'wallet-cash-out-transaction-1' },
    });

    await expect(
      t.service.settle(pending.id, OWNER_ID, {
        note: 'Paid in the July run.',
      }),
    ).resolves.toMatchObject({
      id: pending.id,
      pointsAmount: 120000,
      payoutAmountMinor: 120000,
      payoutCurrency: 'USD',
      status: CrewSettlementStatus.settled,
      cashOutTransactionId: 'wallet-cash-out-transaction-1',
    });

    expect(t.walletLedger.postEntryTx).toHaveBeenCalledWith(
      t.tx,
      expect.objectContaining({
        accountId: 'wallet-account-1',
        amount: 120000n,
        availableDelta: -120000n,
        idempotencyKey: `crew-settlement-cash-out:${pending.id}`,
      }),
    );
    const settlementUpdateCalls = t.tx.crewSettlementItem.update.mock
      .calls as unknown as Array<
      [
        {
          where: { id: string };
          data: {
            status: CrewSettlementStatus;
            payoutAmountMinor: bigint;
            payoutCurrency: string;
            cashOutTransactionId: string;
            settledAt: unknown;
            settledByUserId: string;
            note: string;
          };
          include: { task: boolean };
        },
      ]
    >;
    const settlementUpdate = settlementUpdateCalls[0]?.[0];
    expect(settlementUpdate).toMatchObject({
      where: { id: pending.id },
      data: {
        status: CrewSettlementStatus.settled,
        payoutAmountMinor: 120000n,
        payoutCurrency: 'USD',
        cashOutTransactionId: 'wallet-cash-out-transaction-1',
        settledByUserId: OWNER_ID,
        note: 'Paid in the July run.',
      },
      include: { task: true },
    });
    expect(settlementUpdate?.data.settledAt).toBeInstanceOf(Date);
    expect(t.notifications.send).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: ASSIGNEE_ID,
        type: 'crew.settlement.settled',
        idempotencyKey: `crew.settlement.settled:${pending.id}`,
      }),
      t.tx,
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
