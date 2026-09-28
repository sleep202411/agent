import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { NotificationService } from '../notification/notification.service';
import { PositionsService } from './positions.service';
import { ApplicationsService } from './applications.service';
import { CreatePositionSchema } from './dto';
import { CrewAuthorizationService } from './crew-authorization.service';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `recruitment-${randomUUID()}`;
jest.setTimeout(30000);
integration(
  'Recruitment write eligibility after waits (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let service: PositionsService;
    let applications: ApplicationsService;
    let positionId: string;
    const notifications = { send: jest.fn().mockResolvedValue(undefined) };
    let crewId: string;
    let memberId: string;
    let userId: string;
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        !(
          (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test') ||
          (url.port === '55439' && url.pathname === '/task01')
        )
      )
        throw new Error('Owned loopback fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({
          connectionString: databaseUrl,
          options: '-c timezone=UTC',
          application_name: applicationName,
        }),
        transactionOptions: { timeout: 15000 },
      });
      await db.$connect();
      const authorization = new CrewAuthorizationService(db as PrismaService);
      service = new PositionsService(db as PrismaService, authorization);
      applications = new ApplicationsService(
        db as PrismaService,
        notifications as unknown as ConstructorParameters<
          typeof ApplicationsService
        >[1],
        {} as ConstructorParameters<typeof ApplicationsService>[2],
        {} as ConstructorParameters<typeof ApplicationsService>[3],
        authorization,
      );
    });
    beforeEach(async () => {
      crewId = randomUUID();
      memberId = randomUUID();
      userId = randomUUID();
      await db.crew.create({
        data: {
          id: crewId,
          name: 'Original',
          description: '',
          logo: 'fixture.png',
          createdByUserId: 'fixture-owner',
        },
      });
      const ownerMember = await db.crewMember.create({
        data: {
          id: randomUUID(),
          crewId,
          userId: 'fixture-owner',
          joinedVia: 'creation',
        },
      });
      await db.crewOwnership.create({
        data: { crewId, memberId: ownerMember.id },
      });
      await db.crewMember.create({
        data: { id: memberId, crewId, userId, joinedVia: 'invitation' },
      });
      await db.crewMemberPermissionOverride.create({
        data: {
          memberId,
          permissionKey: 'openings.manage',
          effect: 'allow',
          changedByUserId: 'fixture-owner',
        },
      });
      positionId = randomUUID();
      notifications.send.mockClear();
      await db.crewPosition.create({
        data: {
          id: positionId,
          crewId,
          positionType: 'animator',
          description: 'Original',
          targetCount: 2,
        },
      });
    });
    afterEach(async () => {
      await db.notification.deleteMany({
        where: { meta: { path: ['crewId'], equals: crewId } },
      });
      await db.crew.delete({ where: { id: crewId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });

    const perform = (kind: 'create' | 'update' | 'delete') =>
      kind === 'create'
        ? service.create(
            crewId,
            userId,
            CreatePositionSchema.parse({
              positionType: 'animator',
              description: 'New',
              targetCount: 1,
            }),
          )
        : kind === 'update'
          ? service.update(crewId, positionId, userId, {
              description: 'Changed',
            })
          : service.delete(crewId, positionId, userId);
    const waitForLock = async () => {
      const deadline = Date.now() + 5000;
      while (true) {
        const [row] = await db.$queryRaw<
          { count: bigint }[]
        >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock'`;
        if (Number(row.count) > 0) return;
        if (Date.now() > deadline)
          throw new Error('Expected recruitment row wait');
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    };
    it.each(['create', 'update', 'delete'] as const)(
      'rejects %s after management permission is withdrawn while waiting',
      async (kind) => {
        const before = await db.crewPosition.findUniqueOrThrow({
          where: { id: positionId },
        });
        let release!: () => void;
        let admitted!: () => void;
        const gate = new Promise<void>((r) => {
          release = r;
        });
        const ready = new Promise<void>((r) => {
          admitted = r;
        });
        const holder = db.$transaction(async (tx) => {
          if (kind === 'create')
            await tx.$queryRaw`SELECT id FROM crews WHERE id=${crewId} FOR UPDATE`;
          else
            await tx.$queryRaw`SELECT id FROM crew_positions WHERE id=${positionId} FOR UPDATE`;
          admitted();
          await gate;
          await tx.crewMemberPermissionOverride.deleteMany({
            where: { memberId },
          });
        });
        await ready;
        const pending = perform(kind);
        void pending.catch(() => undefined);
        try {
          await waitForLock();
        } finally {
          release();
        }
        await holder;
        await expect(pending).rejects.toMatchObject({ status: 403 });
        expect(
          await db.crewPosition.findUniqueOrThrow({
            where: { id: positionId },
          }),
        ).toEqual(before);
        expect(await db.crewPosition.count({ where: { crewId } })).toBe(1);
      },
    );
    it('rechecks recruited capacity after the position wait instead of applying a stale lower target', async () => {
      let release!: () => void;
      let admitted!: () => void;
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const ready = new Promise<void>((r) => {
        admitted = r;
      });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM crew_positions WHERE id=${positionId} FOR UPDATE`;
        admitted();
        await gate;
        await tx.crewPosition.update({
          where: { id: positionId },
          data: { recruitedCount: 2, status: 'full' },
        });
      });
      await ready;
      const pending = service.update(crewId, positionId, userId, {
        targetCount: 1,
      });
      void pending.catch(() => undefined);
      try {
        await waitForLock();
      } finally {
        release();
      }
      await holder;
      await expect(pending).rejects.toMatchObject({ status: 400 });
      expect(
        await db.crewPosition.findUniqueOrThrow({ where: { id: positionId } }),
      ).toMatchObject({ targetCount: 2, recruitedCount: 2, status: 'full' });
    });
    it.each(['frozen', 'deleted'] as const)(
      'rejects an application when its position becomes %s during the wait',
      async (change) => {
        let release!: () => void;
        let admitted!: () => void;
        const gate = new Promise<void>((r) => {
          release = r;
        });
        const ready = new Promise<void>((r) => {
          admitted = r;
        });
        const holder = db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM crew_positions WHERE id=${positionId} FOR UPDATE`;
          admitted();
          await gate;
          await tx.crewPosition.update({
            where: { id: positionId },
            data:
              change === 'frozen'
                ? { status: 'frozen' }
                : { deletedAt: new Date() },
          });
        });
        await ready;
        const pending = applications.apply(crewId, positionId, 'applicant', {});
        void pending.catch(() => undefined);
        try {
          await waitForLock();
        } finally {
          release();
        }
        await holder;
        await expect(pending).rejects.toMatchObject({
          status: change === 'frozen' ? 400 : 404,
        });
        expect(await db.crewApplication.count({ where: { crewId } })).toBe(0);
        expect(notifications.send).not.toHaveBeenCalled();
      },
    );
    it('notifies the owner for a new application after rejection without duplicate alerts', async () => {
      const subject = new ApplicationsService(
        db as PrismaService,
        new NotificationService(db as PrismaService),
        {} as ConstructorParameters<typeof ApplicationsService>[2],
        {} as ConstructorParameters<typeof ApplicationsService>[3],
        new CrewAuthorizationService(db as PrismaService),
      );
      const original = await subject.apply(crewId, positionId, 'applicant', {
        message: 'First application',
      });
      await db.crewApplication.update({
        where: { id: original.id },
        data: { status: 'rejected' },
      });
      const attempts = await Promise.allSettled([
        subject.apply(crewId, positionId, 'applicant', {
          message: 'New application',
        }),
        subject.apply(crewId, positionId, 'applicant', {
          message: 'New application',
        }),
      ]);
      expect(
        attempts.filter((attempt) => attempt.status === 'fulfilled'),
      ).toHaveLength(1);
      const rows = await db.crewApplication.findMany({
        where: { crewId },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows).toHaveLength(2);
      const notices = await db.notification.findMany({
        where: {
          type: 'crew.application.submitted',
          meta: { path: ['crewId'], equals: crewId },
        },
      });
      expect(notices).toHaveLength(2);
      for (const row of rows) {
        expect(notices.map((notice) => notice.meta)).toEqual(
          expect.arrayContaining([
            expect.objectContaining({
              applicationId: row.id,
              deeplink: `/crews/${crewId}/workspace?tab=roles&application=${row.id}`,
            }),
          ]),
        );
      }
      expect(
        await db.notificationOutbox.count({
          where: { notificationId: { in: notices.map((notice) => notice.id) } },
        }),
      ).toBe(2);
    });

    it('keeps one concurrent application and blocks deletion while it remains pending', async () => {
      const results = await Promise.allSettled([
        applications.apply(crewId, positionId, 'applicant', {}),
        applications.apply(crewId, positionId, 'applicant', {}),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(await db.crewApplication.count({ where: { crewId } })).toBe(1);
      expect(notifications.send).toHaveBeenCalledTimes(1);
      await expect(
        service.delete(crewId, positionId, userId),
      ).rejects.toMatchObject({ status: 409 });
      expect(
        (await db.crewPosition.findUniqueOrThrow({ where: { id: positionId } }))
          .deletedAt,
      ).toBeNull();
    });
    it.each(['crew', 'position'] as const)(
      'rejects new applications for a taken-down %s without creating a notification',
      async (kind) => {
        if (kind === 'crew')
          await db.crew.update({
            where: { id: crewId },
            data: { moderationStatus: 'taken_down' },
          });
        else
          await db.crewPosition.update({
            where: { id: positionId },
            data: { moderationStatus: 'taken_down' },
          });
        await expect(
          applications.apply(crewId, positionId, 'applicant', {}),
        ).rejects.toMatchObject({ status: 404 });
        expect(await db.crewApplication.count({ where: { crewId } })).toBe(0);
        expect(notifications.send).not.toHaveBeenCalled();
      },
    );
    it.each(['crew', 'position'] as const)(
      'rechecks %s takedown after application admission waits',
      async (kind) => {
        let release!: () => void;
        let admitted!: () => void;
        const gate = new Promise<void>((r) => {
          release = r;
        });
        const ready = new Promise<void>((r) => {
          admitted = r;
        });
        const holder = db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM crew_positions WHERE id=${positionId} FOR UPDATE`;
          admitted();
          await gate;
          if (kind === 'crew')
            await tx.crew.update({
              where: { id: crewId },
              data: { moderationStatus: 'taken_down' },
            });
          else
            await tx.crewPosition.update({
              where: { id: positionId },
              data: { moderationStatus: 'taken_down' },
            });
        });
        await ready;
        const pending = applications.apply(crewId, positionId, 'applicant', {});
        void pending.catch(() => undefined);
        try {
          await waitForLock();
        } finally {
          release();
        }
        await holder;
        await expect(pending).rejects.toMatchObject({ status: 404 });
        expect(await db.crewApplication.count({ where: { crewId } })).toBe(0);
        expect(notifications.send).not.toHaveBeenCalled();
      },
    );
  },
);
