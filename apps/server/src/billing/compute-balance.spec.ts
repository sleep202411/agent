import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';

const user = { userId: 'collaborator' };

function setup({
  scope = 'project_only',
  active = true,
  workspaceActive = true,
  personal = false,
}: {
  scope?: string;
  active?: boolean;
  workspaceActive?: boolean;
  personal?: boolean;
} = {}) {
  const target = personal ? 'host-personal' : 'team';
  const account = {
    id: 'account',
    ownerType: 'workspace',
    ownerId: target,
    status: 'active',
    availableBalance: 9007199254740993n,
    heldBalance: 7n,
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
  };
  const prisma = {
    workspaceMember: {
      findFirst: jest.fn(
        ({
          where,
        }: {
          where: { workspaceId: string; userId: string; accessScope?: string };
        }) =>
          where.workspaceId === target &&
          where.userId === user.userId &&
          active &&
          workspaceActive &&
          (!where.accessScope || where.accessScope === scope)
            ? {
                workspaceId: target,
                userId: user.userId,
                accessScope: scope,
                role: 'viewer',
              }
            : null,
      ),
    },
    workspace: {
      findUniqueOrThrow: jest
        .fn()
        .mockResolvedValue({ type: personal ? 'personal' : 'team' }),
      findFirst: jest.fn().mockResolvedValue({ id: 'my-personal' }),
    },
    walletAccount: { findMany: jest.fn().mockResolvedValue([account]) },
    walletCreditGrant: { findFirst: jest.fn().mockResolvedValue(null) },
    walletLedgerEntry: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const expiry = {
    expireLapsedGrants: jest.fn().mockResolvedValue({ expired: 0n }),
  };
  const service = new BillingService(
    prisma as never,
    {} as never,
    new WorkspacePermissionService(prisma as never),
    expiry as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { service, prisma, expiry, account, target };
}

describe('compute balance access', () => {
  it('reproduces the old project-only rejection and allows the balance-only read', async () => {
    const { service, prisma } = setup();
    await expect(
      service.listWalletLedger(
        user,
        {
          currency: 'compute_point',
          balanceKind: 'consumable',
          limit: 1,
        },
        'team',
      ),
    ).rejects.toMatchObject({ response: { code: 'WORKSPACE_ACCESS_DENIED' } });
    const controller = new BillingController(
      service,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(controller.getComputeBalance(user, 'team')).resolves.toEqual({
      code: 200,
      data: {
        available: '9007199254740993',
        held: '7',
        total: '9007199254741000',
        nextExpiry: null,
      },
    });
    expect(prisma.walletLedgerEntry.findMany).not.toHaveBeenCalled();
    expect(prisma.workspaceMember.findFirst).toHaveBeenLastCalledWith({
      where: {
        workspaceId: 'team',
        userId: user.userId,
        status: 'active',
        removedAt: null,
        workspace: { status: 'active', deletedAt: null },
      },
    });
  });

  it('allows an ordinary workspace viewer to see the balance', async () => {
    const { service } = setup({ scope: 'workspace' });
    await expect(
      service.getComputeBalance(user, 'team'),
    ).resolves.toHaveProperty('available', '9007199254740993');
  });

  it('preserves the ledger response for existing workspace members', async () => {
    const { service, prisma } = setup({ scope: 'workspace' });
    await expect(
      service.listWalletLedger(
        user,
        {
          currency: 'compute_point',
          balanceKind: 'consumable',
          limit: 1,
        },
        'team',
      ),
    ).resolves.toMatchObject({
      accounts: [
        {
          id: 'account',
          availableBalance: '9007199254740993',
          heldBalance: '7',
        },
      ],
      entries: [],
      nextExpiry: null,
    });
    expect(prisma.walletLedgerEntry.findMany).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['unrelated workspace', {}, 'other-team'],
    ['removed membership', { active: false }, 'team'],
    ['inactive workspace', { workspaceActive: false }, 'team'],
  ] as const)(
    'rejects %s before reading financial data',
    async (_name, options, target) => {
      const { service, prisma } = setup(options);
      await expect(
        service.getComputeBalance(user, target),
      ).rejects.toMatchObject({
        response: { code: 'WORKSPACE_ACCESS_DENIED' },
      });
      expect(prisma.walletAccount.findMany).not.toHaveBeenCalled();
    },
  );

  it('reads the project workspace pot even when it is another user’s default', async () => {
    const { service, prisma, target } = setup({ personal: true });
    await service.getComputeBalance(user, target);
    expect(prisma.walletAccount.findMany).toHaveBeenCalledWith({
      where: {
        ownerType: 'workspace',
        ownerId: target,
        currency: 'compute_point',
        balanceKind: 'consumable',
        status: 'active',
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  });

  it('returns zero for a wallet that has no accounts', async () => {
    const { service, prisma } = setup();
    prisma.walletAccount.findMany.mockResolvedValue([]);
    await expect(service.getComputeBalance(user, 'team')).resolves.toEqual({
      available: '0',
      held: '0',
      total: '0',
      nextExpiry: null,
    });
    expect(prisma.walletCreditGrant.findFirst).not.toHaveBeenCalled();
  });

  it('uses the caller’s personal pot when no workspace is specified', async () => {
    const { service, prisma } = setup();
    await service.getComputeBalance(user);
    expect(prisma.workspaceMember.findFirst).not.toHaveBeenCalled();
    expect(prisma.workspace.findFirst).toHaveBeenCalledWith({
      where: { defaultForUserId: user.userId, deletedAt: null },
      select: { id: true },
    });
    expect(prisma.walletAccount.findMany).toHaveBeenCalledWith({
      where: {
        ownerType: 'workspace',
        ownerId: 'my-personal',
        currency: 'compute_point',
        balanceKind: 'consumable',
        status: 'active',
      },
      orderBy: [{ createdAt: 'asc' }],
    });
  });

  it('refreshes expired grants before returning the balance and next expiry', async () => {
    const { service, prisma, expiry, account } = setup();
    expiry.expireLapsedGrants.mockResolvedValue({ expired: 3n });
    prisma.walletAccount.findMany
      .mockResolvedValueOnce([account])
      .mockResolvedValueOnce([{ ...account, availableBalance: 12n }]);
    const expiresAt = new Date('2027-01-01T00:00:00.000Z');
    prisma.walletCreditGrant.findFirst.mockResolvedValue({
      availableAmount: 5n,
      expiresAt,
    });
    await expect(service.getComputeBalance(user, 'team')).resolves.toEqual({
      available: '12',
      held: '7',
      total: '19',
      nextExpiry: { amount: '5', expiresAt: expiresAt.toISOString() },
    });
  });
});
