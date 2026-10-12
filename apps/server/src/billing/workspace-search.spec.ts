import { BillingService } from './billing.service';

function setup() {
  const prisma = { workspace: { findMany: jest.fn().mockResolvedValue([]) } };
  const legacyPoints = { findUser: jest.fn() };
  const service = new BillingService(
    prisma as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    legacyPoints as never,
  );
  return { service, prisma, legacyPoints };
}

test('email search finds owned and active joined workspaces using regional identity', async () => {
  const { service, prisma, legacyPoints } = setup();
  legacyPoints.findUser.mockResolvedValue({ userId: '123' });
  await service.listAdminWorkspaces({
    query: '  creator@example.test ',
    limit: 30,
  });
  expect(legacyPoints.findUser).toHaveBeenCalledWith('creator@example.test');
  expect(prisma.workspace.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: {
        deletedAt: null,
        OR: expect.arrayContaining([
          { ownerUserId: '123' },
          {
            members: {
              some: { userId: '123', status: 'active', removedAt: null },
            },
          },
        ]) as unknown,
      },
    }),
  );
});
test('workspace name searches do not depend on contact lookup', async () => {
  const { service, legacyPoints } = setup();
  await service.listAdminWorkspaces({ query: 'Project', limit: 30 });
  expect(legacyPoints.findUser).not.toHaveBeenCalled();
});
test('contact lookup failure is not reported as an empty successful search', async () => {
  const { service, prisma, legacyPoints } = setup();
  legacyPoints.findUser.mockRejectedValue(
    new Error('Identity service unavailable'),
  );
  await expect(
    service.listAdminWorkspaces({ query: 'creator@example.test', limit: 30 }),
  ).rejects.toThrow('Identity service unavailable');
  expect(prisma.workspace.findMany).not.toHaveBeenCalled();
});

test('rejects a stale cross-site confirmation before touching any balance', async () => {
  const { service } = setup();
  await expect(
    service.createAdminWorkspaceWalletCredit('pax', {
      workspaceId: 'workspace',
      expectedSite: 'cn',
      amount: 100n,
      reason: 'test',
      idempotencyKey: 'test-key',
      grantType: 'admin_adjustment',
      metadata: {},
    }),
  ).rejects.toThrow('confirmed site');
});
