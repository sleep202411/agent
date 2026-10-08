import {
  AssignableAdminRoleKeySchema,
  AdminRoleKeySchema,
} from './admin-users.dto';
import type { PrismaClient } from '@prisma/client';
import { assignAdminRole } from './admin-auth.bootstrap';
import {
  ADMIN_ROLE_CATALOG,
  ADMIN_PERMISSION_KEYS,
  ADMIN_ROLE_KEYS,
  RETIRED_ADMIN_ROLE_KEYS,
} from './admin-auth.constants';

function fixture() {
  const events: string[] = [];
  const tx = {
    $queryRaw: jest.fn(() => {
      events.push('lock');
      return Promise.resolve([]);
    }),
    adminUserRole: {
      deleteMany: jest.fn(() => {
        events.push('delete');
        return Promise.resolve({ count: 1 });
      }),
      createMany: jest.fn(() => {
        events.push('insert');
        return Promise.resolve({ count: 1 });
      }),
    },
  };
  const prisma = {
    adminPermission: {
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      update: jest.fn().mockResolvedValue({}),
      findMany: jest.fn().mockResolvedValue([]),
    },
    adminRole: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
      findUnique: jest.fn().mockResolvedValue({ id: 'seeded' }),
      create: jest.fn(),
      update: jest.fn(({ where }: { where: { key: string } }) =>
        Promise.resolve({ id: `role-${where.key}`, key: where.key }),
      ),
    },
    adminRolePermission: {
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      findMany: jest.fn().mockResolvedValue([]),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    adminUserRole: { deleteMany: jest.fn(), createMany: jest.fn() },
    $transaction: jest.fn(
      async (work: (client: typeof tx) => Promise<void>) => {
        events.push('begin');
        await work(tx);
        events.push('commit');
      },
    ),
  };
  return { prisma, tx, events, client: prisma as unknown as PrismaClient };
}
const userId = '00000000-0000-4000-8000-000000000001';
it('locks and replaces roles inside one transaction while preserving catalog setup', async () => {
  const f = fixture();
  await assignAdminRole(
    f.client,
    userId,
    ADMIN_ROLE_KEYS.SuperAdmin,
    'operator',
  );
  expect(f.events).toEqual(['begin', 'lock', 'delete', 'insert', 'commit']);
  expect(f.prisma.adminRole.createMany).toHaveBeenCalled();
  expect(f.prisma.adminUserRole.deleteMany).not.toHaveBeenCalled();
  expect(f.prisma.adminUserRole.createMany).not.toHaveBeenCalled();
  expect(f.tx.adminUserRole.createMany).toHaveBeenCalledWith({
    data: [
      {
        userId,
        roleId: `role-${ADMIN_ROLE_KEYS.SuperAdmin}`,
        grantedBy: 'operator',
      },
    ],
    skipDuplicates: true,
  });
});
it('propagates an insertion failure to the transaction instead of completing it', async () => {
  const f = fixture();
  f.tx.adminUserRole.createMany.mockRejectedValueOnce(
    new Error('insert failed'),
  );
  await expect(
    assignAdminRole(f.client, userId, ADMIN_ROLE_KEYS.SuperAdmin),
  ).rejects.toThrow('insert failed');
  expect(f.events).not.toContain('commit');
  expect(f.prisma.adminUserRole.deleteMany).not.toHaveBeenCalled();
});
it('does not delete roles if lock acquisition fails', async () => {
  const f = fixture();
  f.tx.$queryRaw.mockRejectedValueOnce(new Error('lock timeout'));
  await expect(
    assignAdminRole(f.client, userId, ADMIN_ROLE_KEYS.SuperAdmin),
  ).rejects.toThrow('lock timeout');
  expect(f.tx.adminUserRole.deleteMany).not.toHaveBeenCalled();
  expect(f.tx.adminUserRole.createMany).not.toHaveBeenCalled();
});

it('gives compute approval to super_admin without widening Admin or Operations', () => {
  const reviewers = ADMIN_ROLE_CATALOG.filter((role) =>
    role.permissions.includes(ADMIN_PERMISSION_KEYS.CrewComputeReview),
  );
  expect(reviewers.map((role) => role.key)).toEqual([
    ADMIN_ROLE_KEYS.SuperAdmin,
  ]);
});
it('does not allow super_admin to be assigned through account-management forms', () => {
  expect(
    AssignableAdminRoleKeySchema.safeParse(ADMIN_ROLE_KEYS.SuperAdmin).success,
  ).toBe(false);
  expect(AdminRoleKeySchema.safeParse(ADMIN_ROLE_KEYS.SuperAdmin).success).toBe(
    true,
  );
});

it('accepts employee role keys on account-management forms', () => {
  expect(AssignableAdminRoleKeySchema.safeParse('wardrobe').success).toBe(true);
  expect(AssignableAdminRoleKeySchema.safeParse('instructor').success).toBe(
    true,
  );
});

it('retires removed catalog roles without deleting remaining roles', async () => {
  const f = fixture();
  await assignAdminRole(f.client, userId, ADMIN_ROLE_KEYS.Admin);
  expect(f.prisma.adminRole.deleteMany).toHaveBeenCalledTimes(1);
  expect(f.prisma.adminRole.deleteMany).toHaveBeenCalledWith({
    where: { key: { in: [...RETIRED_ADMIN_ROLE_KEYS] } },
  });
});

it('does not reset system role permissions after they have been edited', async () => {
  const f = fixture();
  f.prisma.adminPermission.findMany.mockResolvedValue([
    {
      id: 'perm-compute-review',
      key: ADMIN_PERMISSION_KEYS.CrewComputeReview,
    },
  ]);
  f.prisma.adminRolePermission.findMany.mockResolvedValue(
    Object.values(ADMIN_ROLE_KEYS).map((key) => ({ roleId: `role-${key}` })),
  );
  await assignAdminRole(f.client, userId, ADMIN_ROLE_KEYS.Admin);
  expect(f.prisma.adminRolePermission.deleteMany).not.toHaveBeenCalled();
  expect(f.prisma.adminRolePermission.createMany).toHaveBeenCalledTimes(1);
  expect(f.prisma.adminRolePermission.createMany).toHaveBeenCalledWith({
    data: [
      {
        roleId: `role-${ADMIN_ROLE_KEYS.SuperAdmin}`,
        permissionId: 'perm-compute-review',
      },
    ],
    skipDuplicates: true,
  });
});

it('keeps AI actor access on operations without folding it into media-only staff roles', () => {
  expect(
    ADMIN_ROLE_CATALOG.find((role) => role.key === ADMIN_ROLE_KEYS.Operations)
      ?.permissions,
  ).toEqual(expect.arrayContaining(['ai_actors.read', 'ai_actors.write']));
});

it('grants content operations to Admin and Operations without a dedicated finance role', () => {
  for (const permission of [
    'news.read',
    'news.write',
    'courses.read',
    'courses.write',
  ]) {
    expect(
      ADMIN_ROLE_CATALOG.filter((role) => role.permissions.includes(permission))
        .map((role) => role.key)
        .sort(),
    ).toEqual(['admin', 'operations', 'super_admin']);
  }
});
