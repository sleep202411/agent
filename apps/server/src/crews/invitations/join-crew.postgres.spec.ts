import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { workspaceTestDatabase } from '../production/__tests__/workspace-test-database';
import { joinCrewInTransaction, type CrewJoinDeps } from './join-crew';

jest.setTimeout(15000);
const url = workspaceTestDatabase(process.env);
const applicationName = `crew-join-${randomUUID()}`;
(url ? describe : describe.skip)(
  'Invitation membership admission (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let crewId: string;
    let userId: string;
    const ownerId = randomUUID();
    const conversations = {
      openCrewConversation: jest
        .fn()
        .mockResolvedValue({ id: 'fixture-conversation' }),
      syncCrewParticipant: jest.fn().mockResolvedValue(undefined),
      persistSystem: jest.fn().mockResolvedValue({ id: 'fixture-message' }),
    };
    const collaboration = {
      addCrewMemberAccess: jest.fn().mockResolvedValue(undefined),
    };
    const deps = { conversations, collaboration } as unknown as CrewJoinDeps;
    beforeAll(() => {
      db = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: url,
          application_name: applicationName,
        }),
        transactionOptions: { timeout: 15000 },
      });
    });
    beforeEach(async () => {
      jest.clearAllMocks();
      conversations.openCrewConversation.mockResolvedValue({
        id: 'fixture-conversation',
      });
      crewId = randomUUID();
      userId = randomUUID();
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Join fixture',
          description: '',
          logo: '/fixture.png',
          createdByUserId: ownerId,
        },
      });
    });
    afterEach(async () => {
      await db.crew.delete({ where: { id: crewId } });
    });
    afterAll(async () => {
      await db.$disconnect();
    });
    const join = (
      action = 'member.joined.invitation',
      policyKeys: string[] = [],
    ) =>
      db.$transaction((tx) =>
        joinCrewInTransaction(tx, deps, {
          crewId,
          userId,
          policyKeys,
          grantedByUserId: ownerId,
          action,
        }),
      );

    it('returns a membership conflict for competing named/link admissions without duplicate effects', async () => {
      let admitted!: () => void;
      let release!: () => void;
      const firstAdmitted = new Promise<void>((resolve) => {
        admitted = resolve;
      });
      const resume = new Promise<void>((resolve) => {
        release = resolve;
      });
      conversations.openCrewConversation.mockImplementationOnce(() => {
        admitted();
        return resume.then(() => ({ id: 'fixture-conversation' }));
      });
      const first = join();
      await firstAdmitted;
      const second = join('member.joined.link');
      const results = Promise.allSettled([first, second]);
      let waiting = false;
      try {
        const deadline = Date.now() + 5000;
        while (Date.now() < deadline) {
          const rows = await db.$queryRaw<
            Array<{ waiting: boolean }>
          >`SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE application_name = ${applicationName} AND wait_event_type = 'Lock') AS waiting`;
          if (rows[0]?.waiting) {
            waiting = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        release();
        await results;
      }
      const settled = await results;
      expect(waiting).toBe(true);
      expect(settled[0].status).toBe('fulfilled');
      expect(settled[1].status).toBe('rejected');
      if (settled[1].status === 'rejected')
        expect(settled[1].reason).toBeInstanceOf(ConflictException);
      expect(await db.crewMember.count({ where: { crewId } })).toBe(1);
      expect(await db.crewAuthorizationEvent.count({ where: { crewId } })).toBe(
        1,
      );
      expect(conversations.persistSystem).toHaveBeenCalledTimes(1);
      expect(collaboration.addCrewMemberAccess).toHaveBeenCalledTimes(1);
    });

    it('stores a repeated valid policy once in grants and the audit payload', async () => {
      const result = await join('member.joined.invitation', [
        'finance',
        'finance',
      ]);
      expect(
        await db.crewMemberPolicy.count({
          where: { memberId: result.memberId },
        }),
      ).toBe(1);
      const event = await db.crewAuthorizationEvent.findFirstOrThrow({
        where: { crewId },
      });
      expect(event.after).toEqual({ policyKeys: ['finance'] });
    });

    it('rejects suspended membership before creating collaboration effects', async () => {
      await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId,
          joinedVia: 'invitation',
          status: 'suspended',
          suspendedAt: new Date(),
        },
      });
      await expect(join()).rejects.toBeInstanceOf(ConflictException);
      expect(conversations.openCrewConversation).not.toHaveBeenCalled();
      expect(collaboration.addCrewMemberAccess).not.toHaveBeenCalled();
    });

    it('retains removed membership history when a named invitation readmits the user', async () => {
      await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId,
          joinedVia: 'invitation',
          status: 'removed',
          removedAt: new Date(),
        },
      });
      await join();
      expect(await db.crewMember.count({ where: { crewId, userId } })).toBe(2);
      expect(
        await db.crewMember.count({
          where: { crewId, userId, status: 'active' },
        }),
      ).toBe(1);
    });
  },
);
