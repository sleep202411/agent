import { AdminSiteScope, type PrismaClient } from '@prisma/client';
import {
  ADMIN_PERMISSION_CATALOG,
  ADMIN_ROLE_CATALOG,
  ADMIN_ROLE_KEYS,
  type AdminRoleKey,
  ADMIN_SUPER_ROLE_KEY,
} from './admin-auth.constants';

export async function ensureAdminAuthCatalog(prisma: PrismaClient): Promise<{
  roleIds: Record<AdminRoleKey, string>;
  superRoleId: string;
}> {
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

  const roleKeys = ADMIN_ROLE_CATALOG.map((role) => role.key);
  await prisma.adminRole.deleteMany({
    where: { key: { notIn: roleKeys } },
  });
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
  await prisma.adminRolePermission.deleteMany({
    where: { roleId: { in: roles.map((role) => role.id) } },
  });
  for (const role of ADMIN_ROLE_CATALOG) {
    await prisma.adminRolePermission.createMany({
      data: role.permissions
        .map((permissionKey) => permissionIds.get(permissionKey))
        .filter((permissionId): permissionId is string => Boolean(permissionId))
        .map((permissionId) => ({
          roleId: roleIds[role.key],
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
  await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM admin_users WHERE id=${userId}::uuid FOR UPDATE`;
    await tx.adminUserRole.deleteMany({ where: { userId } });
    await tx.adminUserRole.createMany({
      data: [{ userId, roleId: roleIds[roleKey], grantedBy }],
      skipDuplicates: true,
    });
  });
}
