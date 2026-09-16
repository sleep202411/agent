import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { AdminUsersService } from './admin-users.service';
import { hashAdminPassword, verifyAdminPassword } from './admin-password';
const databaseUrl = process.env.TASK01_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
jest.setTimeout(30000);
integration('Administrator reset consistency (owned PostgreSQL)', () => {
  let db: PrismaClient;
  let userId: string;
  let keptSession: string;
  const password = 'Replacement-Pass-827!X';
  const service = (client: unknown = db) =>
    new AdminUsersService(client as PrismaService);
  beforeAll(async () => {
    const url = postgresFixtureUrl(databaseUrl!);
    if (
      !['localhost', '127.0.0.1'].includes(url.hostname) ||
      url.port !== '55439' ||
      url.pathname !== '/task01'
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
    keptSession = (
      await db.adminSession.create({
        data: {
          userId,
          tokenHash: randomUUID(),
          expiresAt: new Date('2100-01-01'),
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
  const reset = (kind: string, client: unknown = db) =>
    kind === 'mfa'
      ? service(client).resetMfa(userId, keptSession)
      : service(client).resetPassword(userId, password, keptSession);
  it.each(['mfa', 'password'])(
    'rolls back %s reset if session revocation fails',
    async (kind) => {
      const before = await snapshot();
      const failing = db.$extends({
        query: {
          adminSession: {
            updateMany() {
              return Promise.reject(new Error('fixture revocation failed'));
            },
          },
        },
      });
      await expect(reset(kind, failing)).rejects.toThrow(
        'fixture revocation failed',
      );
      expect(await snapshot()).toEqual(before);
    },
  );
  it.each(['mfa', 'password'])(
    'commits %s reset, consumes prior challenges and retains the requested session',
    async (kind) => {
      const result = await reset(kind);
      const state = await snapshot();
      expect(result.activeSessionCount).toBe(1);
      expect(state.sessions.find((s) => s.id === keptSession)?.status).toBe(
        'active',
      );
      expect(state.sessions.find((s) => s.id !== keptSession)?.status).toBe(
        'revoked',
      );
      expect(state.challenges.every((c) => c.consumedAt !== null)).toBe(true);
      if (kind === 'mfa')
        expect(state.user).toMatchObject({
          requireMfa: true,
          mfaSecretHash: null,
          mfaEnabledAt: null,
        });
      else {
        expect(verifyAdminPassword(password, state.user!.passwordHash!)).toBe(
          true,
        );
        expect(state.history).toHaveLength(1);
      }
    },
  );
  it('checks current history after concurrent password reset admission', async () => {
    const results = await Promise.allSettled([
      reset('password'),
      reset('password'),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.find((r) => r.status === 'rejected')).toMatchObject({
      reason: { status: 400 },
    });
    expect((await snapshot()).history).toHaveLength(1);
  });
  it('revokes all sessions when no exception is requested', async () => {
    expect(await service().revokeSessions(userId)).toEqual({ revokedCount: 2 });
    expect(
      (await snapshot()).sessions.every((s) => s.status === 'revoked'),
    ).toBe(true);
  });
});
