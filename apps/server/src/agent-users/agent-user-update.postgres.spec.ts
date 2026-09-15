import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID, randomInt } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { encodeUserId } from '@repo/shared';
import type { PrismaService } from '../infra/db/db.module';
import {
  ListAdminAgentUsersQuerySchema,
  ListAgentRunsQuerySchema,
  ListAgentActionsQuerySchema,
  ListAgentMemoriesQuerySchema,
  CompleteAgentRunSchema,
  CreateAgentRunSchema,
  CreateAgentActionSchema,
} from './dto';
import { AgentUsersService } from './agent-users.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `agent-user-admin-${randomUUID()}`;
jest.setTimeout(30000);
integration('Agent-user administration (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let service: AgentUsersService;
  const adminId = randomUUID();
  let agentId: string;
  let handle: string;
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['127.0.0.1', 'localhost'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01'
    )
      throw new Error('Owned task01 fixture required');
    db = new PrismaClient({
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
        application_name: applicationName,
      }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
    service = new AgentUsersService(db as PrismaService);
  });
  beforeEach(async () => {
    handle = `fixture-${randomUUID()}`;
    agentId = (
      await db.agentUser.create({ data: { handle, displayName: 'Original' } })
    ).id;
  });
  afterEach(async () => {
    jest.restoreAllMocks();
    await db.agentUser.deleteMany({
      where: { handle: { startsWith: handle } },
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const waitForLock = async () => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      const [row] = await db.$queryRaw<
        { count: bigint }[]
      >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
      if (Number(row.count)) return;
      await new Promise((r) => setTimeout(r, 10));
    }
    throw new Error('Expected agent administrator write wait');
  };
  it('persists the decoded binding consistently with creation', async () => {
    const raw = String(randomInt(100000000, 2000000000));
    const encoded = encodeUserId(raw);
    expect(encoded).not.toBe(raw);
    await service.updateAdmin(agentId, { platformUserId: encoded }, adminId);
    expect(
      (await db.agentUser.findUniqueOrThrow({ where: { id: agentId } }))
        .platformUserId,
    ).toBe(raw);
  });
  it('preserves identity and disablement committed during a competing update', async () => {
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const raw = String(randomInt(100000000, 2000000000));
    const disabledAt = new Date('2026-01-01T00:00:00Z');
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM agent_users WHERE id=${agentId}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.agentUser.update({
        where: { id: agentId },
        data: {
          platformUserId: raw,
          identityStatus: 'bound',
          displayName: 'Concurrent',
          status: 'disabled',
          disabledAt,
        },
      });
    });
    await acquired;
    const pending = service.updateAdmin(
      agentId,
      { notes: 'New notes' },
      adminId,
    );
    void pending.catch(() => undefined);
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    await pending;
    const current = await db.agentUser.findUniqueOrThrow({
      where: { id: agentId },
    });
    expect(current).toMatchObject({
      platformUserId: raw,
      identityStatus: 'bound',
      displayName: 'Concurrent',
      notes: 'New notes',
      status: 'disabled',
      disabledAt,
    });
  });
  it('retains the first archive timestamp after a competing archive commits', async () => {
    const memory = await db.agentMemory.create({
      data: { agentUserId: agentId, type: 'fact', summary: 'Original' },
    });
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const acquired = new Promise<void>((r) => {
      ready = r;
    });
    const archivedAt = new Date('2026-01-01T00:00:00Z');
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM agent_memories WHERE id=${memory.id}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.agentMemory.update({
        where: { id: memory.id },
        data: { status: 'archived', archivedAt, summary: 'Concurrent' },
      });
    });
    await acquired;
    const pending = service.updateMemory(agentId, memory.id, {
      status: 'archived',
      weight: 42,
    });
    void pending.catch(() => undefined);
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    await pending;
    expect(
      await db.agentMemory.findUniqueOrThrow({ where: { id: memory.id } }),
    ).toMatchObject({
      status: 'archived',
      archivedAt,
      summary: 'Concurrent',
      weight: 42,
    });
    await service.updateMemory(agentId, memory.id, { status: 'active' });
    expect(
      await db.agentMemory.findUniqueOrThrow({ where: { id: memory.id } }),
    ).toMatchObject({ status: 'active', archivedAt: null });
  });
  it('rejects foreign memories and source actions without changing the memory', async () => {
    const other = await db.agentUser.create({
      data: { handle: `${handle}-other`, displayName: 'Other' },
    });
    const memory = await db.agentMemory.create({
      data: { agentUserId: agentId, type: 'fact', summary: 'Original' },
    });
    const foreignAction = await db.agentAction.create({
      data: { agentUserId: other.id, actionType: 'fixture' },
    });
    await expect(
      service.updateMemory(other.id, memory.id, { summary: 'Wrong' }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      service.updateMemory(agentId, memory.id, {
        summary: 'Wrong',
        sourceActionIds: [foreignAction.id],
      }),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      await db.agentMemory.findUniqueOrThrow({ where: { id: memory.id } }),
    ).toMatchObject({ summary: 'Original', sourceActionIds: [] });
    const ownedAction = await db.agentAction.create({
      data: { agentUserId: agentId, actionType: 'fixture' },
    });
    await service.updateMemory(agentId, memory.id, {
      sourceActionIds: [ownedAction.id, ownedAction.id],
    });
    expect(
      await db.agentMemory.findUniqueOrThrow({ where: { id: memory.id } }),
    ).toMatchObject({ sourceActionIds: [ownedAction.id] });
  });
  it('allows only one terminal run completion across concurrent callers', async () => {
    const run = await db.agentRun.create({
      data: {
        agentUserId: agentId,
        trigger: 'fixture',
        status: 'running',
        startedAt: new Date('2026-01-01'),
      },
    });
    const results = await Promise.allSettled(
      ['succeeded', 'failed'].map((status) =>
        service.completeRun(
          run.id,
          CompleteAgentRunSchema.parse({ status, summary: status }),
        ),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { status: 400 } });
    const stored = await db.agentRun.findUniqueOrThrow({
      where: { id: run.id },
    });
    expect(stored.summary).toBe(stored.status);
    await expect(
      service.completeRun(
        run.id,
        CompleteAgentRunSchema.parse({ status: 'cancelled' }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(
      (await db.agentRun.findUniqueOrThrow({ where: { id: run.id } }))
        .completedAt,
    ).toEqual(stored.completedAt);
  });

  it('recovers identical action receipts and rejects another agent or changed terms', async () => {
    const other = await db.agentUser.create({
      data: { handle: `${handle}-other`, displayName: 'Other' },
    });
    const input = CreateAgentActionSchema.parse({
      actionType: 'fixture',
      idempotencyKey: randomUUID(),
      input: { longField: 1, a: 2 },
    });
    const [first, second] = await Promise.all([
      service.createAction(agentId, input),
      service.createAction(agentId, input),
    ]);
    expect(first.id).toBe(second.id);
    expect(
      (
        await service.createAction(agentId, {
          ...input,
          input: { a: 2, longField: 1 },
        })
      ).id,
    ).toBe(first.id);
    expect(
      await service.createAction(agentId, {
        ...input,
        status: 'skipped',
        result: { recorded: false },
        metadata: { retry: true },
      }),
    ).toMatchObject({
      id: first.id,
      status: first.status,
      result: first.result,
    });
    await expect(service.createAction(other.id, input)).rejects.toMatchObject({
      status: 409,
    });
    for (const changed of [
      { actionType: 'other' },
      { targetId: 'changed' },
      { input: { a: 3 } },
    ]) {
      await expect(
        service.createAction(agentId, { ...input, ...changed }),
      ).rejects.toMatchObject({ status: 409 });
    }
    expect(
      await db.agentAction.count({
        where: { idempotencyKey: input.idempotencyKey },
      }),
    ).toBe(1);
  });

  it('rejects conflicting action receipts recovered through concurrent inserts', async () => {
    const other = await db.agentUser.create({
      data: { handle: `${handle}-other`, displayName: 'Other' },
    });
    const input = CreateAgentActionSchema.parse({
      actionType: 'fixture',
      idempotencyKey: randomUUID(),
    });
    const results = await Promise.allSettled(
      [agentId, other.id].map((id) => service.createAction(id, input)),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'rejected'),
    ).toMatchObject({ reason: { status: 409 } });
  });
  it('does not create a run after a competing disablement commits', async () => {
    await db.agentUser.update({
      where: { id: agentId },
      data: { status: 'active' },
    });
    let release!: () => void;
    let ready!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const acquired = new Promise<void>((resolve) => {
      ready = resolve;
    });
    const holder = db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM agent_users WHERE id=${agentId}::uuid FOR UPDATE`;
      ready();
      await gate;
      await tx.agentUser.update({
        where: { id: agentId },
        data: { status: 'disabled', disabledAt: new Date() },
      });
    });
    await acquired;
    const pending = service.createRun(
      agentId,
      CreateAgentRunSchema.parse({ status: 'running' }),
    );
    const rejected = expect(pending).rejects.toMatchObject({ status: 400 });
    try {
      await waitForLock();
    } finally {
      release();
    }
    await holder;
    await rejected;
    expect(await db.agentRun.count({ where: { agentUserId: agentId } })).toBe(
      0,
    );
  });
  it.each(['runs', 'actions', 'memories'] as const)(
    'keeps tied %s stable across pages and detail previews',
    async (kind) => {
      const ids = Array.from({ length: 7 }, () => randomUUID());
      const at = new Date('2026-01-01');
      if (kind === 'runs')
        await db.agentRun.createMany({
          data: ids.map((id) => ({
            id,
            agentUserId: agentId,
            trigger: 'fixture',
            createdAt: at,
            updatedAt: at,
          })),
        });
      else if (kind === 'actions')
        await db.agentAction.createMany({
          data: ids.map((id) => ({
            id,
            agentUserId: agentId,
            actionType: 'fixture',
            createdAt: at,
            updatedAt: at,
          })),
        });
      else
        await db.agentMemory.createMany({
          data: ids.map((id) => ({
            id,
            agentUserId: agentId,
            type: 'fact',
            summary: 'Fixture',
            createdAt: at,
            updatedAt: at,
          })),
        });
      const found: string[] = [];
      for (let page = 1; page <= 4; page++) {
        const query = { page, pageSize: 2 };
        const result =
          kind === 'runs'
            ? await service.listRuns(
                agentId,
                ListAgentRunsQuerySchema.parse(query),
              )
            : kind === 'actions'
              ? await service.listActions(
                  agentId,
                  ListAgentActionsQuerySchema.parse(query),
                )
              : await service.listMemories(
                  agentId,
                  ListAgentMemoriesQuerySchema.parse(query),
                );
        expect(result.total).toBe(ids.length);
        found.push(...result.items.map((item: { id: string }) => item.id));
      }
      expect(found).toEqual([...ids].sort().reverse());
      expect(new Set(found).size).toBe(ids.length);
      const detail = await service.getAdmin(agentId);
      const preview =
        kind === 'runs'
          ? detail.recentRuns
          : kind === 'actions'
            ? detail.recentActions
            : detail.recentMemories;
      expect(preview.map((item: { id: string }) => item.id)).toEqual(
        [...ids]
          .sort()
          .reverse()
          .slice(0, kind === 'runs' ? 5 : 7),
      );
    },
  );

  it('keeps tied administrator agent pages stable', async () => {
    const at = new Date('2026-01-01');
    await db.agentUser.update({
      where: { id: agentId },
      data: { createdAt: at, updatedAt: at },
    });
    const ids = [agentId, ...Array.from({ length: 4 }, () => randomUUID())];
    await db.agentUser.createMany({
      data: ids.slice(1).map((id, i) => ({
        id,
        handle: `${handle}-${i}`,
        displayName: 'Fixture',
        createdAt: at,
        updatedAt: at,
      })),
    });
    const found: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = await service.listAdmin(
        ListAdminAgentUsersQuerySchema.parse({ q: handle, page, pageSize: 2 }),
      );
      expect(result.total).toBe(ids.length);
      found.push(...result.items.map((item: { id: string }) => item.id));
    }
    expect(found).toEqual([...ids].sort().reverse());
  });
});
