import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { Client } from 'pg';
import { postgresFixtureUrl } from '../../common/__tests__/postgres-fixture-url';
import { newCrewDomainId } from '../id';
import {
  claimTaskInviteTarget,
  lockTaskInviteTarget,
} from './task-invite-claim';

const url = process.env.TASK01_TEST_DATABASE_URL;
(url ? describe : describe.skip)('Task claims (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let crewId: string;
  let stateId: string;
  let sequence = 0;
  beforeAll(async () => {
    const target = postgresFixtureUrl(url!);
    if (
      target.hostname !== '127.0.0.1' ||
      target.port !== '55439' ||
      target.pathname !== '/task01'
    )
      throw new Error('Owned loopback fixture required');
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
    crewId = `claim-${randomUUID()}`;
    await db.crew.create({
      data: {
        id: crewId,
        name: 'Claim fixture',
        description: '',
        logo: 'https://assets.invalid/logo.png',
        createdByUserId: 'fixture',
      },
    });
    stateId = (
      await db.crewTaskWorkflowState.create({
        data: {
          crewId,
          name: 'Open',
          color: '#888888',
          semantic: 'open',
          systemKey: 'open',
          position: 0,
          createdByUserId: 'fixture',
        },
      })
    ).id;
  });
  afterAll(async () => {
    // Assignments reference members with RESTRICT; remove tasks first.
    if (crewId) {
      await db.crewTask.deleteMany({ where: { crewId } });
      await db.crew.delete({ where: { id: crewId } });
    }
    await db?.$disconnect();
  });
  async function task() {
    return db.crewTask.create({
      data: {
        crewId,
        title: 'Claim fixture',
        number: ++sequence,
        workflowStateId: stateId,
        createdByUserId: 'fixture',
        metadata: { compensation: { rewardUsdMinor: 12500 } },
      },
    });
  }
  async function member() {
    return db.crewMember.create({
      data: {
        id: newCrewDomainId(),
        crewId,
        userId: `claim-${randomUUID()}`,
        joinedVia: 'invitation',
      },
    });
  }
  it('claims using real short member IDs and records exact compensation', async () => {
    const item = await task();
    const creator = await member();
    await db.$transaction(async (tx) => {
      const locked = await lockTaskInviteTarget(tx, crewId, item.id, 1);
      await claimTaskInviteTarget(
        tx,
        locked,
        creator.id,
        creator.userId,
        'fixture',
        'fixture-link',
      );
    });
    expect(
      await db.crewTaskAssignee.findFirst({ where: { taskId: item.id } }),
    ).toMatchObject({ crewMemberId: creator.id, rewardAmountMinor: 12500n });
    expect(
      (await db.crewTask.findUniqueOrThrow({ where: { id: item.id } })).version,
    ).toBe(2);
  });
  it('admits one winner when separate links concurrently claim the same task', async () => {
    const item = await task();
    const creators = await Promise.all([member(), member()]);
    const results = await Promise.allSettled(
      creators.map((creator) =>
        db.$transaction(async (tx) => {
          const locked = await lockTaskInviteTarget(tx, crewId, item.id, 1);
          await claimTaskInviteTarget(
            tx,
            locked,
            creator.id,
            creator.userId,
            'fixture',
            randomUUID(),
          );
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      await db.crewTaskAssignee.count({ where: { taskId: item.id } }),
    ).toBe(1);
    expect(
      (await db.crewTask.findUniqueOrThrow({ where: { id: item.id } })).version,
    ).toBe(2);
  });
  it('rolls back membership, assignment, version and audit on later failure', async () => {
    const item = await task();
    const memberId = newCrewDomainId();
    const userId = `rollback-${randomUUID()}`;
    await expect(
      db.$transaction(async (tx) => {
        const locked = await lockTaskInviteTarget(tx, crewId, item.id, 1);
        await tx.crewMember.create({
          data: { id: memberId, crewId, userId, joinedVia: 'invitation' },
        });
        await claimTaskInviteTarget(
          tx,
          locked,
          memberId,
          userId,
          'fixture',
          'rollback-link',
        );
        throw new Error('durable notification failed');
      }),
    ).rejects.toThrow('durable notification failed');
    expect(await db.crewMember.count({ where: { id: memberId } })).toBe(0);
    expect(
      await db.crewTaskAssignee.count({ where: { taskId: item.id } }),
    ).toBe(0);
    expect(
      await db.crewAuthorizationEvent.count({
        where: { crewId, actorUserId: userId },
      }),
    ).toBe(0);
    expect(
      (await db.crewTask.findUniqueOrThrow({ where: { id: item.id } })).version,
    ).toBe(1);
  });
  it('holds membership against concurrent suspension until the claim commits', async () => {
    const item = await task();
    const creator = await member();
    const other = new Client({ connectionString: url });
    await other.connect();
    try {
      await other.query("SET lock_timeout = '150ms'");
      await db.$transaction(async (tx) => {
        const locked = await lockTaskInviteTarget(tx, crewId, item.id, 1);
        await claimTaskInviteTarget(
          tx,
          locked,
          creator.id,
          creator.userId,
          'fixture',
          'locked-link',
        );
        await expect(
          other.query(
            "UPDATE crew_members SET status='suspended', suspended_at=NOW() WHERE id=$1",
            [creator.id],
          ),
        ).rejects.toMatchObject({ code: '55P03' });
      });
      await expect(
        other.query(
          "UPDATE crew_members SET status='suspended', suspended_at=NOW() WHERE id=$1",
          [creator.id],
        ),
      ).resolves.toMatchObject({ rowCount: 1 });
    } finally {
      await other.end();
    }
  });
  it('rejects a member suspended before the claim without creating an assignment', async () => {
    const item = await task();
    const creator = await member();
    await db.crewMember.update({
      where: { id: creator.id },
      data: { status: 'suspended', suspendedAt: new Date() },
    });
    await expect(
      db.$transaction(async (tx) => {
        const locked = await lockTaskInviteTarget(tx, crewId, item.id, 1);
        await claimTaskInviteTarget(
          tx,
          locked,
          creator.id,
          creator.userId,
          'fixture',
          'suspended-link',
        );
      }),
    ).rejects.toThrow('active Crew membership');
    expect(
      await db.crewTaskAssignee.count({ where: { taskId: item.id } }),
    ).toBe(0);
  });
});
