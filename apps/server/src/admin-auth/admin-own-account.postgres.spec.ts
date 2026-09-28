import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID, createHash, createHmac } from 'node:crypto';
import { encryptTotpSecret } from './admin-mfa';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { AdminAuthService } from './admin-auth.service';
import { hashAdminPassword, verifyAdminPassword } from './admin-password';
import type { AdminActor } from './admin-auth.types';
import type { PrismaService } from '../infra/db/db.module';
const applicationName = `admin-regression-${randomUUID()}`;
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
jest.setTimeout(30000);
integration(
  'Administrator self-service transactions (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let service: AdminAuthService;
    let actor: AdminActor;
    let otherSessionId: string;
    const currentPassword = 'Original-Pass-827!X';
    const newPassword = 'Replacement-Pass-827!X';
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
      service = new AdminAuthService(db as PrismaService);
    });
    beforeEach(async () => {
      const user = await db.adminUser.create({
        data: {
          email: `${randomUUID()}@fixture.invalid`,
          displayName: 'Fixture',
          passwordHash: hashAdminPassword(currentPassword),
          status: 'active',
          mfaSecretHash: 'retained-secret',
          mfaEnabledAt: new Date(),
        },
      });
      const session = await db.adminSession.create({
        data: {
          userId: user.id,
          tokenHash: randomUUID(),
          expiresAt: new Date('2100-01-01'),
        },
      });
      otherSessionId = (
        await db.adminSession.create({
          data: {
            userId: user.id,
            tokenHash: randomUUID(),
            expiresAt: new Date('2100-01-01'),
          },
        })
      ).id;
      actor = {
        id: user.id,
        sessionId: session.id,
        siteScope: 'all',
      } as AdminActor;
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      if (actor) {
        await db.adminAuditLog.deleteMany({
          where: { OR: [{ actorUserId: actor.id }, { resourceId: actor.id }] },
        });
        await db.adminLoginAttempt.deleteMany({ where: { userId: actor.id } });
        await db.adminUser.delete({ where: { id: actor.id } });
      }
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    const sessionToken = 'owned-validation-token';
    async function prepareValidation() {
      await db.adminSession.update({
        where: { id: actor.sessionId },
        data: {
          tokenHash: createHash('sha256').update(sessionToken).digest('hex'),
          ipAddress: 'before',
        },
      });
    }
    it('validates and touches a current session without management permission', async () => {
      await prepareValidation();
      await expect(
        service.validateSession(sessionToken, { ipAddress: 'after' }),
      ).resolves.toMatchObject({ id: actor.id, sessionId: actor.sessionId });
      expect(
        (
          await db.adminSession.findUniqueOrThrow({
            where: { id: actor.sessionId },
          })
        ).ipAddress,
      ).toBe('after');
    });
    it.each(['revoked', 'expired', 'disabled'] as const)(
      'rejects a session made %s during validation admission',
      async (kind) => {
        await prepareValidation();
        let release!: () => void;
        let admitted!: () => void;
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
          admitted = resolve;
        });
        const holder = db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${actor.id}::uuid FOR UPDATE`;
          admitted();
          await gate;
          if (kind === 'disabled')
            await tx.adminUser.update({
              where: { id: actor.id },
              data: { status: 'disabled' },
            });
          else
            await tx.adminSession.update({
              where: { id: actor.sessionId },
              data:
                kind === 'revoked'
                  ? { status: 'revoked' }
                  : { expiresAt: new Date('2000-01-01') },
            });
        });
        await ready;
        const pending = service.validateSession(sessionToken, {
          ipAddress: 'abandoned',
        });
        void pending.catch(() => undefined);
        try {
          const deadline = Date.now() + 5000;
          while (true) {
            const [row] = await db.$queryRaw<
              { count: bigint }[]
            >`SELECT count(*) FROM pg_stat_activity WHERE application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%admin_users%'`;
            if (Number(row.count) > 0) break;
            if (Date.now() > deadline)
              throw new Error('Expected validation admission wait');
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } finally {
          release();
        }
        await holder;
        await expect(pending).rejects.toMatchObject({
          response: { code: 'ADMIN_SESSION_INVALID' },
        });
        expect(
          (
            await db.adminSession.findUniqueOrThrow({
              where: { id: actor.sessionId },
            })
          ).ipAddress,
        ).toBe('before');
      },
    );
    it('rolls back logout when its audit fails, then allows retry without revoking other sessions', async () => {
      jest
        .spyOn(service, 'writeAudit')
        .mockRejectedValueOnce(new Error('Audit unavailable'));
      await expect(service.logout(actor, {})).rejects.toThrow(
        'Audit unavailable',
      );
      expect(
        (
          await db.adminSession.findUniqueOrThrow({
            where: { id: actor.sessionId },
          })
        ).status,
      ).toBe('active');
      await service.logout(actor, {});
      expect(
        (
          await db.adminSession.findUniqueOrThrow({
            where: { id: actor.sessionId },
          })
        ).status,
      ).toBe('revoked');
      expect(
        (
          await db.adminSession.findUniqueOrThrow({
            where: { id: otherSessionId },
          })
        ).status,
      ).toBe('active');
      expect(
        await db.adminAuditLog.count({
          where: { actorUserId: actor.id, action: 'admin.auth.logout' },
        }),
      ).toBe(1);
    });
    const action = (kind: 'profile' | 'password' | 'mfa') =>
      kind === 'profile'
        ? service.updateOwnProfile(actor, { displayName: 'Updated' }, {})
        : kind === 'password'
          ? service.changeOwnPassword(
              actor,
              { currentPassword, newPassword },
              {},
            )
          : service.resetOwnMfa(actor, {});
    it.each(['profile', 'password', 'mfa'] as const)(
      'rolls back %s changes when the success audit cannot be stored',
      async (kind) => {
        const before = await db.adminUser.findUniqueOrThrow({
          where: { id: actor.id },
        });
        jest
          .spyOn(service, 'writeAudit')
          .mockRejectedValueOnce(new Error('Audit unavailable'));
        await expect(action(kind)).rejects.toThrow('Audit unavailable');
        expect(
          await db.adminUser.findUniqueOrThrow({ where: { id: actor.id } }),
        ).toEqual(before);
        expect(
          await db.adminPasswordHistory.count({ where: { userId: actor.id } }),
        ).toBe(0);
        expect(
          (
            await db.adminSession.findUniqueOrThrow({
              where: { id: otherSessionId },
            })
          ).status,
        ).toBe('active');
      },
    );
    it.each(['profile', 'password', 'mfa'] as const)(
      'commits %s with its audit and preserves the acting session without requiring management permission',
      async (kind) => {
        const result = await action(kind);
        expect(result.session.id).toBe(actor.sessionId);
        expect(
          await db.adminAuditLog.count({
            where: { actorUserId: actor.id, outcome: 'success' },
          }),
        ).toBe(1);
        expect(
          (
            await db.adminSession.findUniqueOrThrow({
              where: { id: actor.sessionId },
            })
          ).status,
        ).toBe('active');
        expect(
          (
            await db.adminSession.findUniqueOrThrow({
              where: { id: otherSessionId },
            })
          ).status,
        ).toBe(kind === 'profile' ? 'active' : 'revoked');
      },
    );
    it('accepts only one concurrent password change using the old password and retains the rejected audit', async () => {
      const results = await Promise.allSettled([
        action('password'),
        action('password'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { response: { code: 'ADMIN_CURRENT_PASSWORD_INVALID' } },
      });
      const user = await db.adminUser.findUniqueOrThrow({
        where: { id: actor.id },
      });
      expect(verifyAdminPassword(newPassword, user.passwordHash!)).toBe(true);
      expect(
        await db.adminPasswordHistory.count({ where: { userId: actor.id } }),
      ).toBe(1);
      expect(
        await db.adminAuditLog.count({
          where: { actorUserId: actor.id, outcome: 'failure' },
        }),
      ).toBe(1);
    });
    it.each(['profile', 'password', 'mfa'] as const)(
      'rejects %s after session revocation during the user lock wait',
      async (kind) => {
        let release!: () => void;
        let locked!: () => void;
        const ready = new Promise<void>((resolve) => {
          locked = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const holder = db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${actor.id}::uuid FOR UPDATE`;
          locked();
          await gate;
          await tx.adminSession.update({
            where: { id: actor.sessionId },
            data: { status: 'revoked' },
          });
        });
        await ready;
        const pending = action(kind);
        void pending.catch(() => undefined);
        try {
          const deadline = Date.now() + 5000;
          while (true) {
            const rows = await db.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%admin_users%'`;
            if (rows[0].count > 0n) break;
            if (Date.now() > deadline)
              throw new Error('Expected user lock wait');
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } finally {
          release();
        }
        await holder;
        await expect(pending).rejects.toMatchObject({
          response: { code: 'ADMIN_SESSION_INVALID' },
        });
        expect(
          await db.adminAuditLog.count({ where: { actorUserId: actor.id } }),
        ).toBe(0);
        expect(
          (await db.adminUser.findUniqueOrThrow({ where: { id: actor.id } }))
            .displayName,
        ).toBe('Fixture');
      },
    );

    const fixtureSecret = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';
    const oldKey = process.env.ADMIN_MFA_SECRET_KEY;
    beforeAll(() => {
      process.env.ADMIN_MFA_SECRET_KEY = 'owned-mfa-regression-key';
    });
    afterAll(() => {
      if (oldKey === undefined) delete process.env.ADMIN_MFA_SECRET_KEY;
      else process.env.ADMIN_MFA_SECRET_KEY = oldKey;
    });
    const code = () => {
      const counter = Buffer.alloc(8);
      counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
      const digest = createHmac('sha1', Buffer.alloc(20))
        .update(counter)
        .digest();
      const offset = digest[digest.length - 1] & 15;
      return String(
        (digest.readUInt32BE(offset) & 0x7fffffff) % 1000000,
      ).padStart(6, '0');
    };
    const challenge = async (setup = false) => {
      const challengeToken = randomUUID();
      await db.adminUser.update({
        where: { id: actor.id },
        data: {
          mfaSecretHash: setup ? null : encryptTotpSecret(fixtureSecret),
          requireMfa: true,
        },
      });
      const row = await db.adminMfaChallenge.create({
        data: {
          userId: actor.id,
          tokenHash: createHash('sha256').update(challengeToken).digest('hex'),
          purpose: setup ? 'setup' : 'verify',
          secretEncrypted: setup ? encryptTotpSecret(fixtureSecret) : null,
          expiresAt: new Date(Date.now() + 300000),
        },
      });
      return { row, input: { challengeToken, code: code() } };
    };
    it('consumes a challenge only once across concurrent valid MFA requests', async () => {
      const c = await challenge();
      const results = await Promise.allSettled([
        service.verifyMfa(c.input, {}),
        service.verifyMfa(c.input, {}),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.find((r) => r.status === 'rejected')).toMatchObject({
        reason: { response: { code: 'ADMIN_MFA_CHALLENGE_INVALID' } },
      });
      expect(await db.adminSession.count({ where: { userId: actor.id } })).toBe(
        3,
      );
    });
    it('rolls back enrollment, challenge consumption and session creation after login audit failure, then permits retry', async () => {
      const c = await challenge(true);
      const auditService = new AdminAuthService(db as PrismaService);
      const write = (
        input: Parameters<AdminAuthService['writeAudit']>[0],
        tx: Parameters<AdminAuthService['writeAudit']>[1],
      ) => auditService.writeAudit(input, tx);
      jest
        .spyOn(service, 'writeAudit')
        .mockImplementation((input, tx) =>
          input.action === 'admin.auth.login'
            ? Promise.reject(new Error('Login audit failed'))
            : write(input, tx),
        );
      await expect(service.verifyMfa(c.input, {})).rejects.toThrow(
        'Login audit failed',
      );
      expect(
        (
          await db.adminMfaChallenge.findUniqueOrThrow({
            where: { id: c.row.id },
          })
        ).consumedAt,
      ).toBeNull();
      expect(
        (await db.adminUser.findUniqueOrThrow({ where: { id: actor.id } }))
          .mfaSecretHash,
      ).toBeNull();
      expect(await db.adminSession.count({ where: { userId: actor.id } })).toBe(
        2,
      );
      jest.restoreAllMocks();
      await expect(service.verifyMfa(c.input, {})).resolves.toHaveProperty(
        'sessionToken',
      );
    });
    it('retains invalid-code failure audits without consuming a retryable challenge', async () => {
      const c = await challenge();
      await expect(
        service.verifyMfa({ ...c.input, code: 'invalid' }, {}),
      ).rejects.toMatchObject({ response: { code: 'ADMIN_MFA_CODE_INVALID' } });
      expect(
        (
          await db.adminMfaChallenge.findUniqueOrThrow({
            where: { id: c.row.id },
          })
        ).consumedAt,
      ).toBeNull();
      expect(
        await db.adminAuditLog.count({
          where: { resourceId: actor.id, outcome: 'failure' },
        }),
      ).toBe(1);
      await expect(service.verifyMfa(c.input, {})).resolves.toHaveProperty(
        'sessionToken',
      );
    });
    it.each(['password', 'mfa'] as const)(
      'invalidates pending challenges after own %s reset',
      async (kind) => {
        const c = await challenge();
        await action(kind);
        await expect(service.verifyMfa(c.input, {})).rejects.toMatchObject({
          response: { code: 'ADMIN_MFA_CHALLENGE_INVALID' },
        });
      },
    );
    it('rejects an older enrollment challenge after another enrollment established the secret', async () => {
      const c = await challenge(true);
      await db.adminUser.update({
        where: { id: actor.id },
        data: { mfaSecretHash: encryptTotpSecret(fixtureSecret) },
      });
      await expect(service.verifyMfa(c.input, {})).rejects.toMatchObject({
        response: { code: 'ADMIN_MFA_CHALLENGE_INVALID' },
      });
    });
    it.each(['expired', 'disabled', 'consumed'] as const)(
      'rejects a challenge made %s during the user lock wait',
      async (state) => {
        const c = await challenge();
        let release!: () => void;
        let locked!: () => void;
        const ready = new Promise<void>((resolve) => {
          locked = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const holder = db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${actor.id}::uuid FOR UPDATE`;
          locked();
          await gate;
          if (state === 'disabled')
            await tx.adminUser.update({
              where: { id: actor.id },
              data: { status: 'disabled' },
            });
          else
            await tx.adminMfaChallenge.update({
              where: { id: c.row.id },
              data:
                state === 'expired'
                  ? { expiresAt: new Date(0) }
                  : { consumedAt: new Date() },
            });
        });
        await ready;
        const pending = service.verifyMfa(c.input, {});
        void pending.catch(() => undefined);
        try {
          const deadline = Date.now() + 5000;
          while (true) {
            const rows = await db.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%admin_users%'`;
            if (rows[0].count > 0n) break;
            if (Date.now() > deadline)
              throw new Error('Expected MFA user lock wait');
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } finally {
          release();
        }
        await holder;
        await expect(pending).rejects.toMatchObject({
          response: { code: 'ADMIN_MFA_CHALLENGE_INVALID' },
        });
        expect(
          await db.adminSession.count({ where: { userId: actor.id } }),
        ).toBe(2);
      },
    );
    const loginInput = async () => ({
      email: (await db.adminUser.findUniqueOrThrow({ where: { id: actor.id } }))
        .email,
      password: currentPassword,
    });
    it.each([false, true])(
      'rolls back login artifacts if its audit fails (MFA=%s)',
      async (requireMfa) => {
        await db.adminUser.update({
          where: { id: actor.id },
          data: { requireMfa },
        });
        const input = await loginInput();
        jest
          .spyOn(service, 'writeAudit')
          .mockRejectedValueOnce(new Error('Login audit unavailable'));
        await expect(service.login(input, {})).rejects.toThrow(
          'Login audit unavailable',
        );
        expect(
          await db.adminSession.count({ where: { userId: actor.id } }),
        ).toBe(2);
        expect(
          await db.adminMfaChallenge.count({ where: { userId: actor.id } }),
        ).toBe(0);
        expect(
          await db.adminLoginAttempt.count({ where: { userId: actor.id } }),
        ).toBe(0);
        expect(
          (await db.adminUser.findUniqueOrThrow({ where: { id: actor.id } }))
            .lastLoginAt,
        ).toBeNull();
      },
    );
    it.each([false, true])(
      'preserves successful password login behavior (MFA=%s)',
      async (requireMfa) => {
        await db.adminUser.update({
          where: { id: actor.id },
          data: { requireMfa, mfaSecretHash: null },
        });
        const result = await service.login(await loginInput(), {});
        expect(result.kind).toBe(requireMfa ? 'mfa' : 'session');
        expect(
          await db.adminSession.count({ where: { userId: actor.id } }),
        ).toBe(requireMfa ? 2 : 3);
        expect(
          await db.adminMfaChallenge.count({ where: { userId: actor.id } }),
        ).toBe(requireMfa ? 1 : 0);
      },
    );
    it.each(['password', 'disabled', 'locked', 'mfa'] as const)(
      'honors %s changes during password-login admission waits',
      async (state) => {
        await db.adminUser.update({
          where: { id: actor.id },
          data: { requireMfa: false, mfaSecretHash: null },
        });
        const input = await loginInput();
        let release!: () => void;
        let locked!: () => void;
        const ready = new Promise<void>((resolve) => {
          locked = resolve;
        });
        const gate = new Promise<void>((resolve) => {
          release = resolve;
        });
        const holder = db.$transaction(async (tx) => {
          await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${actor.id}::uuid FOR UPDATE`;
          locked();
          await gate;
          await tx.adminUser.update({
            where: { id: actor.id },
            data:
              state === 'password'
                ? { passwordHash: hashAdminPassword(newPassword) }
                : state === 'disabled'
                  ? { status: 'disabled' }
                  : state === 'locked'
                    ? { lockedUntil: new Date('2100-01-01') }
                    : { requireMfa: true },
          });
        });
        await ready;
        const pending = service.login(input, {});
        void pending.catch(() => undefined);
        try {
          const deadline = Date.now() + 5000;
          while (true) {
            const rows = await db.$queryRaw<
              Array<{ count: bigint }>
            >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%admin_users%'`;
            if (rows[0].count > 0n) break;
            if (Date.now() > deadline)
              throw new Error('Expected login user lock wait');
            await new Promise((resolve) => setTimeout(resolve, 10));
          }
        } finally {
          release();
        }
        await holder;
        if (state === 'mfa')
          await expect(pending).resolves.toMatchObject({ kind: 'mfa' });
        else
          await expect(pending).rejects.toMatchObject({
            response: { code: 'ADMIN_AUTH_INVALID_CREDENTIALS' },
          });
        expect(
          await db.adminSession.count({ where: { userId: actor.id } }),
        ).toBe(2);
        expect(
          await db.adminMfaChallenge.count({ where: { userId: actor.id } }),
        ).toBe(state === 'mfa' ? 1 : 0);
      },
    );
    it('counts six overlapping failures from current locked rows without losing increments', async () => {
      const input = {
        ...(await loginInput()),
        password: 'Wrong-Password-827!X',
      };
      let release!: () => void;
      let locked!: () => void;
      const ready = new Promise<void>((resolve) => {
        locked = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const holder = db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${actor.id}::uuid FOR UPDATE`;
        locked();
        await gate;
      });
      await ready;
      const pending = Array.from({ length: 6 }, () => service.login(input, {}));
      for (const promise of pending) void promise.catch(() => undefined);
      try {
        const deadline = Date.now() + 10000;
        while (true) {
          const rows = await db.$queryRaw<
            Array<{ count: bigint }>
          >`SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name=${applicationName} AND wait_event_type='Lock' AND query LIKE '%admin_users%'`;
          if (rows[0].count >= 6n) break;
          if (Date.now() > deadline)
            throw new Error('Expected six failed-login lock waits');
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      } finally {
        release();
      }
      await holder;
      const results = await Promise.allSettled(pending);
      expect(results.every((r) => r.status === 'rejected')).toBe(true);
      const user = await db.adminUser.findUniqueOrThrow({
        where: { id: actor.id },
      });
      expect(user.failedLoginCount).toBe(6);
      expect(user.lockedUntil!.getTime()).toBeGreaterThan(Date.now());
      expect(
        await db.adminLoginAttempt.count({
          where: { userId: actor.id, outcome: 'failure' },
        }),
      ).toBe(6);
      expect(
        await db.adminAuditLog.count({
          where: { resourceId: actor.id, outcome: 'failure' },
        }),
      ).toBe(6);
      await expect(service.login(await loginInput(), {})).rejects.toMatchObject(
        { status: 429 },
      );
    });
    it('rolls back failed-login counters and attempt records if their audit fails', async () => {
      jest
        .spyOn(service, 'writeAudit')
        .mockRejectedValueOnce(new Error('Failure audit unavailable'));
      await expect(
        service.login(
          { ...(await loginInput()), password: 'Wrong-Password-827!X' },
          {},
        ),
      ).rejects.toThrow('Failure audit unavailable');
      expect(
        (await db.adminUser.findUniqueOrThrow({ where: { id: actor.id } }))
          .failedLoginCount,
      ).toBe(0);
      expect(
        await db.adminLoginAttempt.count({ where: { userId: actor.id } }),
      ).toBe(0);
    });
    it('retains a completed failure record while a successful login resets only the account counter', async () => {
      await db.adminUser.update({
        where: { id: actor.id },
        data: { requireMfa: false },
      });
      await expect(
        service.login(
          { ...(await loginInput()), password: 'Wrong-Password-827!X' },
          {},
        ),
      ).rejects.toMatchObject({ status: 401 });
      expect(
        (await db.adminUser.findUniqueOrThrow({ where: { id: actor.id } }))
          .failedLoginCount,
      ).toBe(1);
      await expect(
        service.login(await loginInput(), {}),
      ).resolves.toMatchObject({ kind: 'session' });
      expect(
        (await db.adminUser.findUniqueOrThrow({ where: { id: actor.id } }))
          .failedLoginCount,
      ).toBe(0);
      expect(
        await db.adminLoginAttempt.count({
          where: { userId: actor.id, outcome: 'failure' },
        }),
      ).toBe(1);
    });
  },
);
