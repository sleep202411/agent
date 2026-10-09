import { writeAdminAudit, type AuditInput } from './admin-audit';
import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AdminAuditOutcome,
  AdminLoginAttemptOutcome,
  AdminSessionStatus,
  AdminSiteScope,
  AdminUserStatus,
  Prisma,
} from '@prisma/client';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';
import {
  assignAdminSuperRole,
  ensureAdminAuthCatalog,
} from './admin-auth.bootstrap';
import {
  buildTotpUri,
  decryptTotpSecret,
  encryptTotpSecret,
  generateTotpSecret,
  verifyTotpCode,
} from './admin-mfa';
import {
  hashAdminPassword,
  validateAdminPasswordPolicy,
  verifyAdminPassword,
} from './admin-password';
import type {
  AdminLoginInput,
  AdminMfaVerifyInput,
  AdminPasswordChangeInput,
  AdminProfileUpdateInput,
} from './dto';
import type {
  AdminActor,
  AdminAuthResult,
  AdminRequestContext,
  AdminSiteScopeValue,
} from './admin-auth.types';

const adminUserInclude = {
  roles: {
    include: {
      role: {
        include: {
          permissions: {
            include: {
              permission: true,
            },
          },
        },
      },
    },
  },
} satisfies Prisma.AdminUserInclude;

type AdminUserWithRoles = Prisma.AdminUserGetPayload<{
  include: typeof adminUserInclude;
}>;

type AdminLoginOutcome =
  | {
      kind: 'session';
      result: AdminAuthResult;
      sessionToken: string;
      expiresAt: Date;
    }
  | {
      kind: 'mfa';
      challenge: {
        required: true;
        setupRequired: boolean;
        challengeToken: string;
        expiresAt: string;
        secret?: string;
        otpauthUri?: string;
      };
    };

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_EMAIL_FAILURES = 5;
const MAX_IP_FAILURES = 20;
const LOCKOUT_MS = 15 * 60 * 1000;

@Injectable()
export class AdminAuthService implements OnModuleInit {
  private readonly logger = new Logger(AdminAuthService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    if (!backgroundTasksEnabled()) return;
    await ensureAdminAuthCatalog(this.prisma);
    await this.ensureBootstrapAdmin();
  }

  async login(
    input: AdminLoginInput,
    context: AdminRequestContext,
  ): Promise<AdminLoginOutcome> {
    const email = input.email.trim().toLowerCase();
    await this.assertLoginTrafficAllowed(email, context);
    const user = await this.prisma.adminUser.findUnique({
      where: { email },
      include: adminUserInclude,
    });
    if (user?.lockedUntil && user.lockedUntil > new Date()) {
      await this.recordLoginAttempt({
        email,
        userId: user.id,
        outcome: AdminLoginAttemptOutcome.blocked,
        reason: 'account_locked',
        context,
      });
      throw new HttpException(
        {
          code: 'ADMIN_AUTH_ACCOUNT_LOCKED',
          msg: '后台账号已被临时锁定，请稍后再试或联系超级管理员。',
          lockedUntil: user.lockedUntil.toISOString(),
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (
      !user ||
      user.status !== AdminUserStatus.active ||
      !user.passwordHash ||
      !verifyAdminPassword(input.password, user.passwordHash)
    ) {
      await this.handleLoginFailure(email, user, context);
    }

    const authenticatedUser = user as AdminUserWithRoles;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${authenticatedUser.id}::uuid FOR UPDATE`;
      const current = await tx.adminUser.findUnique({
        where: { id: authenticatedUser.id },
        include: adminUserInclude,
      });
      const [clock] = await tx.$queryRaw<
        { nowMs: number }[]
      >`SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::double precision AS "nowMs"`;
      const now = new Date(clock.nowMs);
      if (
        !current ||
        current.status !== AdminUserStatus.active ||
        current.passwordHash !== authenticatedUser.passwordHash ||
        (current.lockedUntil && current.lockedUntil > now)
      ) {
        throw new UnauthorizedException({
          code: 'ADMIN_AUTH_INVALID_CREDENTIALS',
          msg: '后台账号或密码错误，或账号未启用。',
        });
      }
      if (current.requireMfa) {
        const challenge = await this.createMfaChallenge(
          current,
          context,
          tx,
          now,
        );
        await this.writeAudit(
          {
            action: 'admin.auth.mfa.challenge',
            resourceType: 'admin_user',
            resourceId: current.id,
            metadata: {
              email: current.email,
              setupRequired: challenge.setupRequired,
            },
            context,
          },
          tx,
        );
        return {
          kind: 'mfa',
          challenge: {
            required: true,
            setupRequired: challenge.setupRequired,
            challengeToken: challenge.challengeToken,
            expiresAt: challenge.expiresAt.toISOString(),
            secret: challenge.secret,
            otpauthUri: challenge.otpauthUri,
          },
        };
      }
      return this.createSessionForUser(current, context, tx);
    });
  }

  async verifyMfa(
    input: AdminMfaVerifyInput,
    context: AdminRequestContext,
  ): Promise<{
    result: AdminAuthResult;
    sessionToken: string;
    expiresAt: Date;
  }> {
    const tokenHash = hashSessionToken(input.challengeToken);
    let failureUser:
      | { id: string; email: string; setupRequired: boolean }
      | undefined;
    try {
      return await this.prisma.$transaction(async (tx) => {
        const candidate = await tx.adminMfaChallenge.findUnique({
          where: { tokenHash },
          select: { id: true, userId: true },
        });
        if (!candidate) throw this.invalidMfaChallenge();
        await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${candidate.userId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM admin_mfa_challenges WHERE id=${candidate.id}::uuid FOR UPDATE`;
        const challenge = await tx.adminMfaChallenge.findUnique({
          where: { id: candidate.id },
          include: { user: { include: adminUserInclude } },
        });
        const [clock] = await tx.$queryRaw<
          { nowMs: number }[]
        >`SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::double precision AS "nowMs"`;
        const now = new Date(clock.nowMs);
        if (
          !challenge ||
          challenge.consumedAt ||
          challenge.expiresAt <= now ||
          challenge.user.status !== AdminUserStatus.active ||
          (challenge.user.lockedUntil && challenge.user.lockedUntil > now)
        )
          throw this.invalidMfaChallenge();
        const setupRequired = challenge.purpose === 'setup';
        if (setupRequired && challenge.user.mfaSecretHash)
          throw this.invalidMfaChallenge();
        const encodedSecret = setupRequired
          ? challenge.secretEncrypted
          : challenge.user.mfaSecretHash;
        const secret = encodedSecret ? decryptTotpSecret(encodedSecret) : null;
        if (
          !secret ||
          !verifyTotpCode({
            secret,
            code: input.code,
            now: now.getTime(),
          })
        ) {
          failureUser = {
            id: challenge.user.id,
            email: challenge.user.email,
            setupRequired,
          };
          throw new UnauthorizedException({
            code: 'ADMIN_MFA_CODE_INVALID',
            msg: 'MFA 验证码错误或已过期。',
          });
        }
        if (setupRequired)
          await tx.adminUser.update({
            where: { id: challenge.user.id },
            data: {
              requireMfa: true,
              mfaSecretHash: encryptTotpSecret(secret),
              mfaEnabledAt: now,
            },
          });
        const consumed =
          await tx.$executeRaw`UPDATE admin_mfa_challenges SET consumed_at=clock_timestamp() WHERE id=${challenge.id}::uuid AND consumed_at IS NULL AND expires_at>clock_timestamp()`;
        if (consumed !== 1) throw this.invalidMfaChallenge();
        await this.writeAudit(
          {
            action: setupRequired
              ? 'admin.auth.mfa.enroll'
              : 'admin.auth.mfa.verify',
            resourceType: 'admin_user',
            resourceId: challenge.user.id,
            metadata: { email: challenge.user.email },
            context,
          },
          tx,
        );
        const user = await tx.adminUser.findUniqueOrThrow({
          where: { id: challenge.user.id },
          include: adminUserInclude,
        });
        const outcome = await this.createSessionForUser(user, context, tx);
        if (outcome.kind !== 'session')
          throw new BadRequestException({
            code: 'ADMIN_MFA_SESSION_FAILED',
            msg: 'MFA 验证成功，但会话创建失败。',
          });
        return {
          result: outcome.result,
          sessionToken: outcome.sessionToken,
          expiresAt: outcome.expiresAt,
        };
      });
    } catch (error) {
      if (failureUser)
        await this.writeAudit({
          action: 'admin.auth.mfa.verify',
          resourceType: 'admin_user',
          resourceId: failureUser.id,
          outcome: AdminAuditOutcome.failure,
          reason: 'Invalid MFA code.',
          metadata: {
            email: failureUser.email,
            setupRequired: failureUser.setupRequired,
          },
          context,
        });
      throw error;
    }
  }

  private invalidMfaChallenge() {
    return new UnauthorizedException({
      code: 'ADMIN_MFA_CHALLENGE_INVALID',
      msg: 'MFA 验证已失效，请重新登录。',
    });
  }

  private async createSessionForUser(
    user: AdminUserWithRoles,
    context: AdminRequestContext,
    db: Prisma.TransactionClient,
  ): Promise<AdminLoginOutcome> {
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = sessionExpiresAt();
    const session = await db.adminSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
    await db.adminUser.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.recordLoginAttempt(
      {
        email: user.email,
        userId: user.id,
        outcome: AdminLoginAttemptOutcome.success,
        context,
      },
      db,
    );

    const actor = this.toActor(user, session.id);
    await this.writeAudit(
      {
        actor,
        action: 'admin.auth.login',
        resourceType: 'admin_user',
        resourceId: user.id,
        metadata: { email: user.email },
        context,
      },
      db,
    );

    return {
      kind: 'session',
      result: {
        user: {
          id: actor.id,
          email: actor.email,
          displayName: actor.displayName,
          avatarUrl: actor.avatarUrl,
          status: actor.status,
          siteScope: actor.siteScope,
          roleKeys: actor.roleKeys,
          requireMfa: actor.requireMfa,
          mfaEnabledAt: actor.mfaEnabledAt,
          permissions: actor.permissions,
        },
        session: {
          id: session.id,
          expiresAt: expiresAt.toISOString(),
        },
      },
      sessionToken,
      expiresAt,
    };
  }

  async validateSession(
    sessionToken: string | undefined,
    context?: AdminRequestContext,
  ): Promise<AdminActor> {
    if (!sessionToken) {
      throw new UnauthorizedException({
        code: 'ADMIN_AUTH_REQUIRED',
        msg: '请先登录后台管理系统。',
      });
    }

    const tokenHash = hashSessionToken(sessionToken);
    const candidate = await this.prisma.adminSession.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true },
    });
    if (!candidate)
      throw new UnauthorizedException({
        code: 'ADMIN_SESSION_INVALID',
        msg: '后台登录已失效，请重新登录。',
      });
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${candidate.userId}::uuid FOR SHARE`;
      await tx.$queryRaw`SELECT id FROM admin_sessions WHERE id=${candidate.id}::uuid FOR UPDATE`;
      const session = await tx.adminSession.findUnique({
        where: { tokenHash },
        include: { user: { include: adminUserInclude } },
      });
      if (!session)
        throw new UnauthorizedException({
          code: 'ADMIN_SESSION_INVALID',
          msg: '后台登录已失效，请重新登录。',
        });
      const actor = this.toActor(session.user, session.id);
      await this.assertOwnSession(tx, actor);
      const [clock] = await tx.$queryRaw<
        { milliseconds: number }[]
      >`SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::double precision AS milliseconds`;
      await tx.adminSession.update({
        where: { id: session.id },
        data: {
          lastSeenAt: new Date(clock.milliseconds),
          ipAddress: context?.ipAddress ?? session.ipAddress,
          userAgent: context?.userAgent ?? session.userAgent,
        },
      });
      await this.assertOwnSession(tx, actor);
      return actor;
    });
  }

  async logout(actor: AdminActor, context: AdminRequestContext): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${actor.id}::uuid FOR SHARE`;
      await tx.adminSession.updateMany({
        where: {
          id: actor.sessionId,
          userId: actor.id,
          status: AdminSessionStatus.active,
        },
        data: { status: AdminSessionStatus.revoked, revokedAt: new Date() },
      });
      await this.writeAudit(
        {
          actor,
          action: 'admin.auth.logout',
          resourceType: 'admin_session',
          resourceId: actor.sessionId,
          context,
        },
        tx,
      );
    });
  }

  private async ownAccountWrite<T>(
    actor: AdminActor,
    work: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${actor.id}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM admin_sessions WHERE id=${actor.sessionId}::uuid AND user_id=${actor.id}::uuid FOR SHARE`;
      await this.assertOwnSession(tx, actor);
      const result = await work(tx);
      await this.assertOwnSession(tx, actor);
      return result;
    });
  }

  private async assertOwnSession(
    tx: Prisma.TransactionClient,
    actor: AdminActor,
  ) {
    const [row] = await tx.$queryRaw<
      { valid: boolean }[]
    >`SELECT EXISTS(SELECT 1 FROM admin_sessions s JOIN admin_users u ON u.id=s.user_id WHERE s.id=${actor.sessionId}::uuid AND u.id=${actor.id}::uuid AND s.status='active' AND s.expires_at>clock_timestamp() AND u.status='active') AS valid`;
    if (!row?.valid)
      throw new UnauthorizedException({
        code: 'ADMIN_SESSION_INVALID',
        msg: '后台登录已失效，请重新登录。',
      });
  }

  async updateOwnProfile(
    actor: AdminActor,
    input: AdminProfileUpdateInput,
    context: AdminRequestContext,
  ): Promise<AdminAuthResult> {
    return this.ownAccountWrite(actor, async (tx) => {
      const before = await tx.adminUser.findUniqueOrThrow({
        where: { id: actor.id },
        select: { id: true, email: true, displayName: true, avatarUrl: true },
      });
      const updated = await tx.adminUser.update({
        where: { id: actor.id },
        data: {
          displayName: input.displayName,
          avatarUrl: input.avatarUrl,
        },
        include: adminUserInclude,
      });
      const nextActor = this.toActor(updated, actor.sessionId);
      await this.writeAudit(
        {
          actor: nextActor,
          action: 'admin.account.profile.update',
          resourceType: 'admin_user',
          resourceId: actor.id,
          before: {
            id: before.id,
            email: before.email,
            displayName: before.displayName,
            avatarUrl: before.avatarUrl,
          },
          after: {
            id: updated.id,
            email: updated.email,
            displayName: updated.displayName,
            avatarUrl: updated.avatarUrl,
          },
          metadata: { fields: Object.keys(input) },
          context,
        },
        tx,
      );
      return this.authResultForActor(nextActor, tx);
    });
  }

  async changeOwnPassword(
    actor: AdminActor,
    input: AdminPasswordChangeInput,
    context: AdminRequestContext,
  ): Promise<AdminAuthResult> {
    return this.ownAccountWrite(actor, async (tx) => {
      const user = await tx.adminUser.findUniqueOrThrow({
        where: { id: actor.id },
        include: adminUserInclude,
      });
      if (
        !user.passwordHash ||
        !verifyAdminPassword(input.currentPassword, user.passwordHash)
      ) {
        throw new UnauthorizedException({
          code: 'ADMIN_CURRENT_PASSWORD_INVALID',
          msg: '当前密码不正确。',
        });
      }
      const previousHashes = await this.recentPasswordHashes(actor.id, tx);
      const issues = validateAdminPasswordPolicy({
        password: input.newPassword,
        email: user.email,
        displayName: user.displayName,
        previousHashes,
      });
      if (issues.length) {
        throw new BadRequestException({
          code: 'ADMIN_PASSWORD_POLICY_FAILED',
          msg: issues.join(' '),
          issues: issues.map((message) => ({ message })),
        });
      }
      await tx.adminMfaChallenge.updateMany({
        where: { userId: actor.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      const passwordHash = hashAdminPassword(input.newPassword);
      await tx.adminUser.update({
        where: { id: actor.id },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await tx.adminPasswordHistory.create({
        data: { userId: actor.id, passwordHash },
      });
      await tx.adminSession.updateMany({
        where: {
          userId: actor.id,
          id: { not: actor.sessionId },
          status: AdminSessionStatus.active,
        },
        data: { status: AdminSessionStatus.revoked, revokedAt: new Date() },
      });
      await this.writeAudit(
        {
          actor,
          action: 'admin.account.password.change',
          resourceType: 'admin_user',
          resourceId: actor.id,
          metadata: { revokedOtherSessions: true },
          context,
        },
        tx,
      );
      const refreshed = await tx.adminUser.findUniqueOrThrow({
        where: { id: actor.id },
        include: adminUserInclude,
      });
      return this.authResultForActor(
        this.toActor(refreshed, actor.sessionId),
        tx,
      );
    }).catch(async (error: unknown) => {
      if (
        error instanceof UnauthorizedException &&
        (error.getResponse() as { code?: string }).code ===
          'ADMIN_CURRENT_PASSWORD_INVALID'
      ) {
        await this.writeAudit({
          actor,
          action: 'admin.account.password.change',
          resourceType: 'admin_user',
          resourceId: actor.id,
          outcome: AdminAuditOutcome.failure,
          reason: 'Invalid current password.',
          context,
        });
      }
      throw error;
    });
  }

  async resetOwnMfa(
    actor: AdminActor,
    context: AdminRequestContext,
  ): Promise<AdminAuthResult> {
    return this.ownAccountWrite(actor, async (tx) => {
      await tx.adminMfaChallenge.updateMany({
        where: { userId: actor.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      const updated = await tx.adminUser.update({
        where: { id: actor.id },
        data: {
          requireMfa: true,
          mfaSecretHash: null,
          mfaEnabledAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
        },
        include: adminUserInclude,
      });
      await tx.adminSession.updateMany({
        where: {
          userId: actor.id,
          id: { not: actor.sessionId },
          status: AdminSessionStatus.active,
        },
        data: { status: AdminSessionStatus.revoked, revokedAt: new Date() },
      });
      const nextActor = this.toActor(updated, actor.sessionId);
      await this.writeAudit(
        {
          actor: nextActor,
          action: 'admin.account.mfa.reset',
          resourceType: 'admin_user',
          resourceId: actor.id,
          metadata: { requireMfa: true },
          context,
        },
        tx,
      );
      return this.authResultForActor(nextActor, tx);
    });
  }

  async writeAudit(
    input: AuditInput,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<void> {
    await writeAdminAudit(db, input);
  }

  toActor(user: AdminUserWithRoles, sessionId: string): AdminActor {
    const permissions = new Set<string>();
    for (const userRole of user.roles) {
      for (const rolePermission of userRole.role.permissions) {
        permissions.add(rolePermission.permission.key);
      }
    }
    return {
      id: user.id,
      email: user.email,
      avatarUrl: user.avatarUrl,
      displayName: user.displayName,
      status: user.status,
      siteScope: user.siteScope as AdminSiteScopeValue,
      platformUserId: user.platformUserId,
      sessionId,
      roleKeys: user.roles.map((userRole) => userRole.role.key).sort(),
      requireMfa: user.requireMfa,
      mfaEnabledAt: user.mfaEnabledAt?.toISOString() ?? null,
      permissions: [...permissions].sort(),
    };
  }

  private async authResultForActor(
    actor: AdminActor,
    db: Prisma.TransactionClient = this.prisma,
  ): Promise<AdminAuthResult> {
    const session = await db.adminSession.findUnique({
      where: { id: actor.sessionId },
      select: { expiresAt: true },
    });
    return {
      user: {
        id: actor.id,
        email: actor.email,
        displayName: actor.displayName,
        avatarUrl: actor.avatarUrl,
        status: actor.status,
        siteScope: actor.siteScope,
        platformUserId: actor.platformUserId ?? null,
        roleKeys: actor.roleKeys,
        requireMfa: actor.requireMfa,
        mfaEnabledAt: actor.mfaEnabledAt,
        permissions: actor.permissions,
      },
      session: {
        id: actor.sessionId,
        expiresAt: session?.expiresAt.toISOString() ?? '',
      },
    };
  }

  private async recentPasswordHashes(
    userId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const history = await db.adminPasswordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { passwordHash: true },
    });
    return history.map((item) => item.passwordHash);
  }

  private async assertLoginTrafficAllowed(
    email: string,
    context: AdminRequestContext,
  ) {
    const since = new Date(Date.now() - LOGIN_WINDOW_MS);
    const [emailFailures, ipFailures] = await Promise.all([
      this.prisma.adminLoginAttempt.count({
        where: {
          email,
          outcome: {
            in: [
              AdminLoginAttemptOutcome.failure,
              AdminLoginAttemptOutcome.blocked,
            ],
          },
          createdAt: { gte: since },
        },
      }),
      context.ipAddress
        ? this.prisma.adminLoginAttempt.count({
            where: {
              ipAddress: context.ipAddress,
              outcome: {
                in: [
                  AdminLoginAttemptOutcome.failure,
                  AdminLoginAttemptOutcome.blocked,
                ],
              },
              createdAt: { gte: since },
            },
          })
        : Promise.resolve(0),
    ]);
    if (emailFailures >= MAX_EMAIL_FAILURES || ipFailures >= MAX_IP_FAILURES) {
      await this.recordLoginAttempt({
        email,
        outcome: AdminLoginAttemptOutcome.blocked,
        reason:
          emailFailures >= MAX_EMAIL_FAILURES
            ? 'email_rate_limited'
            : 'ip_rate_limited',
        context,
      });
      throw new HttpException(
        {
          code: 'ADMIN_AUTH_RATE_LIMITED',
          msg: '后台登录尝试过于频繁，请稍后再试。',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async handleLoginFailure(
    email: string,
    user: AdminUserWithRoles | null,
    context: AdminRequestContext,
  ): Promise<never> {
    const lockedUntil = await this.prisma.$transaction(async (tx) => {
      let lockedUntil: Date | null = null;
      let current: AdminUserWithRoles | null = null;
      if (user) {
        await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${user.id}::uuid FOR UPDATE`;
        current = await tx.adminUser.findUnique({
          where: { id: user.id },
          include: adminUserInclude,
        });
      }
      if (current) {
        const [clock] = await tx.$queryRaw<
          { nowMs: number }[]
        >`SELECT (EXTRACT(EPOCH FROM clock_timestamp()) * 1000)::double precision AS "nowMs"`;
        const now = new Date(clock.nowMs);
        const failedLoginCount = current.failedLoginCount + 1;
        lockedUntil =
          current.lockedUntil && current.lockedUntil > now
            ? current.lockedUntil
            : failedLoginCount >= MAX_EMAIL_FAILURES
              ? new Date(now.getTime() + LOCKOUT_MS)
              : null;
        await tx.adminUser.update({
          where: { id: current.id },
          data: { failedLoginCount, lockedUntil },
        });
      }
      await this.recordLoginAttempt(
        {
          email,
          userId: current?.id,
          outcome: AdminLoginAttemptOutcome.failure,
          reason: 'invalid_credentials',
          context,
        },
        tx,
      );
      await this.writeAudit(
        {
          action: 'admin.auth.login',
          resourceType: 'admin_user',
          resourceId: current?.id,
          outcome: AdminAuditOutcome.failure,
          reason: lockedUntil
            ? 'Invalid credentials. Account locked.'
            : 'Invalid admin credentials or inactive account.',
          metadata: { email, lockedUntil: lockedUntil?.toISOString() ?? null },
          context,
        },
        tx,
      );
      return lockedUntil;
    });
    throw new UnauthorizedException({
      code: 'ADMIN_AUTH_INVALID_CREDENTIALS',
      msg: lockedUntil
        ? '后台账号或密码错误，账号已被临时锁定。'
        : '后台账号或密码错误，或账号未启用。',
    });
  }

  private async recordLoginAttempt(
    input: {
      email: string;
      userId?: string;
      outcome: AdminLoginAttemptOutcome;
      reason?: string;
      context: AdminRequestContext;
    },
    db: Prisma.TransactionClient = this.prisma,
  ) {
    await db.adminLoginAttempt.create({
      data: {
        email: input.email,
        userId: input.userId,
        outcome: input.outcome,
        reason: input.reason,
        ipAddress: input.context.ipAddress,
        userAgent: input.context.userAgent,
      },
    });
  }

  private async createMfaChallenge(
    user: AdminUserWithRoles,
    context: AdminRequestContext,
    db: Prisma.TransactionClient,
    now: Date,
  ) {
    const setupRequired = !user.mfaSecretHash;
    const secret = setupRequired ? generateTotpSecret() : undefined;
    const challengeToken = generateMfaChallengeToken();
    const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);
    await db.adminMfaChallenge.create({
      data: {
        userId: user.id,
        tokenHash: hashSessionToken(challengeToken),
        purpose: setupRequired ? 'setup' : 'verify',
        secretEncrypted: secret ? encryptTotpSecret(secret) : undefined,
        expiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
    return {
      setupRequired,
      secret,
      otpauthUri: secret
        ? buildTotpUri({ email: user.email, secret })
        : undefined,
      challengeToken,
      expiresAt,
    };
  }

  private async ensureBootstrapAdmin(): Promise<void> {
    const email = process.env.ADMIN_BOOTSTRAP_EMAIL?.trim().toLowerCase();
    const password = process.env.ADMIN_BOOTSTRAP_PASSWORD;
    if (!email && !password) return;
    if (!email || !password) {
      this.logger.warn(
        'ADMIN_BOOTSTRAP_EMAIL and ADMIN_BOOTSTRAP_PASSWORD must be configured together.',
      );
      return;
    }
    const passwordIssues = validateAdminPasswordPolicy({
      password,
      email,
      displayName: process.env.ADMIN_BOOTSTRAP_NAME?.trim() || '管理员',
    });
    if (passwordIssues.length) {
      this.logger.warn(
        `ADMIN_BOOTSTRAP_PASSWORD does not satisfy policy: ${passwordIssues.join(' ')}`,
      );
      return;
    }

    const passwordHash = hashAdminPassword(password);
    const shouldResetPassword =
      process.env.ADMIN_BOOTSTRAP_RESET_PASSWORD === 'true';
    const user = await this.prisma.adminUser.upsert({
      where: { email },
      create: {
        email,
        displayName: process.env.ADMIN_BOOTSTRAP_NAME?.trim() || '管理员',
        passwordHash,
        status: AdminUserStatus.active,
        siteScope: AdminSiteScope.all,
        requireMfa: process.env.ADMIN_BOOTSTRAP_REQUIRE_MFA !== 'false',
        passwordChangedAt: new Date(),
      },
      update: {
        status: AdminUserStatus.active,
        siteScope: AdminSiteScope.all,
        requireMfa: process.env.ADMIN_BOOTSTRAP_REQUIRE_MFA !== 'false',
        ...(shouldResetPassword
          ? { passwordHash, passwordChangedAt: new Date() }
          : {}),
      },
    });
    await assignAdminSuperRole(this.prisma, user.id);
  }
}

function generateSessionToken(): string {
  return `fdadm_${randomBytes(32).toString('base64url')}`;
}

function generateMfaChallengeToken(): string {
  return `fdmfa_${randomBytes(32).toString('base64url')}`;
}

function hashSessionToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function sessionExpiresAt(): Date {
  const hours = Number(process.env.ADMIN_SESSION_TTL_HOURS ?? 12);
  const ttlHours = Number.isFinite(hours) && hours > 0 ? hours : 12;
  return new Date(Date.now() + ttlHours * 60 * 60 * 1000);
}
