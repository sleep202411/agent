import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { AdminUsersService } from './admin-users.service';
import { hashAdminPassword } from './admin-password';
import { CreateAdminUserSchema } from './admin-users.dto';
import type { AdminActor } from './admin-auth.types';
const databaseUrl = process.env.TASK01_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
jest.setTimeout(30000);
integration(
  'Administrator creation and update consistency (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let userId: string;
    const password = 'Replacement-Pass-827!X';
    const service = (client: unknown = db) =>
      new AdminUsersService(client as PrismaService);
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        url.port !== '55439' ||
        url.pathname !== '/task01' ||
        url.search
      )
        throw new Error('Owned task01 fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
        transactionOptions: { timeout: 15000 },
      });
      await db.$connect();
    });
    beforeEach(async () => {
      userId = (
        await db.adminUser.create({
          data: {
            email: `${randomUUID()}@fixture.invalid`,
            displayName: 'Fixture',
            passwordHash: hashAdminPassword('Original-Pass-827!X'),
            status: 'active',
            requireMfa: true,
            mfaSecretHash: 'fixture-secret',
            mfaEnabledAt: new Date(),
          },
        })
      ).id;
      await db.adminSession.create({
        data: {
          userId,
          tokenHash: randomUUID(),
          expiresAt: new Date('2100-01-01'),
        },
      });
      await db.adminSession.create({
        data: {
          userId,
          tokenHash: randomUUID(),
          expiresAt: new Date('2100-01-01'),
        },
      });
      await db.adminMfaChallenge.create({
        data: {
          userId,
          tokenHash: randomUUID(),
          purpose: 'verify',
          expiresAt: new Date('2100-01-01'),
        },
      });
    });
    afterEach(async () => {
      await db.adminUser.delete({ where: { id: userId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    const snapshot = async () => ({
      user: await db.adminUser.findUnique({ where: { id: userId } }),
      sessions: await db.adminSession.findMany({
        where: { userId },
        orderBy: { id: 'asc' },
      }),
      history: await db.adminPasswordHistory.findMany({ where: { userId } }),
      challenges: await db.adminMfaChallenge.findMany({ where: { userId } }),
    });
    const actor = () =>
      ({ id: randomUUID(), sessionId: randomUUID() }) as AdminActor;
    const input = () =>
      CreateAdminUserSchema.parse({
        email: `${randomUUID()}@fixture.invalid`,
        displayName: 'New fixture',
        password,
      });
    it('rolls back creation when password-history storage fails', async () => {
      const data = input();
      const failing = db.$extends({
        query: {
          adminPasswordHistory: {
            create() {
              return Promise.reject(new Error('history failed'));
            },
          },
        },
      });
      await expect(service(failing).create(data)).rejects.toThrow(
        'history failed',
      );
      expect(await db.adminUser.count({ where: { email: data.email } })).toBe(
        0,
      );
    });
    it('rolls back creation when role insertion fails', async () => {
      const data = input();
      const failing = db.$extends({
        query: {
          adminUserRole: {
            createMany() {
              return Promise.reject(new Error('role failed'));
            },
          },
        },
      });
      await expect(service(failing).create(data)).rejects.toThrow(
        'role failed',
      );
      expect(await db.adminUser.count({ where: { email: data.email } })).toBe(
        0,
      );
    });
    it('returns a fully assigned account and a friendly concurrent email conflict', async () => {
      const data = input();
      try {
        const results = await Promise.allSettled([
          service().create(data),
          service().create(data),
        ]);
        expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
        expect(results.find((r) => r.status === 'rejected')).toMatchObject({
          reason: { status: 409 },
        });
        const row = await db.adminUser.findUniqueOrThrow({
          where: { email: data.email },
          include: { roles: true, passwordHistory: true },
        });
        expect(row.roles).toHaveLength(1);
        expect(row.passwordHistory).toHaveLength(1);
      } finally {
        await db.adminUser.deleteMany({ where: { email: data.email } });
      }
    });
    it('rolls back account fields if role replacement fails', async () => {
      const before = await snapshot();
      const failing = db.$extends({
        query: {
          adminUserRole: {
            createMany() {
              return Promise.reject(new Error('role failed'));
            },
          },
        },
      });
      await expect(
        service(failing).update(actor(), userId, {
          displayName: 'Changed',
          roleKey: 'operations',
        }),
      ).rejects.toThrow('role failed');
      expect(await snapshot()).toEqual(before);
    });
    it('rolls back suspension if session revocation fails', async () => {
      const before = await snapshot();
      const failing = db.$extends({
        query: {
          adminSession: {
            updateMany() {
              return Promise.reject(new Error('revoke failed'));
            },
          },
        },
      });
      await expect(
        service(failing).update(actor(), userId, { status: 'suspended' }),
      ).rejects.toThrow('revoke failed');
      expect(await snapshot()).toEqual(before);
    });
    it('retains the existing self-security restriction', async () => {
      const before = await snapshot();
      await expect(
        service().update({ ...actor(), id: userId }, userId, {
          status: 'disabled',
        }),
      ).rejects.toMatchObject({ status: 400 });
      expect(await snapshot()).toEqual(before);
    });
  },
);
