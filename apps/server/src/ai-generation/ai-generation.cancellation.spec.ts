import type { Prisma } from '@prisma/client';
import { AiGenerationService } from './ai-generation.service';
import { AiGenerationBillingWalletService } from './billing-wallet.service';
import { AiGenerationRepository } from './repository';
import type { AiJob } from './types';

describe('AiGenerationService cancellation transaction seam', () => {
  it('commits the domain fence and AiJob claim before post-commit lifecycle work', async () => {
    const events: string[] = [];
    const queued = jobFixture();
    const cancelled = {
      ...queued,
      status: 'cancelled' as const,
      stage: 'cancelled' as const,
    };
    const store = {
      cancelIfActive: jest.fn(
        async (
          _id: string,
          options: {
            observedJob: AiJob;
            beforeCancel?: (
              tx: Prisma.TransactionClient,
              job: AiJob,
            ) => Promise<void>;
            afterCancel?: (
              tx: Prisma.TransactionClient,
              job: AiJob,
            ) => Promise<void>;
          },
        ) => {
          events.push('transaction-open');
          await options.beforeCancel?.({} as Prisma.TransactionClient, queued);
          events.push('ai-job-claimed');
          await options.afterCancel?.(
            {} as Prisma.TransactionClient,
            cancelled,
          );
          events.push('transaction-committed');
          return cancelled;
        },
      ),
      recomputeQueuePositions: jest.fn(() => {
        events.push('queue-recomputed');
        return [];
      }),
    };
    const service = serviceWith({
      store,
      providerCapacity: {
        release: jest.fn(() => events.push('capacity-released')),
      },
      billingWallet: {
        releaseForJob: jest.fn(() => events.push('billing-released')),
      },
    });

    await internalCancel(
      service,
      queued,
      () => {
        events.push('project-write-state-locked');
        return Promise.resolve();
      },
      () => {
        events.push('story-attempt-cancelled');
        return Promise.resolve();
      },
    );

    expect(events).toEqual([
      'transaction-open',
      'project-write-state-locked',
      'ai-job-claimed',
      'story-attempt-cancelled',
      'transaction-committed',
      'capacity-released',
      'billing-released',
      'queue-recomputed',
    ]);
  });

  it('replays idempotent cleanup when a prior cancellation committed before a process crash', async () => {
    const cancelled = {
      ...jobFixture(),
      status: 'cancelled' as const,
      stage: 'cancelled' as const,
    };
    const store = {
      findById: jest.fn(() => cancelled),
      recomputeQueuePositions: jest.fn(() => []),
    };
    const providerCapacity = { release: jest.fn() };
    const billingWallet = { releaseForJob: jest.fn() };
    const service = serviceWith({ store, providerCapacity, billingWallet });

    await service.cancelJob(
      { userId: cancelled.userId } as never,
      cancelled.id,
    );

    expect(providerCapacity.release).toHaveBeenCalledWith(cancelled);
    expect(billingWallet.releaseForJob).toHaveBeenCalledWith(
      cancelled,
      'ai_job_cancelled',
    );
    expect(store.recomputeQueuePositions).toHaveBeenCalledWith(
      cancelled.queueName,
    );
  });
});

describe('AiGenerationRepository claim-vs-cancel barrier', () => {
  it('does not stomp a cancel that committed between the claim read and write', async () => {
    // Interleaving: the worker's claim transaction reads the job while it is
    // still in_queue, then a user cancel (cancelIfActive's conditional
    // updateMany) commits 'cancelled' before the claim write runs. The claim
    // write must be conditional so the committed cancel stays authoritative —
    // an unconditional update would flip the job back to in_progress, run it
    // to completion and deliver output for a hold that was already refunded.
    const queuedRow = jobRowFixture('in_queue');
    const cancelledRow = jobRowFixture('cancelled');
    const tx = {
      $executeRaw: jest.fn(() => Promise.resolve(1)),
      aiJob: {
        findFirst: jest
          .fn()
          // Claim read: the job still looks queued.
          .mockResolvedValueOnce(queuedRow)
          // Re-read after the lost conditional write: the cancel committed.
          .mockResolvedValue(cancelledRow),
        findMany: jest.fn(() => Promise.resolve([])),
        // The concurrent cancel already committed, so the conditional claim
        // write matches zero rows.
        updateMany: jest.fn(() => Promise.resolve({ count: 0 })),
        update: jest.fn(),
      },
    };
    const prisma = {
      $transaction: jest.fn((operation: (value: object) => unknown) =>
        operation(tx),
      ),
    };
    const repository = new AiGenerationRepository(prisma as never, {} as never);

    const result = await repository.claimQueuedJob({
      jobId: queuedRow.id,
      limitSubject: { type: 'user', id: queuedRow.userId },
      perSubjectRunning: null,
      perTypeRunning: null,
      now: new Date().toISOString(),
    });

    expect(result).toMatchObject({
      kind: 'not_queued',
      job: expect.objectContaining({ status: 'cancelled' }),
    });
    expect(tx.aiJob.updateMany).toHaveBeenCalledWith({
      where: { id: queuedRow.id, status: 'in_queue' },
      data: expect.objectContaining({
        status: 'in_progress',
        version: { increment: 1 },
      }),
    });
    // No unconditional write may run against the row.
    expect(tx.aiJob.update).not.toHaveBeenCalled();
  });
});

describe('AiGenerationBillingWalletService duplicate terminal release', () => {
  it('no-ops a release that lost the wallet race by re-validating under the account lock', async () => {
    // Interleaving: two cancel lifecycles release the same hold concurrently.
    // The loser passes the pre-lock idempotency check and outstanding read
    // while the winner is uncommitted, then blocks on the account advisory
    // lock. Once the winner commits, the loser must observe the winner's
    // posted transaction under the lock and settle as a no-op — instead of
    // tripping the nextHeld < 0 guard (409) or the idempotency-key unique
    // constraint (unhandled P2002).
    const events: string[] = [];
    const winnerTransaction = { id: 'wallet-txn-winner' };
    const findUnique = jest.fn(() => {
      events.push('idempotency-check');
      // First check runs before the winner commits; the re-check under the
      // account lock observes the winner's committed release.
      return Promise.resolve(
        findUnique.mock.calls.length > 1 ? winnerTransaction : null,
      );
    });
    const tx = {
      $executeRaw: jest.fn(() => {
        events.push('account-lock');
        return Promise.resolve(1);
      }),
      walletTransaction: { findUnique, create: jest.fn() },
      walletCreditAllocation: {
        findMany: jest.fn(() => {
          events.push('outstanding-read');
          return Promise.resolve([
            {
              grantId: 'grant-1',
              heldDelta: 5n,
              grant: {
                id: 'grant-1',
                accountId: 'account-1',
                totalAmount: 5n,
                availableAmount: 0n,
                heldAmount: 5n,
                consumedAmount: 0n,
                expiredAmount: 0n,
                reversedAmount: 0n,
              },
            },
          ]);
        }),
      },
      walletAccount: {
        // Post-winner state: the hold is already released, so an entry built
        // from the stale pre-lock outstanding would drive heldBalance negative.
        findUniqueOrThrow: jest.fn(() =>
          Promise.resolve({
            id: 'account-1',
            status: 'active',
            currency: 'compute_point',
            balanceKind: 'consumable',
            availableBalance: 10n,
            heldBalance: 0n,
            version: 2,
          }),
        ),
        update: jest.fn(),
      },
      walletLedgerEntry: { create: jest.fn() },
    };
    const service = new AiGenerationBillingWalletService({
      $transaction: jest.fn((operation: (value: object) => unknown) =>
        operation(tx),
      ),
    } as never);

    await expect(
      service.releaseForJob(jobFixture(), 'ai_job_cancelled'),
    ).resolves.toBeUndefined();

    expect(events).toEqual([
      'idempotency-check',
      'outstanding-read',
      'account-lock',
      'idempotency-check',
    ]);
    expect(tx.walletTransaction.create).not.toHaveBeenCalled();
    expect(tx.walletLedgerEntry.create).not.toHaveBeenCalled();
    expect(tx.walletAccount.update).not.toHaveBeenCalled();
  });
});

function serviceWith(input: {
  store: object;
  providerCapacity: object;
  billingWallet: object;
}): AiGenerationService {
  return new AiGenerationService(
    { get: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    input.store as never,
    {} as never,
    { record: jest.fn() } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    input.billingWallet as never,
    input.providerCapacity as never,
    {} as never,
    {} as never,
  );
}

function internalCancel(
  service: AiGenerationService,
  job: AiJob,
  beforeCancel: (tx: Prisma.TransactionClient, job: AiJob) => Promise<void>,
  afterCancel: (tx: Prisma.TransactionClient, job: AiJob) => Promise<void>,
): Promise<AiJob> {
  return (
    service as unknown as {
      cancelJobRow: (
        current: AiJob,
        options: {
          code: 'CANCELLED_BY_USER';
          message: string;
          userMessage: string;
          retryable: boolean;
          releaseReason: string;
        },
        hooks: {
          beforeCancel: typeof beforeCancel;
          afterCancel: typeof afterCancel;
        },
      ) => Promise<AiJob>;
    }
  ).cancelJobRow(
    job,
    {
      code: 'CANCELLED_BY_USER',
      message: 'Cancelled by user.',
      userMessage: 'This generation was cancelled.',
      retryable: true,
      releaseReason: 'ai_job_cancelled',
    },
    { beforeCancel, afterCancel },
  );
}

/** Raw AiJob DB row shape (Date columns, no domain hydration) for repository mocks. */
function jobRowFixture(status: AiJob['status']) {
  const job = jobFixture();
  return {
    ...job,
    status,
    documentId: null,
    documentBlockId: null,
    sourceSurface: null,
    promptDisplayText: null,
    promptSearchText: null,
    compiledPrompt: null,
    providerJobId: null,
    error: null,
    progress: null,
    estimatedWaitSeconds: null,
    estimatedRunSeconds: null,
    estimatedTotalSeconds: null,
    etaConfidence: null,
    retryOfJobId: null,
    createdAt: new Date(job.createdAt),
    queuedAt: job.queuedAt ? new Date(job.queuedAt) : null,
    startedAt: null,
    providerSubmittedAt: null,
    providerStartedAt: null,
    providerCompletedAt: null,
    outputFetchedAt: null,
    ossUploadedAt: null,
    completedAt: null,
    updatedAt: new Date(job.updatedAt),
    outputs: [],
  };
}

function jobFixture(): AiJob {
  const now = new Date().toISOString();
  return {
    id: '019f8000-0000-7000-8000-000000000001',
    userId: 'user-1',
    type: 'video',
    provider: 'provider-test',
    modelId: 'model-test',
    deployment: 'deployment-test',
    canonicalModelId: null,
    providerBindingId: null,
    schemaVersion: '1',
    workspaceId: '019f8000-0000-7000-8000-000000000002',
    projectId: '019f8000-0000-7000-8000-000000000003',
    status: 'in_queue',
    stage: 'queued',
    input: {},
    normalizedInput: {},
    prompt: 'test',
    idempotencyKey: 'idempotency-test',
    outputs: [],
    logs: [],
    queueName: 'ai-video-generation',
    queuePosition: 0,
    attempt: 1,
    createdAt: now,
    queuedAt: now,
    updatedAt: now,
    metrics: {},
  };
}
