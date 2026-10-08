import { AdminSiteScope, type Prisma, type PrismaClient } from '@prisma/client';
import {
  ADMIN_PERMISSION_CATALOG,
  ADMIN_ROLE_CATALOG,
  ADMIN_ROLE_KEYS,
  ADMIN_STAFF_ROLE_SEEDS,
  RETIRED_ADMIN_ROLE_KEYS,
  type AdminRoleKey,
  ADMIN_SUPER_ROLE_KEY,
} from './admin-auth.constants';

export async function ensureAdminAuthCatalog(prisma: PrismaClient): Promise<{
  roleIds: Record<AdminRoleKey, string>;
  superRoleId: string;
}> {
  await prisma.adminRole.deleteMany({
    where: { key: { in: [...RETIRED_ADMIN_ROLE_KEYS] } },
  });
  await prisma.adminPermission.createMany({
    data: ADMIN_PERMISSION_CATALOG.map((permission) => ({
      key: permission.key,
      description: permission.description,
    })),
    skipDuplicates: true,
  });
  for (const permission of ADMIN_PERMISSION_CATALOG) {
    await prisma.adminPermission.update({
      where: { key: permission.key },
      data: { description: permission.description },
    });
  }

  await prisma.adminRole.createMany({
    data: ADMIN_ROLE_CATALOG.map((role) => ({
      key: role.key,
      name: role.name,
      description: role.description,
      siteScope: AdminSiteScope.all,
    })),
    skipDuplicates: true,
  });
  const roles = await Promise.all(
    ADMIN_ROLE_CATALOG.map((role) =>
      prisma.adminRole.update({
        where: { key: role.key },
        data: {
          name: role.name,
          description: role.description,
          siteScope: AdminSiteScope.all,
        },
      }),
    ),
  );
  const roleIds = Object.fromEntries(
    roles.map((role) => [role.key, role.id]),
  ) as Record<AdminRoleKey, string>;
  const permissions = await prisma.adminPermission.findMany();
  const permissionIds = new Map(
    permissions.map((permission) => [permission.key, permission.id]),
  );
  const existingLinks = await prisma.adminRolePermission.findMany({
    where: { roleId: { in: roles.map((role) => role.id) } },
    select: { roleId: true },
  });
  const seededRoleIds = new Set(existingLinks.map((entry) => entry.roleId));
  for (const role of ADMIN_ROLE_CATALOG) {
    const roleId = roleIds[role.key];
    if (seededRoleIds.has(roleId)) continue;
    await prisma.adminRolePermission.createMany({
      data: role.permissions
        .map((permissionKey) => permissionIds.get(permissionKey))
        .filter((permissionId): permissionId is string => Boolean(permissionId))
        .map((permissionId) => ({
          roleId,
          permissionId,
        })),
      skipDuplicates: true,
    });
  }

  const superAdmin = ADMIN_ROLE_CATALOG.find(
    (role) => role.key === ADMIN_ROLE_KEYS.SuperAdmin,
  );
  const superGrants = (superAdmin?.permissions ?? [])
    .map((key) => permissionIds.get(key))
    .filter((id): id is string => Boolean(id))
    .map((permissionId) => ({
      roleId: roleIds[ADMIN_ROLE_KEYS.SuperAdmin],
      permissionId,
    }));
  if (superGrants.length) {
    await prisma.adminRolePermission.createMany({
      data: superGrants,
      skipDuplicates: true,
    });
  }

  for (const seed of ADMIN_STAFF_ROLE_SEEDS) {
    const existing = await prisma.adminRole.findUnique({
      where: { key: seed.key },
      select: { id: true },
    });
    if (existing) continue;
    const created = await prisma.adminRole.create({
      data: {
        key: seed.key,
        name: seed.name,
        description: seed.description,
        siteScope: AdminSiteScope.all,
      },
    });
    await prisma.adminRolePermission.createMany({
      data: seed.permissions
        .map((permissionKey) => permissionIds.get(permissionKey))
        .filter((permissionId): permissionId is string => Boolean(permissionId))
        .map((permissionId) => ({
          roleId: created.id,
          permissionId,
        })),
      skipDuplicates: true,
    });
  }

  return { roleIds, superRoleId: roleIds[ADMIN_ROLE_KEYS.SuperAdmin] };
}

export async function assignAdminSuperRole(
  prisma: PrismaClient,
  userId: string,
): Promise<void> {
  await assignAdminRole(prisma, userId, ADMIN_SUPER_ROLE_KEY);
}

export async function assignAdminRole(
  prisma: PrismaClient,
  userId: string,
  roleKey: AdminRoleKey,
  grantedBy?: string,
): Promise<void> {
  const { roleIds } = await ensureAdminAuthCatalog(prisma);
  await prisma.$transaction((tx) =>
    replaceAdminRoleInTransaction(tx, userId, roleIds[roleKey], grantedBy),
  );
}

/** Share the caller's transaction when a role is part of a larger account write. */
export async function replaceAdminRoleInTransaction(
  tx: Prisma.TransactionClient,
  userId: string,
  roleId: string,
  grantedBy?: string,
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${userId}::uuid FOR UPDATE`;
  await tx.adminUserRole.deleteMany({ where: { userId } });
  await tx.adminUserRole.createMany({
    data: [{ userId, roleId, grantedBy }],
    skipDuplicates: true,
  });
}
