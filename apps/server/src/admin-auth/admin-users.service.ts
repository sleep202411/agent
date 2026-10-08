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
import {
  ensureAdminAuthCatalog,
  replaceAdminRoleInTransaction,
} from './admin-auth.bootstrap';
import {
  ADMIN_PERMISSION_CATALOG,
  ADMIN_PERMISSION_KEYS,
  ADMIN_ROLE_KEYS,
  CUSTOM_ROLE_FORBIDDEN_PERMISSIONS,
  RETIRED_ADMIN_ROLE_KEYS,
  isProtectedAdminRoleKey,
  isSystemAdminRoleKey,
} from './admin-auth.constants';
import {
  hashAdminPassword,
  validateAdminPasswordPolicy,
} from './admin-password';
import { PrismaService } from '../infra/db/db.module';
import type {
  CreateAdminRoleInput,
  CreateAdminUserInput,
  ListAdminSessionsQuery,
  ListAdminUsersQuery,
  UpdateAdminRoleInput,
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
    const roleId = await this.resolveAssignableRoleId(input.roleKey);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const user = await tx.adminUser.create({
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
        await this.recordPasswordHistory(user.id, passwordHash, tx);
        await replaceAdminRoleInTransaction(tx, user.id, roleId);
        return this.getById(user.id, tx);
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      )
        throw new ConflictException({
          code: 'ADMIN_USER_EMAIL_EXISTS',
          msg: '该后台邮箱已存在。',
        });
      throw error;
    }
  }

  async update(actor: AdminActor, userId: string, input: UpdateAdminUserInput) {
    if (input.roleKey) this.assertAssignableRoleKey(input.roleKey);
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
    const nextRoleId = input.roleKey
      ? await this.resolveAssignableRoleId(input.roleKey)
      : null;
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${userId}::uuid FOR UPDATE`;
      const existing = await this.findExisting(userId, tx);
      if (input.roleKey) {
        const existingWithRoles = await this.findExistingWithRoles(userId, tx);
        if (primaryRoleKey(existingWithRoles) === ADMIN_ROLE_KEYS.SuperAdmin) {
          throw new BadRequestException({
            code: 'ADMIN_SUPER_ADMIN_ROLE_MANAGED_OUT_OF_BAND',
            msg: '超级管理员角色只能通过受控部署脚本维护，不能在后台页面降级或重新授权。',
          });
        }
      }

      const nextStatus = input.status ?? existing.status;
      await tx.adminUser.update({
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
      if (nextRoleId) {
        await replaceAdminRoleInTransaction(tx, userId, nextRoleId, actor.id);
      }
      if (input.status && input.status !== AdminUserStatus.active) {
        await this.revokeSessionsInTransaction(userId, actor.sessionId, tx);
      }
      return this.getById(userId, tx);
    });
  }

  async resetMfa(userId: string, exceptSessionId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${userId}::uuid FOR UPDATE`;
      await tx.adminMfaChallenge.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      await this.findExisting(userId, tx);
      await tx.adminUser.update({
        where: { id: userId },
        data: {
          requireMfa: true,
          mfaSecretHash: null,
          mfaEnabledAt: null,
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await this.revokeSessionsInTransaction(userId, exceptSessionId, tx);
      return this.getById(userId, tx);
    });
  }

  async resetPassword(
    userId: string,
    password: string,
    exceptSessionId?: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${userId}::uuid FOR UPDATE`;
      await tx.adminMfaChallenge.updateMany({
        where: { userId, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      const existing = await this.findExisting(userId, tx);
      const previousHashes = await this.recentPasswordHashes(userId, tx);
      this.assertPasswordPolicy({
        password,
        email: existing.email,
        displayName: existing.displayName,
        previousHashes,
      });
      const passwordHash = hashAdminPassword(password);
      await tx.adminUser.update({
        where: { id: userId },
        data: {
          passwordHash,
          passwordChangedAt: new Date(),
          failedLoginCount: 0,
          lockedUntil: null,
        },
      });
      await this.recordPasswordHistory(userId, passwordHash, tx);
      await this.revokeSessionsInTransaction(userId, exceptSessionId, tx);
      return this.getById(userId, tx);
    });
  }

  async revokeSessions(userId: string, exceptSessionId?: string) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${userId}::uuid FOR UPDATE`;
      return this.revokeSessionsInTransaction(userId, exceptSessionId, tx);
    });
  }

  private async revokeSessionsInTransaction(
    userId: string,
    exceptSessionId: string | undefined,
    tx: Prisma.TransactionClient,
  ) {
    await this.findExisting(userId, tx);
    const result = await tx.adminSession.updateMany({
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

  async getById(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const user = await tx.adminUser.findUnique({
      where: { id: userId },
      include: adminUserListInclude,
    });
    if (!user) {
      throw new NotFoundException({
        code: 'ADMIN_USER_NOT_FOUND',
        msg: '后台账号不存在。',
      });
    }
    const activeSessionCount = await tx.adminSession.count({
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

  // Role → permission matrix for the 角色权限 page. System roles stay catalog-
  // synced; custom staff roles live in the DB and can be created/edited here.
  async listRoles() {
    await ensureAdminAuthCatalog(this.prisma);
    const [roleCounts, roles] = await Promise.all([
      this.prisma.adminUserRole.groupBy({
        by: ['roleId'],
        _count: { _all: true },
      }),
      this.prisma.adminRole.findMany({
        include: { permissions: { include: { permission: true } } },
        orderBy: [{ createdAt: 'asc' }, { key: 'asc' }],
      }),
    ]);
    const countById = new Map(
      roleCounts.map((entry) => [entry.roleId, entry._count._all]),
    );
    const catalogKeys = new Set<string>(
      ADMIN_PERMISSION_CATALOG.map((permission) => permission.key),
    );

    return {
      permissions: ADMIN_PERMISSION_CATALOG.map((permission) => ({
        key: permission.key,
        description: permission.description,
        assignable: !CUSTOM_ROLE_FORBIDDEN_PERMISSIONS.has(permission.key),
      })),
      roles: roles
        .filter(
          (role) =>
            !(RETIRED_ADMIN_ROLE_KEYS as readonly string[]).includes(role.key),
        )
        .map((role) => ({
          key: role.key,
          name: role.name,
          description: role.description ?? '',
          permissions: role.permissions
            .map((entry) => entry.permission.key)
            .filter((key) => catalogKeys.has(key))
            .sort(),
          accountCount: countById.get(role.id) ?? 0,
          system: isSystemAdminRoleKey(role.key),
          assignable: !isProtectedAdminRoleKey(role.key),
        })),
    };
  }

  async createRole(input: CreateAdminRoleInput) {
    if (isSystemAdminRoleKey(input.key) || isProtectedAdminRoleKey(input.key)) {
      throw new BadRequestException({
        code: 'ADMIN_SYSTEM_ROLE_LOCKED',
        msg: '系统预定义角色不能通过后台新建。',
      });
    }
    const permissionIds = await this.resolvePermissionIds(
      input.key,
      input.permissions,
    );
    await ensureAdminAuthCatalog(this.prisma);
    try {
      await this.prisma.adminRole.create({
        data: {
          key: input.key,
          name: input.name,
          description: input.description ?? '',
          siteScope: AdminSiteScope.all,
          permissions: {
            createMany: {
              data: permissionIds.map((permissionId) => ({ permissionId })),
              skipDuplicates: true,
            },
          },
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'ADMIN_ROLE_KEY_EXISTS',
          msg: '该角色标识已存在。',
        });
      }
      throw error;
    }
    return this.listRoles();
  }

  async updateRole(roleKey: string, input: UpdateAdminRoleInput) {
    const role = await this.prisma.adminRole.findUnique({
      where: { key: roleKey },
      select: { id: true },
    });
    if (!role) {
      throw new NotFoundException({
        code: 'ADMIN_ROLE_NOT_FOUND',
        msg: '角色不存在。',
      });
    }
    const permissionIds = input.permissions
      ? await this.resolvePermissionIds(roleKey, input.permissions)
      : null;
    await this.prisma.$transaction(async (tx) => {
      if (input.name !== undefined || input.description !== undefined) {
        await tx.adminRole.update({
          where: { id: role.id },
          data: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined
              ? { description: input.description ?? '' }
              : {}),
          },
        });
      }
      if (permissionIds) {
        await tx.adminRolePermission.deleteMany({ where: { roleId: role.id } });
        await tx.adminRolePermission.createMany({
          data: permissionIds.map((permissionId) => ({
            roleId: role.id,
            permissionId,
          })),
          skipDuplicates: true,
        });
      }
    });
    return this.listRoles();
  }

  async deleteRole(roleKey: string) {
    if (isSystemAdminRoleKey(roleKey) || isProtectedAdminRoleKey(roleKey)) {
      throw new BadRequestException({
        code: 'ADMIN_SYSTEM_ROLE_LOCKED',
        msg: '系统预定义角色不能删除。',
      });
    }
    const role = await this.prisma.adminRole.findUnique({
      where: { key: roleKey },
      select: { id: true, _count: { select: { users: true } } },
    });
    if (!role) {
      throw new NotFoundException({
        code: 'ADMIN_ROLE_NOT_FOUND',
        msg: '角色不存在。',
      });
    }
    if (role._count.users > 0) {
      throw new BadRequestException({
        code: 'ADMIN_ROLE_IN_USE',
        msg: '仍有账号使用该角色，请先把账号改到其他角色再删除。',
      });
    }
    await this.prisma.adminRole.delete({ where: { id: role.id } });
    return this.listRoles();
  }

  // Global active-session view for the 会话 page (the per-user list is keyed by
  // userId; this aggregates across all admins with the owner's identity).
  async listAllSessions(query: ListAdminSessionsQuery) {
    const where: Prisma.AdminSessionWhereInput =
      query.status === 'all'
        ? {}
        : { status: AdminSessionStatus.active, expiresAt: { gt: new Date() } };

    const sessions = await this.prisma.adminSession.findMany({
      where,
      include: {
        user: { select: { id: true, email: true, displayName: true } },
      },
      orderBy: [{ lastSeenAt: 'desc' }],
      take: query.limit,
    });

    return {
      items: sessions.map((session) => ({
        id: session.id,
        userId: session.userId,
        userEmail: session.user.email,
        userDisplayName: session.user.displayName,
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

  private async findExisting(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const existing = await tx.adminUser.findUnique({
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

  private async findExistingWithRoles(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const existing = await tx.adminUser.findUnique({
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

  private async resolveAssignableRoleId(roleKey: string): Promise<string> {
    this.assertAssignableRoleKey(roleKey);
    await ensureAdminAuthCatalog(this.prisma);
    const role = await this.prisma.adminRole.findUnique({
      where: { key: roleKey },
      select: { id: true },
    });
    if (!role) {
      throw new BadRequestException({
        code: 'ADMIN_ROLE_NOT_FOUND',
        msg: '角色不存在。',
      });
    }
    return role.id;
  }

  private async resolvePermissionIds(
    roleKey: string,
    keys: string[],
  ): Promise<string[]> {
    const unique = [...new Set(keys)];
    if (!isSystemAdminRoleKey(roleKey)) {
      const forbidden = unique.filter((key) =>
        CUSTOM_ROLE_FORBIDDEN_PERMISSIONS.has(key),
      );
      if (forbidden.length) {
        throw new BadRequestException({
          code: 'ADMIN_ROLE_PERMISSION_RESERVED',
          msg: '员工角色不能包含账号管理或算力审批权限。',
          missing: forbidden,
        });
      }
    }
    if (roleKey === ADMIN_ROLE_KEYS.SuperAdmin) {
      if (!unique.includes(ADMIN_PERMISSION_KEYS.AdminManage)) {
        throw new BadRequestException({
          code: 'ADMIN_ROLE_PERMISSION_REQUIRED',
          msg: '超级管理员必须保留后台账号管理权限。',
        });
      }
      if (!unique.includes(ADMIN_PERMISSION_KEYS.CrewComputeReview)) {
        throw new BadRequestException({
          code: 'ADMIN_ROLE_PERMISSION_REQUIRED',
          msg: '超级管理员必须保留剧组算力审批权限。',
        });
      }
    }
    const catalog = new Set<string>(
      ADMIN_PERMISSION_CATALOG.map((permission) => permission.key),
    );
    const unknown = unique.filter((key) => !catalog.has(key));
    if (unknown.length) {
      throw new BadRequestException({
        code: 'ADMIN_ROLE_PERMISSION_UNKNOWN',
        msg: '包含未登记的权限。',
        missing: unknown,
      });
    }
    await ensureAdminAuthCatalog(this.prisma);
    const permissions = await this.prisma.adminPermission.findMany({
      where: { key: { in: unique } },
      select: { id: true, key: true },
    });
    if (permissions.length !== unique.length) {
      throw new BadRequestException({
        code: 'ADMIN_ROLE_PERMISSION_UNKNOWN',
        msg: '包含未登记的权限。',
      });
    }
    return permissions.map((permission) => permission.id);
  }

  private async recentPasswordHashes(
    userId: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    const history = await tx.adminPasswordHistory.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { passwordHash: true },
    });
    return history.map((item) => item.passwordHash);
  }

  private async recordPasswordHistory(
    userId: string,
    passwordHash: string,
    tx: Prisma.TransactionClient = this.prisma,
  ) {
    await tx.adminPasswordHistory.create({
      data: { userId, passwordHash },
    });
  }
}

function primaryRoleKey(user: AdminUserForList): string {
  const roleKeys = user.roles.map((userRole) => userRole.role.key);
  if (roleKeys.includes(ADMIN_ROLE_KEYS.SuperAdmin))
    return ADMIN_ROLE_KEYS.SuperAdmin;
  if (roleKeys.includes(ADMIN_ROLE_KEYS.Admin)) return ADMIN_ROLE_KEYS.Admin;
  return roleKeys[0] ?? ADMIN_ROLE_KEYS.Operations;
}
