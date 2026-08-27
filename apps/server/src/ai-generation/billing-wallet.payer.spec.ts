import { AiGenerationBillingWalletService } from './billing-wallet.service';

jest.mock('../workspaces/wallet-realtime', () => ({
  enqueueWalletChanged: jest.fn(() => Promise.resolve()),
}));

/**
 * Payer attribution regression (2026-08-18 incident): an invited collaborator
 * generating inside someone ELSE's personal-workspace project must charge
 * their OWN personal pot — never the host's. Team-workspace projects keep
 * charging the shared team pot; the owner working in their own personal
 * project resolves to the same pot as before.
 */
describe('AiGenerationBillingWalletService payer resolution', () => {
  function expectUpsertPayer(
    upsert: jest.Mock,
    expected: { ownerType: 'user' | 'workspace'; ownerId: string },
  ) {
    const calls = upsert.mock.calls as unknown[][];
    const input = calls[0]?.[0] as
      | {
          where?: {
            ownerType_ownerId_currency_balanceKind?: {
              ownerType?: string;
              ownerId?: string;
            };
          };
        }
      | undefined;

    expect(input?.where?.ownerType_ownerId_currency_balanceKind).toMatchObject(
      expected,
    );
  }

  function buildTx(input: {
    hostWorkspace: { id: string; type: 'personal' | 'team' } | null;
    actorPersonalWorkspaceId: string | null;
  }) {
    const upsert = jest.fn(() =>
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
      workspace: {
        findUnique: jest.fn(() => Promise.resolve(input.hostWorkspace)),
        findFirst: jest.fn(() =>
          Promise.resolve(
            input.actorPersonalWorkspaceId
              ? { id: input.actorPersonalWorkspaceId }
              : null,
          ),
        ),
      },
      walletAccount: {
        upsert,
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
    return { tx, upsert };
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

  it('charges the ACTOR personal pot when the host workspace is personal (invited collaborator)', async () => {
    const { tx, upsert } = buildTx({
      hostWorkspace: { id: 'host-ws', type: 'personal' },
      actorPersonalWorkspaceId: 'guest-own-ws',
    });
    const service = new AiGenerationBillingWalletService(
      null as never,
      null as never,
    );
    await service.reserveForJobInTransaction({ tx: tx as never, job: job() });

    expectUpsertPayer(upsert, {
      ownerType: 'workspace',
      ownerId: 'guest-own-ws',
    });
  });

  it('keeps charging the shared team pot when the host workspace is a team', async () => {
    const { tx, upsert } = buildTx({
      hostWorkspace: { id: 'host-ws', type: 'team' },
      actorPersonalWorkspaceId: 'guest-own-ws',
    });
    const service = new AiGenerationBillingWalletService(
      null as never,
      null as never,
    );
    await service.reserveForJobInTransaction({ tx: tx as never, job: job() });

    expectUpsertPayer(upsert, {
      ownerType: 'workspace',
      ownerId: 'host-ws',
    });
    // Team path never needs the actor's personal-workspace lookup.
    expect(tx.workspace.findFirst).not.toHaveBeenCalled();
  });

  it('resolves the owner in their own personal workspace to the same pot as before', async () => {
    const { tx, upsert } = buildTx({
      hostWorkspace: { id: 'host-ws', type: 'personal' },
      // The owner's personal workspace IS the host workspace.
      actorPersonalWorkspaceId: 'host-ws',
    });
    const service = new AiGenerationBillingWalletService(
      null as never,
      null as never,
    );
    await service.reserveForJobInTransaction({
      tx: tx as never,
      job: job({ userId: 'owner-user' }),
    });

    expectUpsertPayer(upsert, {
      ownerType: 'workspace',
      ownerId: 'host-ws',
    });
  });

  it('uses the immutable job payer instead of inferring it from workspace scope', async () => {
    const { tx, upsert } = buildTx({
      hostWorkspace: { id: 'host-ws', type: 'team' },
      actorPersonalWorkspaceId: 'guest-own-ws',
    });
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

    expectUpsertPayer(upsert, {
      ownerType: 'user',
      ownerId: 'guest-user',
    });
    expect(tx.workspace.findUnique).not.toHaveBeenCalled();
    expect(tx.workspace.findFirst).not.toHaveBeenCalled();
  });

  it('maps an actor-funded Story project to the actor personal wallet without moving balance', async () => {
    const prisma = {
      storyProject: {
        findUnique: jest.fn().mockResolvedValue({
          billingMode: 'actor',
          billingAccountId: null,
        }),
      },
      workspace: {
        findFirst: jest.fn().mockResolvedValue({ id: 'guest-own-ws' }),
      },
    };
    const service = new AiGenerationBillingWalletService(
      prisma as never,
      null as never,
    );

    await expect(
      service.resolveStoryProjectPayer('story-1', 'guest-user'),
    ).resolves.toEqual({ type: 'workspace', id: 'guest-own-ws' });
  });

  it('resolves an account-funded Story project through its explicit compute wallet', async () => {
    const prisma = {
      storyProject: {
        findUnique: jest.fn().mockResolvedValue({
          billingMode: 'account',
          billingAccountId: 'account-1',
        }),
      },
      walletAccount: {
        findFirst: jest.fn().mockResolvedValue({
          ownerType: 'workspace',
          ownerId: 'project-pool-1',
        }),
      },
    };
    const service = new AiGenerationBillingWalletService(
      prisma as never,
      null as never,
    );

    await expect(
      service.resolveStoryProjectPayer('story-1', 'guest-user'),
    ).resolves.toEqual({ type: 'workspace', id: 'project-pool-1' });
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
