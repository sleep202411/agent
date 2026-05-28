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
import type { AdminLoginInput, AdminMfaVerifyInput } from './dto';
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

type AuditInput = {
  actor?: AdminActor | null;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  outcome?: AdminAuditOutcome;
  reason?: string | null;
  metadata?: Prisma.InputJsonValue;
  before?: Prisma.InputJsonValue | null;
  after?: Prisma.InputJsonValue | null;
  context?: AdminRequestContext;
};

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
    if (authenticatedUser.requireMfa) {
      const challenge = await this.createMfaChallenge(
        authenticatedUser,
        context,
      );
      await this.writeAudit({
        action: 'admin.auth.mfa.challenge',
        resourceType: 'admin_user',
        resourceId: authenticatedUser.id,
        metadata: {
          email: authenticatedUser.email,
          setupRequired: challenge.setupRequired,
        },
        context,
      });
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

    return this.createSessionForUser(authenticatedUser, context);
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
    const challenge = await this.prisma.adminMfaChallenge.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: adminUserInclude,
        },
      },
    });
    if (
      !challenge ||
      challenge.consumedAt ||
      challenge.expiresAt <= new Date() ||
      challenge.user.status !== AdminUserStatus.active
    ) {
      throw new UnauthorizedException({
        code: 'ADMIN_MFA_CHALLENGE_INVALID',
        msg: 'MFA 验证已失效，请重新登录。',
      });
    }

    const setupRequired = challenge.purpose === 'setup';
    const secret = setupRequired
      ? challenge.secretEncrypted
        ? decryptTotpSecret(challenge.secretEncrypted)
        : null
      : challenge.user.mfaSecretHash
        ? decryptTotpSecret(challenge.user.mfaSecretHash)
        : null;
    if (!secret || !verifyTotpCode({ secret, code: input.code })) {
      await this.writeAudit({
        action: 'admin.auth.mfa.verify',
        resourceType: 'admin_user',
        resourceId: challenge.user.id,
        outcome: AdminAuditOutcome.failure,
        reason: 'Invalid MFA code.',
        metadata: { email: challenge.user.email, setupRequired },
        context,
      });
      throw new UnauthorizedException({
        code: 'ADMIN_MFA_CODE_INVALID',
        msg: 'MFA 验证码错误或已过期。',
      });
    }

    await this.prisma.$transaction([
      ...(setupRequired
        ? [
            this.prisma.adminUser.update({
              where: { id: challenge.user.id },
              data: {
                requireMfa: true,
                mfaSecretHash: encryptTotpSecret(secret),
                mfaEnabledAt: new Date(),
              },
            }),
          ]
        : []),
      this.prisma.adminMfaChallenge.update({
        where: { id: challenge.id },
        data: { consumedAt: new Date() },
      }),
    ]);
    await this.writeAudit({
      action: setupRequired ? 'admin.auth.mfa.enroll' : 'admin.auth.mfa.verify',
      resourceType: 'admin_user',
      resourceId: challenge.user.id,
      metadata: { email: challenge.user.email },
      context,
    });

    const user = setupRequired
      ? await this.prisma.adminUser.findUniqueOrThrow({
          where: { id: challenge.user.id },
          include: adminUserInclude,
        })
      : challenge.user;
    const outcome = await this.createSessionForUser(user, context);
    if (outcome.kind !== 'session') {
      throw new BadRequestException({
        code: 'ADMIN_MFA_SESSION_FAILED',
        msg: 'MFA 验证成功，但会话创建失败。',
      });
    }
    return {
      result: outcome.result,
      sessionToken: outcome.sessionToken,
      expiresAt: outcome.expiresAt,
    };
  }

  private async createSessionForUser(
    user: AdminUserWithRoles,
    context: AdminRequestContext,
  ): Promise<AdminLoginOutcome> {
    const sessionToken = generateSessionToken();
    const tokenHash = hashSessionToken(sessionToken);
    const expiresAt = sessionExpiresAt();
    const session = await this.prisma.adminSession.create({
      data: {
        userId: user.id,
        tokenHash,
        expiresAt,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      },
    });
    await this.prisma.adminUser.update({
      where: { id: user.id },
      data: {
        lastLoginAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.recordLoginAttempt({
      email: user.email,
      userId: user.id,
      outcome: AdminLoginAttemptOutcome.success,
      context,
    });

    const actor = this.toActor(user, session.id);
    await this.writeAudit({
      actor,
      action: 'admin.auth.login',
      resourceType: 'admin_user',
      resourceId: user.id,
      metadata: { email: user.email },
      context,
    });

    return {
      kind: 'session',
      result: {
        user: {
          id: actor.id,
          email: actor.email,
          displayName: actor.displayName,
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
    const session = await this.prisma.adminSession.findUnique({
      where: { tokenHash },
      include: {
        user: {
          include: adminUserInclude,
        },
      },
    });
    const now = new Date();
    if (
      !session ||
      session.status !== AdminSessionStatus.active ||
      session.expiresAt <= now ||
      session.user.status !== AdminUserStatus.active
    ) {
      throw new UnauthorizedException({
        code: 'ADMIN_SESSION_INVALID',
        msg: '后台登录已失效，请重新登录。',
      });
    }

    await this.prisma.adminSession.update({
      where: { id: session.id },
      data: {
        lastSeenAt: now,
        ipAddress: context?.ipAddress ?? session.ipAddress,
        userAgent: context?.userAgent ?? session.userAgent,
      },
    });

    return this.toActor(session.user, session.id);
  }

  async logout(actor: AdminActor, context: AdminRequestContext): Promise<void> {
    await this.prisma.adminSession.updateMany({
      where: { id: actor.sessionId, status: AdminSessionStatus.active },
      data: { status: AdminSessionStatus.revoked, revokedAt: new Date() },
    });
    await this.writeAudit({
      actor,
      action: 'admin.auth.logout',
      resourceType: 'admin_session',
      resourceId: actor.sessionId,
      context,
    });
  }

  async writeAudit(input: AuditInput): Promise<void> {
    await this.prisma.adminAuditLog.create({
      data: {
        actorUserId: input.actor?.id,
        actorSessionId: input.actor?.sessionId,
        siteScope: (input.actor?.siteScope ??
          AdminSiteScope.all) as AdminSiteScope,
        action: input.action,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        outcome: input.outcome ?? AdminAuditOutcome.success,
        reason: input.reason,
        ipAddress: input.context?.ipAddress,
        userAgent: input.context?.userAgent,
        before: input.before ?? undefined,
        after: input.after ?? undefined,
        metadata: input.metadata ?? {},
      },
    });
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
      displayName: user.displayName,
      status: user.status,
      siteScope: user.siteScope as AdminSiteScopeValue,
      sessionId,
      roleKeys: user.roles.map((userRole) => userRole.role.key).sort(),
      requireMfa: user.requireMfa,
      mfaEnabledAt: user.mfaEnabledAt?.toISOString() ?? null,
      permissions: [...permissions].sort(),
    };
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
    let lockedUntil: Date | null = null;
    if (user) {
      const failedLoginCount = user.failedLoginCount + 1;
      lockedUntil =
        failedLoginCount >= MAX_EMAIL_FAILURES
          ? new Date(Date.now() + LOCKOUT_MS)
          : null;
      await this.prisma.adminUser.update({
        where: { id: user.id },
        data: {
          failedLoginCount,
          lockedUntil,
        },
      });
    }
    await this.recordLoginAttempt({
      email,
      userId: user?.id,
      outcome: AdminLoginAttemptOutcome.failure,
      reason: 'invalid_credentials',
      context,
    });
    await this.writeAudit({
      action: 'admin.auth.login',
      resourceType: 'admin_user',
      resourceId: user?.id,
      outcome: AdminAuditOutcome.failure,
      reason: lockedUntil
        ? 'Invalid credentials. Account locked.'
        : 'Invalid admin credentials or inactive account.',
      metadata: { email, lockedUntil: lockedUntil?.toISOString() ?? null },
      context,
    });
    throw new UnauthorizedException({
      code: 'ADMIN_AUTH_INVALID_CREDENTIALS',
      msg: lockedUntil
        ? '后台账号或密码错误，账号已被临时锁定。'
        : '后台账号或密码错误，或账号未启用。',
    });
  }

  private async recordLoginAttempt(input: {
    email: string;
    userId?: string;
    outcome: AdminLoginAttemptOutcome;
    reason?: string;
    context: AdminRequestContext;
  }) {
    await this.prisma.adminLoginAttempt.create({
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
  ) {
    const setupRequired = !user.mfaSecretHash;
    const secret = setupRequired ? generateTotpSecret() : undefined;
    const challengeToken = generateMfaChallengeToken();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
    await this.prisma.adminMfaChallenge.create({
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
