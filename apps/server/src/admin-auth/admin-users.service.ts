import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AdminSessionStatus,
  AdminSiteScope,
  AdminUserStatus,
  Prisma,
} from '@prisma/client';
import { assignAdminRole } from './admin-auth.bootstrap';
import { ADMIN_ROLE_KEYS, type AdminRoleKey } from './admin-auth.constants';
import {
  hashAdminPassword,
  validateAdminPasswordPolicy,
} from './admin-password';
import { PrismaService } from '../infra/db/db.module';
import type {
  CreateAdminUserInput,
  ListAdminUsersQuery,
  UpdateAdminUserInput,
} from './admin-users.dto';
import type { AdminActor } from './admin-auth.types';

const adminUserListInclude = {
  roles: {
    include: {
      role: true,
    },
  },
} satisfies Prisma.AdminUserInclude;

type AdminUserForList = Prisma.AdminUserGetPayload<{
  include: typeof adminUserListInclude;
}> & {
  activeSessionCount?: number;
};

type ActiveSessionGroup = {
  userId: string;
  _count: {
    _all: number;
  };
};

@Injectable()
export class AdminUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListAdminUsersQuery) {
    const where = this.buildWhere(query);
    const skip = (query.page - 1) * query.pageSize;
    const [total, users, activeSessions] = await Promise.all([
      this.prisma.adminUser.count({ where }),
      this.prisma.adminUser.findMany({
        where,
        include: adminUserListInclude,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.adminSession.groupBy({
        by: ['userId'],
        where: {
          status: AdminSessionStatus.active,
          expiresAt: { gt: new Date() },
        },
        orderBy: { userId: 'asc' },
        _count: { _all: true },
      }) as unknown as Promise<ActiveSessionGroup[]>,
    ]);
    const sessionCountByUser = new Map(
      activeSessions.map((item) => [item.userId, item._count._all]),
    );
    return {
      items: users.map((user) =>
        this.toAdminUserDto({
          ...user,
          activeSessionCount: sessionCountByUser.get(user.id) ?? 0,
        }),
      ),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async create(input: CreateAdminUserInput) {
    this.assertAssignableRoleKey(input.roleKey);
    const existing = await this.prisma.adminUser.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException({
        code: 'ADMIN_USER_EMAIL_EXISTS',
        msg: '该后台邮箱已存在。',
      });
    }

    this.assertPasswordPolicy({
      password: input.password,
      email: input.email,
      displayName: input.displayName,
    });

    const passwordHash = hashAdminPassword(input.password);
    const user = await this.prisma.adminUser.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        passwordHash,
        passwordChangedAt: new Date(),
        status: input.status as AdminUserStatus,
        siteScope: input.siteScope as AdminSiteScope,
        requireMfa: input.requireMfa,
        disabledAt:
          input.status === AdminUserStatus.disabled ? new Date() : null,
      },
      include: adminUserListInclude,
    });
    await this.recordPasswordHistory(user.id, passwordHash);
    await assignAdminRole(this.prisma, user.id, input.roleKey as AdminRoleKey);
    return this.getById(user.id);
  }

  async update(actor: AdminActor, userId: string, input: UpdateAdminUserInput) {
    const existing = await this.findExisting(userId);
    if (input.roleKey) {
      this.assertAssignableRoleKey(input.roleKey);
      const existingWithRoles = await this.findExistingWithRoles(userId);
      if (primaryRoleKey(existingWithRoles) === ADMIN_ROLE_KEYS.SuperAdmin) {
        throw new BadRequestException({
          code: 'ADMIN_SUPER_ADMIN_ROLE_MANAGED_OUT_OF_BAND',
          msg: '超级管理员角色只能通过受控部署脚本维护，不能在后台页面降级或重新授权。',
        });
      }
    }
    if (
      actor.id === userId &&
      ((input.status && input.status !== AdminUserStatus.active) ||
        input.roleKey ||
        input.requireMfa === false)
    ) {
      throw new BadRequestException({
        code: 'ADMIN_USER_SELF_SECURITY_DOWNGRADE_DENIED',
        msg: '不能降低当前登录账号的状态、角色或 MFA 要求。',
      });
    }

    const nextStatus = input.status ?? existing.status;
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: {
        displayName: input.displayName,
        status: input.status as AdminUserStatus | undefined,
        siteScope: input.siteScope as AdminSiteScope | undefined,
        requireMfa: input.requireMfa,
        ...(input.requireMfa === false
          ? { mfaSecretHash: null, mfaEnabledAt: null }
          : {}),
        disabledAt:
          nextStatus === AdminUserStatus.disabled
            ? (existing.disabledAt ?? new Date())
            : null,
      },
    });
    if (input.roleKey) {
      await assignAdminRole(
        this.prisma,
        userId,
        input.roleKey as AdminRoleKey,
        actor.id,
      );
    }
    if (input.status && input.status !== AdminUserStatus.active) {
      await this.revokeSessions(userId, actor.sessionId);
    }
    return this.getById(userId);
  }

  async resetMfa(userId: string, exceptSessionId?: string) {
    await this.findExisting(userId);
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: {
        requireMfa: true,
        mfaSecretHash: null,
        mfaEnabledAt: null,
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.revokeSessions(userId, exceptSessionId);
    return this.getById(userId);
  }

  async resetPassword(
    userId: string,
    password: string,
    exceptSessionId?: string,
  ) {
    const existing = await this.findExisting(userId);
    const previousHashes = await this.recentPasswordHashes(userId);
    this.assertPasswordPolicy({
      password,
      email: existing.email,
      displayName: existing.displayName,
      previousHashes,
    });
    const passwordHash = hashAdminPassword(password);
    await this.prisma.adminUser.update({
      where: { id: userId },
      data: {
        passwordHash,
        passwordChangedAt: new Date(),
        failedLoginCount: 0,
        lockedUntil: null,
      },
    });
    await this.recordPasswordHistory(userId, passwordHash);
    await this.revokeSessions(userId, exceptSessionId);
    return this.getById(userId);
  }

  async revokeSessions(userId: string, exceptSessionId?: string) {
    await this.findExisting(userId);
    const result = await this.prisma.adminSession.updateMany({
      where: {
        userId,
        status: AdminSessionStatus.active,
        ...(exceptSessionId ? { id: { not: exceptSessionId } } : {}),
      },
      data: {
        status: AdminSessionStatus.revoked,
        revokedAt: new Date(),
      },
    });
    return { revokedCount: result.count };
  }

  async getById(userId: string) {
    const user = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      include: adminUserListInclude,
    });
    if (!user) {
      throw new NotFoundException({
        code: 'ADMIN_USER_NOT_FOUND',
        msg: '后台账号不存在。',
      });
    }
    const activeSessionCount = await this.prisma.adminSession.count({
      where: {
        userId,
        status: AdminSessionStatus.active,
        expiresAt: { gt: new Date() },
      },
    });
    return this.toAdminUserDto({ ...user, activeSessionCount });
  }

  async listSessions(userId: string) {
    await this.findExisting(userId);
    const sessions = await this.prisma.adminSession.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { lastSeenAt: 'desc' }],
      take: 50,
    });
    return {
      items: sessions.map((session) => ({
        id: session.id,
        status: session.status,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        createdAt: session.createdAt.toISOString(),
        lastSeenAt: session.lastSeenAt.toISOString(),
        expiresAt: session.expiresAt.toISOString(),
        revokedAt: session.revokedAt?.toISOString() ?? null,
      })),
    };
  }

  async revokeSession(
    userId: string,
    sessionId: string,
    exceptSessionId?: string,
  ) {
    await this.findExisting(userId);
    if (sessionId === exceptSessionId) {
      throw new BadRequestException({
        code: 'ADMIN_SESSION_SELF_REVOKE_DENIED',
        msg: '不能在此处撤销当前登录会话，请使用退出登录。',
      });
    }
    const result = await this.prisma.adminSession.updateMany({
      where: {
        id: sessionId,
        userId,
        status: AdminSessionStatus.active,
      },
      data: {
        status: AdminSessionStatus.revoked,
        revokedAt: new Date(),
      },
    });
    return { revokedCount: result.count };
  }

  private buildWhere(query: ListAdminUsersQuery): Prisma.AdminUserWhereInput {
    return {
      ...(query.status ? { status: query.status as AdminUserStatus } : {}),
      ...(query.siteScope
        ? { siteScope: query.siteScope as AdminSiteScope }
        : {}),
      ...(query.q
        ? {
            OR: [
              { email: { contains: query.q, mode: 'insensitive' } },
              { displayName: { contains: query.q, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private async findExisting(userId: string) {
    const existing = await this.prisma.adminUser.findUnique({
      where: { id: userId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'ADMIN_USER_NOT_FOUND',
        msg: '后台账号不存在。',
      });
    }
    return existing;
  }

  private async findExistingWithRoles(userId: string) {
    const existing = await this.prisma.adminUser.findUnique({
      where: { id: userId },
      include: adminUserListInclude,
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'ADMIN_USER_NOT_FOUND',
        msg: '后台账号不存在。',
      });
    }
    return existing;
  }

  private toAdminUserDto(user: AdminUserForList) {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      status: user.status,
      siteScope: user.siteScope,
      roleKeys: user.roles.map((userRole) => userRole.role.key).sort(),
      roleKey: primaryRoleKey(user),
      requireMfa: user.requireMfa,
      mfaEnabledAt: user.mfaEnabledAt?.toISOString() ?? null,
      lockedUntil: user.lockedUntil?.toISOString() ?? null,
      failedLoginCount: user.failedLoginCount,
      activeSessionCount: user.activeSessionCount ?? 0,
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      passwordChangedAt: user.passwordChangedAt?.toISOString() ?? null,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      disabledAt: user.disabledAt?.toISOString() ?? null,
    };
  }

  private assertPasswordPolicy(input: {
    password: string;
    email?: string;
    displayName?: string;
    previousHashes?: string[];
  }) {
    const issues = validateAdminPasswordPolicy(input);
    if (issues.length) {
      throw new BadRequestException({
        code: 'ADMIN_PASSWORD_POLICY_FAILED',
        msg: issues.join(' '),
        issues: issues.map((message) => ({ message })),
      });
    }
  }

  private assertAssignableRoleKey(roleKey: string) {
    if (roleKey === ADMIN_ROLE_KEYS.SuperAdmin) {
      throw new BadRequestException({
        code: 'ADMIN_SUPER_ADMIN_ROLE_MANAGED_OUT_OF_BAND',
        msg: '超级管理员只能通过受控部署脚本开通，不能在后台页面创建或授权。',
      });
    }
  }

  private async recentPasswordHashes(userId: string) {
    const history = await this.prisma.adminPasswordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { passwordHash: true },
    });
    return history.map((item) => item.passwordHash);
  }

  private async recordPasswordHistory(userId: string, passwordHash: string) {
    await this.prisma.adminPasswordHistory.create({
      data: { userId, passwordHash },
    });
  }
}

function primaryRoleKey(user: AdminUserForList): AdminRoleKey {
  const roleKeys = user.roles.map((userRole) => userRole.role.key);
  if (roleKeys.includes(ADMIN_ROLE_KEYS.SuperAdmin))
    return ADMIN_ROLE_KEYS.SuperAdmin;
  if (roleKeys.includes(ADMIN_ROLE_KEYS.Admin)) return ADMIN_ROLE_KEYS.Admin;
  return ADMIN_ROLE_KEYS.Operations;
}
