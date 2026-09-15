import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID, randomInt } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { ReferralsService } from './referrals.service';
import { CreateReferralMilestoneSchema } from './dto';
const databaseUrl = process.env.TASK01_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
jest.setTimeout(30000);
integration(
  'Referral configuration response recovery (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let programId: string;
    let createdProgram = false;
    let milestoneId: string;
    let threshold: number;
    const originalInviteBase = process.env.REFERRAL_INVITE_BASE_URL;
    const service = (client: unknown = db) =>
      new ReferralsService(
        client as PrismaService,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.port !== '55439' ||
        url.pathname !== '/task01' ||
        url.search
      )
        throw new Error('Owned task01 fixture required');
      process.env.REFERRAL_INVITE_BASE_URL = 'https://fixture.invalid';
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
      });
      await db.$connect();
      const existing = await db.referralProgram.findUnique({
        where: { key: 'default' },
      });
      createdProgram = !existing;
      programId = (
        existing ??
        (await db.referralProgram.create({ data: { key: 'default' } }))
      ).id;
    });
    beforeEach(async () => {
      milestoneId = '';
      threshold = randomInt(1000000, 2000000);
      milestoneId = (
        await db.referralMilestoneConfig.create({
          data: {
            programId,
            inviteeThreshold: threshold,
            title: randomUUID(),
            detail: 'Fixture',
            payoutType: 'cash',
            rewardMinor: 17n,
          },
        })
      ).id;
    });
    afterEach(async () => {
      if (milestoneId)
        await db.referralMilestoneConfig.delete({ where: { id: milestoneId } });
    });
    afterAll(async () => {
      try {
        if (createdProgram)
          await db.referralProgram.delete({ where: { id: programId } });
      } finally {
        await db?.$disconnect();
        if (originalInviteBase === undefined)
          delete process.env.REFERRAL_INVITE_BASE_URL;
        else process.env.REFERRAL_INVITE_BASE_URL = originalInviteBase;
      }
    });
    const snapshot = () =>
      db.referralProgram.findUnique({
        where: { id: programId },
        include: {
          milestones: { orderBy: { id: 'asc' }, include: { items: true } },
          inviteeBenefitItems: true,
        },
      });
    it.each(['program', 'create', 'update', 'archive'])(
      'rolls back %s configuration if its response read fails',
      async (kind) => {
        const before = await snapshot();
        const failing = db.$extends({
          query: {
            referralProgram: {
              findUnique() {
                return Promise.reject(new Error('fixture response failed'));
              },
            },
          },
        });
        const target = service(failing);
        const action =
          kind === 'program'
            ? target.updateProgram(randomUUID(), { holdDays: 9 })
            : kind === 'create'
              ? target.createMilestone(
                  CreateReferralMilestoneSchema.parse({
                    inviteeThreshold: threshold + 1,
                    title: randomUUID(),
                    payoutType: 'cash',
                    rewardMinor: 19,
                  }),
                )
              : kind === 'update'
                ? target.updateMilestone(milestoneId, { title: 'Changed' })
                : target.archiveMilestone(milestoneId);
        await expect(action).rejects.toThrow('fixture response failed');
        expect(await snapshot()).toEqual(before);
      },
    );
    it('returns the saved milestone while retaining its reward amount', async () => {
      const result = await service().updateMilestone(milestoneId, {
        title: 'Changed',
      });
      expect(result?.milestones.find((m) => m.id === milestoneId)?.title).toBe(
        'Changed',
      );
      expect(
        await db.referralMilestoneConfig.findUnique({
          where: { id: milestoneId },
        }),
      ).toMatchObject({ rewardMinor: 17n });
    });
  },
);
