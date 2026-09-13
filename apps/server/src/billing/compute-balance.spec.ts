import { ListWalletLedgerQuerySchema } from './dto';
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
    walletLedgerEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
    },
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

  it('uses the caller’s own wallet in another person’s personal workspace', async () => {
    const { service, prisma, target } = setup({ personal: true });
    await service.getComputeBalance(user, target);
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
      where: { ownerUserId: user.userId, type: 'personal', deletedAt: null },
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

describe('project ledger attribution', () => {
  const projectId = '00000000-0000-4000-8000-000000000001';
  const query = {
    currency: 'compute_point' as const,
    balanceKind: 'consumable' as const,
    limit: 20,
    projectId,
  };
  it('validates the project filter', () => {
    expect(ListWalletLedgerQuerySchema.parse(query).projectId).toBe(projectId);
    expect(
      ListWalletLedgerQuerySchema.safeParse({ ...query, projectId: 'invalid' })
        .success,
    ).toBe(false);
  });
  it('intersects project attribution with the authorized wallet instead of widening access', async () => {
    const { service, prisma } = setup({ scope: 'workspace' });
    await service.listWalletLedger(user, query, 'team');
    expect(prisma.walletLedgerEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { accountId: { in: ['account'] }, transaction: { projectId } },
      }),
    );
  });
  it('rejects project-only collaborators before reading the ledger', async () => {
    const { service, prisma } = setup();
    await expect(
      service.listWalletLedger(user, query, 'team'),
    ).rejects.toMatchObject({ response: { code: 'WORKSPACE_ACCESS_DENIED' } });
    expect(prisma.walletLedgerEntry.findMany).not.toHaveBeenCalled();
  });
  it('preserves recorded attribution and transaction status with exact amounts', async () => {
    const { service, prisma } = setup({ scope: 'workspace' });
    const createdAt = new Date('2026-01-01T00:00:00Z');
    const stored = {
      id: 'entry',
      transactionId: 'transaction',
      accountId: 'account',
      entryType: 'settle',
      currency: 'compute_point',
      balanceKind: 'consumable',
      amount: 9007199254740993n,
      availableDelta: 0n,
      heldDelta: -9007199254740993n,
      availableBalanceAfter: 0n,
      heldBalanceAfter: 0n,
      reason: 'ai_job_settle',
      createdAt,
      creditAllocations: [],
      transaction: {
        projectId,
        workspaceId: 'team',
        actorUserId: 'original-actor',
        status: 'posted',
        postedAt: createdAt,
        sourceType: 'ai_job',
        sourceId: 'job',
        metadata: {},
        description: 'Usage',
      },
    };
    prisma.walletLedgerEntry.findMany.mockResolvedValue([stored] as never);
    const result = await service.listWalletLedger(user, query, 'team');
    expect(result.entries[0]).toMatchObject({
      projectId,
      workspaceId: 'team',
      actorUserId: 'original-actor',
      transactionStatus: 'posted',
      postedAt: createdAt.toISOString(),
      amount: '9007199254740993',
      sourceId: 'job',
    });
    const original = result.entries[0];
    prisma.walletLedgerEntry.findMany.mockResolvedValue([
      stored,
      { ...stored, id: 'older' },
    ] as never);
    const page = await service.listWalletLedger(
      user,
      { ...query, limit: 1 },
      'team',
    );
    expect(page.entries).toHaveLength(1);
    expect(page.nextCursor).toBe(original.id);
    prisma.walletLedgerEntry.findFirst.mockResolvedValue({
      id: original.id,
    } as never);
    prisma.walletLedgerEntry.findMany.mockResolvedValue([
      { ...stored, id: 'older' },
    ] as never);
    const next = await service.listWalletLedger(
      user,
      { ...query, limit: 1, cursor: original.id },
      'team',
    );
    expect(next.entries).toEqual([expect.objectContaining({ id: 'older' })]);
    expect(next.nextCursor).toBeNull();
    expect(prisma.walletLedgerEntry.findMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        cursor: { id: original.id },
        skip: 1,
        take: 2,
      }),
    );
  });
});

it('rejects a ledger cursor outside the wallet and project scope', async () => {
  const { service, prisma } = setup({ scope: 'workspace' });
  const projectId = '00000000-0000-4000-8000-000000000001';
  const cursor = '00000000-0000-4000-8000-000000000002';
  await expect(
    service.listWalletLedger(
      user,
      {
        currency: 'compute_point',
        balanceKind: 'consumable',
        limit: 1,
        projectId,
        cursor,
      },
      'team',
    ),
  ).rejects.toMatchObject({ response: { code: 'INVALID_LEDGER_CURSOR' } });
  expect(prisma.walletLedgerEntry.findFirst).toHaveBeenCalledWith({
    where: {
      accountId: { in: ['account'] },
      transaction: { projectId },
      id: cursor,
    },
    select: { id: true },
  });
  expect(prisma.walletLedgerEntry.findMany).not.toHaveBeenCalled();
});
