import { AiGenerationBillingWalletService } from './billing-wallet.service';

jest.mock('../workspaces/wallet-realtime', () => ({
  enqueueWalletChanged: jest.fn(() => Promise.resolve()),
}));

/** Projects spend from their workspace; frozen historical payers remain authoritative. */
describe('AiGenerationBillingWalletService payer resolution', () => {
  function expectAdmissionPayer(
    createMany: jest.Mock,
    expected: { ownerType: 'user' | 'workspace'; ownerId: string },
  ) {
    expect(createMany).toHaveBeenCalledWith({
      data: [expect.objectContaining(expected)],
      skipDuplicates: true,
    });
  }

  function buildTx() {
    const createMany = jest.fn(() =>
      Promise.resolve({ id: 'acct-1', currency: 'compute_point' }),
    );
    const grant = {
      id: 'grant-1',
      accountId: 'acct-1',
      totalAmount: 100n,
      availableAmount: 100n,
      heldAmount: 0n,
      consumedAmount: 0n,
      expiredAmount: 0n,
      reversedAmount: 0n,
      status: 'active',
      priority: 0,
      validFrom: new Date(0),
      expiresAt: null,
      createdAt: new Date(0),
    };
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([]),
      workspace: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      crewTask: { findUnique: jest.fn().mockResolvedValue(null) },
      walletAccount: {
        createMany,
        findUniqueOrThrow: jest.fn(() =>
          Promise.resolve({
            id: 'acct-1',
            status: 'active',
            currency: 'compute_point',
            balanceKind: 'consumable',
            availableBalance: 100n,
            heldBalance: 0n,
            version: 1,
          }),
        ),
        update: jest.fn(() =>
          Promise.resolve({
            id: 'acct-1',
            availableBalance: 95n,
            heldBalance: 5n,
          }),
        ),
      },
      walletTransaction: {
        findUnique: jest.fn(() => Promise.resolve(null)),
        create: jest.fn(() => Promise.resolve({ id: 'txn-1' })),
      },
      walletLedgerEntry: {
        create: jest.fn(() => Promise.resolve({ id: 'entry-1' })),
      },
      walletCreditGrant: {
        // First findMany: expiry sweep (none due). Second: holdable grants.
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([grant]),
        update: jest.fn(() => Promise.resolve(grant)),
      },
      walletCreditAllocation: {
        create: jest.fn(() => Promise.resolve({ id: 'alloc-1' })),
      },
      $executeRaw: jest.fn(() => Promise.resolve(1)),
    };
    return { tx, createMany };
  }

  const job = (overrides: Partial<Record<string, unknown>> = {}) =>
    ({
      id: 'job-1',
      userId: 'guest-user',
      workspaceId: 'host-ws',
      projectId: 'project-1',
      modelId: 'model-1',
      canonicalModelId: null,
      providerBindingId: null,
      routingSnapshot: {
        policy: { quota: { mode: 'metered', cost: 5, reason: 'test' } },
      },
      ...overrides,
    }) as never;

  it('charges the project workspace for an invited collaborator', async () => {
    const { tx, createMany } = buildTx();
    const service = new AiGenerationBillingWalletService(
      null as never,
      null as never,
    );
    await service.reserveForJobInTransaction({ tx: tx as never, job: job() });

    expectAdmissionPayer(createMany, {
      ownerType: 'workspace',
      ownerId: 'host-ws',
    });
  });

  it('checks an approved task allowance before reserving any points', async () => {
    const { tx } = buildTx();
    tx.crewTask.findUnique.mockResolvedValue({
      id: 'task',
      deletedAt: null,
      crew: { workspaceId: 'host-ws', deletedAt: null },
      assignees: [{ userId: 'guest-user' }],
      computeRequests: [
        {
          userId: 'guest-user',
          points: 4,
          status: 'approved',
          workspaceId: 'host-ws',
          createdAt: new Date(),
        },
      ],
    });
    const extended = {
      ...tx,
      walletTransaction: {
        ...tx.walletTransaction,
        findMany: jest.fn().mockResolvedValue([]),
      },
      walletLedgerEntry: {
        ...tx.walletLedgerEntry,
        aggregate: jest
          .fn()
          .mockResolvedValue({ _sum: { availableDelta: 0n } }),
      },
    };
    const service = new AiGenerationBillingWalletService(
      null as never,
      null as never,
    );
    await expect(
      service.reserveForJobInTransaction({ tx: extended as never, job: job() }),
    ).rejects.toThrow('allowance exceeded');
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(tx.walletLedgerEntry.create).not.toHaveBeenCalled();
  });

  it('never queries the actor workspace while resolving a project payer', async () => {
    const { tx, createMany } = buildTx();
    const service = new AiGenerationBillingWalletService(
      null as never,
      null as never,
    );
    await service.reserveForJobInTransaction({ tx: tx as never, job: job() });

    expectAdmissionPayer(createMany, {
      ownerType: 'workspace',
      ownerId: 'host-ws',
    });
    // Payer resolution must not depend on the actor's default workspace.
    expect(tx.workspace.findFirst).not.toHaveBeenCalled();
  });

  it('charges the same workspace when the actor is the project owner', async () => {
    const { tx, createMany } = buildTx();
    const service = new AiGenerationBillingWalletService(
      null as never,
      null as never,
    );
    await service.reserveForJobInTransaction({
      tx: tx as never,
      job: job({ userId: 'owner-user' }),
    });

    expectAdmissionPayer(createMany, {
      ownerType: 'workspace',
      ownerId: 'host-ws',
    });
  });

  it('uses the immutable job payer instead of inferring it from workspace scope', async () => {
    const { tx, createMany } = buildTx();
    const service = new AiGenerationBillingWalletService(
      null as never,
      null as never,
    );
    await service.reserveForJobInTransaction({
      tx: tx as never,
      job: job({
        billingSubjectType: 'user',
        billingSubjectId: 'guest-user',
      }),
    });

    expectAdmissionPayer(createMany, {
      ownerType: 'user',
      ownerId: 'guest-user',
    });
    expect(tx.workspace.findUnique).not.toHaveBeenCalled();
    expect(tx.workspace.findFirst).not.toHaveBeenCalled();
  });

  it('resolves Story billing directly from the project workspace', async () => {
    const prisma = {
      storyProject: {
        findUnique: jest.fn().mockResolvedValue({ workspaceId: 'host-ws' }),
      },
    };
    const service = new AiGenerationBillingWalletService(
      prisma as never,
      null as never,
    );
    await expect(service.resolveStoryProjectPayer('story-1')).resolves.toEqual({
      type: 'workspace',
      id: 'host-ws',
    });
  });

  it('fails closed without a resolved workspace rather than spending a user wallet', async () => {
    const { tx, createMany } = buildTx();
    const service = new AiGenerationBillingWalletService(
      null as never,
      null as never,
    );
    await expect(
      service.reserveForJobInTransaction({
        tx: tx as never,
        job: job({ workspaceId: null }),
      }),
    ).rejects.toMatchObject({
      response: { code: 'GENERATION_WORKSPACE_REQUIRED' },
    });
    expect(createMany).not.toHaveBeenCalled();
  });

  it('sweeps expired grants before returning the payer balance', async () => {
    const accountBefore = {
      id: 'account-1',
      status: 'active',
      availableBalance: 100n,
      heldBalance: 5n,
    };
    const accountAfter = {
      ...accountBefore,
      availableBalance: 80n,
    };
    const prisma = {
      crewTask: { findUnique: jest.fn().mockResolvedValue(null) },
      walletAccount: {
        findUnique: jest
          .fn()
          .mockResolvedValueOnce(accountBefore)
          .mockResolvedValueOnce(accountAfter),
      },
    };
    const walletLedger = {
      expireLapsedGrants: jest.fn().mockResolvedValue({ expired: 20n }),
    };
    const service = new AiGenerationBillingWalletService(
      prisma as never,
      walletLedger as never,
    );

    await expect(
      service.getComputeBalance({ type: 'workspace', id: 'payer-1' }),
    ).resolves.toEqual({ available: 80n, held: 5n, total: 85n });
    expect(walletLedger.expireLapsedGrants).toHaveBeenCalledWith('account-1');
  });
});
