import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  Prisma,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCreditGrantStatus,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  WalletTransactionStatus,
  WorkspaceType,
  type WalletAccount,
  type WalletCreditGrant,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { enqueueWalletChanged } from '../workspaces/wallet-realtime';
import type { AiJob, AiRoutingSnapshot } from './types';

type ChargeableJob = Pick<
  AiJob,
  | 'id'
  | 'userId'
  | 'workspaceId'
  | 'projectId'
  | 'modelId'
  | 'canonicalModelId'
  | 'providerBindingId'
  | 'routingSnapshot'
>;

type WalletTx = Prisma.TransactionClient;
type Payer = {
  ownerType: WalletOwnerType;
  ownerId: string;
  billingScope: 'user' | 'workspace_team';
};
type CreditGrantSnapshot = Pick<
  WalletCreditGrant,
  | 'id'
  | 'accountId'
  | 'totalAmount'
  | 'availableAmount'
  | 'heldAmount'
  | 'consumedAmount'
  | 'expiredAmount'
  | 'reversedAmount'
>;
type HeldLot = {
  grantId: string;
  accountId: string;
  amount: bigint;
  grant: CreditGrantSnapshot;
};
type OutstandingHeld = {
  accountId: string;
  amount: bigint;
  lots: HeldLot[];
};

@Injectable()
export class AiGenerationBillingWalletService {
  constructor(private readonly prisma: PrismaService) {}

  async reserveForJobInTransaction(args: {
    tx: Prisma.TransactionClient;
    job: ChargeableJob;
  }): Promise<void> {
    const amount = chargeAmount(args.job.routingSnapshot);
    if (amount <= 0n) return;

    const tx = args.tx;
    const payer = await resolvePayerTx(tx, args.job);
    const account = await tx.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: payer.ownerType,
          ownerId: payer.ownerId,
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
      create: {
        ownerType: payer.ownerType,
        ownerId: payer.ownerId,
        currency: WalletCurrencyType.compute_point,
        balanceKind: WalletBalanceKind.consumable,
        status: WalletAccountStatus.active,
      },
      update: {},
    });

    // Job-scoped (not request-scoped): each reserve is for exactly one NEW job
    // (job-level dedup returns the existing job without re-reserving), so the
    // hold key must be unique per jobId — matching settle/release. The old
    // request-scoped key (payer + model + client idempotencyKey) collided across
    // DIFFERENT jobs that shared a client idempotencyKey — e.g. two members of
    // the same team pot reusing a key — silently skipping the second job's hold
    // and letting it generate unbilled.
    const idempotencyKey = jobScopedIdempotencyKey('ai_job:hold', args.job.id);
    const existing = await tx.walletTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return;

    await lockWalletAccountTx(tx, account.id);

    let locked = await tx.walletAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    ensureActiveWalletAccount(locked);
    locked = await expireDueCreditGrantsTx(tx, locked, {
      actorUserId: args.job.userId,
      workspaceId: args.job.workspaceId ?? null,
      projectId: args.job.projectId ?? null,
    });

    const nextAvailable = locked.availableBalance - amount;
    const nextHeld = locked.heldBalance + amount;
    if (nextAvailable < 0n) {
      throw new ConflictException({
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        msg: 'Not enough compute points. Recharge and try again.',
        requiredAmount: amount.toString(),
        availableBalance: locked.availableBalance.toString(),
      });
    }

    const transaction = await tx.walletTransaction.create({
      data: {
        status: WalletTransactionStatus.posted,
        sourceType: 'ai_job',
        sourceId: args.job.id,
        idempotencyKey,
        actorUserId: args.job.userId,
        workspaceId: args.job.workspaceId ?? null,
        projectId: args.job.projectId ?? null,
        description: `AI generation reserved ${amount.toString()} compute points.`,
        metadata: walletMetadata({
          event: 'hold',
          amount,
          job: args.job,
          payer,
        }),
      },
    });

    const entry = await tx.walletLedgerEntry.create({
      data: {
        transactionId: transaction.id,
        accountId: locked.id,
        entryType: WalletLedgerEntryType.hold,
        currency: locked.currency,
        balanceKind: locked.balanceKind,
        amount,
        availableDelta: -amount,
        heldDelta: amount,
        availableBalanceAfter: nextAvailable,
        heldBalanceAfter: nextHeld,
        reason: 'ai_job_hold',
      },
    });

    await holdAvailableCreditGrantsTx(tx, {
      accountId: locked.id,
      transactionId: transaction.id,
      ledgerEntryId: entry.id,
      amount,
    });

    const updated = await tx.walletAccount.update({
      where: { id: locked.id },
      data: {
        availableBalance: nextAvailable,
        heldBalance: nextHeld,
        version: { increment: 1 },
      },
    });
    // Realtime: the hold dropped available balance — reflect it without polling.
    await enqueueWalletChanged(tx, updated);
  }

  async settleForJob(job: ChargeableJob): Promise<void> {
    await this.postTerminalEntry(job, {
      entryType: WalletLedgerEntryType.settle,
      availableDeltaSign: 0n,
      heldDeltaSign: -1n,
      reason: 'ai_job_settle',
      idempotencyKey: jobScopedIdempotencyKey('ai_job:settle', job.id),
      description: 'AI generation charged compute points.',
      event: 'settle',
    });
  }

  async releaseForJob(
    job: ChargeableJob,
    reason = 'ai_job_release',
  ): Promise<void> {
    await this.postTerminalEntry(job, {
      entryType: WalletLedgerEntryType.release,
      availableDeltaSign: 1n,
      heldDeltaSign: -1n,
      reason: 'ai_job_release',
      idempotencyKey: jobScopedIdempotencyKey('ai_job:release', job.id),
      description: 'AI generation released compute points.',
      event: reason,
    });
  }

  private async postTerminalEntry(
    job: ChargeableJob,
    input: {
      entryType: WalletLedgerEntryType;
      availableDeltaSign: 0n | 1n;
      heldDeltaSign: -1n;
      reason: string;
      idempotencyKey: string;
      description: string;
      event: string;
    },
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const existing = await tx.walletTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return;

      const outstanding = await outstandingHeldTx(tx, job.id);
      if (outstanding.amount <= 0n) return;

      await lockWalletAccountTx(tx, outstanding.accountId);
      const account = await tx.walletAccount.findUniqueOrThrow({
        where: { id: outstanding.accountId },
      });
      ensureActiveWalletAccount(account);

      const availableDelta = outstanding.amount * input.availableDeltaSign;
      const heldDelta = outstanding.amount * input.heldDeltaSign;
      const nextAvailable = account.availableBalance + availableDelta;
      const nextHeld = account.heldBalance + heldDelta;
      if (nextAvailable < 0n || nextHeld < 0n) {
        throw new ConflictException({
          code: 'WALLET_HELD_BALANCE_INCONSISTENT',
          msg: 'Wallet held balance is inconsistent for this AI job.',
          jobId: job.id,
        });
      }

      const transaction = await tx.walletTransaction.create({
        data: {
          status: WalletTransactionStatus.posted,
          sourceType: 'ai_job',
          sourceId: job.id,
          idempotencyKey: input.idempotencyKey,
          actorUserId: job.userId,
          workspaceId: job.workspaceId ?? null,
          projectId: job.projectId ?? null,
          description: `${input.description} ${outstanding.amount.toString()}`,
          metadata: walletMetadata({
            event: input.event,
            amount: outstanding.amount,
            job,
          }),
        },
      });

      const entry = await tx.walletLedgerEntry.create({
        data: {
          transactionId: transaction.id,
          accountId: account.id,
          entryType: input.entryType,
          currency: account.currency,
          balanceKind: account.balanceKind,
          amount: outstanding.amount,
          availableDelta,
          heldDelta,
          availableBalanceAfter: nextAvailable,
          heldBalanceAfter: nextHeld,
          reason: input.reason,
        },
      });

      await applyTerminalCreditGrantAllocationsTx(tx, {
        transactionId: transaction.id,
        ledgerEntryId: entry.id,
        entryType: input.entryType,
        lots: outstanding.lots,
      });

      const updated = await tx.walletAccount.update({
        where: { id: account.id },
        data: {
          availableBalance: nextAvailable,
          heldBalance: nextHeld,
          version: { increment: 1 },
        },
      });
      // Realtime: settle/release changed the balance — push to the workspace.
      await enqueueWalletChanged(tx, updated, job.userId);
    });
  }
}

async function resolvePayerTx(
  tx: WalletTx,
  job: ChargeableJob,
): Promise<Payer> {
  // compute_point is uniformly workspace-owned: a job always charges the pot of
  // the workspace it ran in. job.workspaceId is set for every job at create time
  // (the server resolves the personal workspace when no team is in context), so
  // the workspace branch is the live path. billingScope stays as metadata-only
  // analytics: team workspaces read 'workspace_team', personal reads 'user'.
  if (job.workspaceId) {
    const workspace = await tx.workspace.findUnique({
      where: { id: job.workspaceId },
      select: { id: true, type: true },
    });
    if (workspace) {
      return {
        ownerType: WalletOwnerType.workspace,
        ownerId: workspace.id,
        billingScope:
          workspace.type === WorkspaceType.team ? 'workspace_team' : 'user',
      };
    }
  }
  // Defensive fallback (unreachable in normal flow): no workspace on the job →
  // charge the user's personal-workspace pot if it exists.
  const personal = await tx.workspace.findFirst({
    where: {
      ownerUserId: job.userId,
      type: WorkspaceType.personal,
      deletedAt: null,
    },
    select: { id: true },
  });
  if (personal) {
    return {
      ownerType: WalletOwnerType.workspace,
      ownerId: personal.id,
      billingScope: 'user',
    };
  }
  return {
    ownerType: WalletOwnerType.user,
    ownerId: job.userId,
    billingScope: 'user',
  };
}

async function expireDueCreditGrantsTx(
  tx: WalletTx,
  account: WalletAccount,
  context: {
    actorUserId: string;
    workspaceId: string | null;
    projectId: string | null;
  },
): Promise<WalletAccount> {
  const now = new Date();
  const grants = await tx.walletCreditGrant.findMany({
    where: {
      accountId: account.id,
      status: WalletCreditGrantStatus.active,
      availableAmount: { gt: 0n },
      expiresAt: { lte: now },
    },
    orderBy: [{ expiresAt: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
  });

  let current = account;
  for (const grant of grants) {
    const amount = grant.availableAmount;
    if (amount <= 0n) continue;
    const idempotencyKey = `wallet_credit_expire:${grant.id}`;
    const existing = await tx.walletTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      current = await tx.walletAccount.findUniqueOrThrow({
        where: { id: account.id },
      });
      continue;
    }

    const nextAvailable = current.availableBalance - amount;
    if (nextAvailable < 0n) {
      throw new ConflictException({
        code: 'WALLET_CREDIT_GRANT_EXPIRY_INCONSISTENT',
        msg: 'Wallet credit grant expiry would make the account balance negative.',
        accountId: account.id,
        grantId: grant.id,
      });
    }

    const transaction = await tx.walletTransaction.create({
      data: {
        status: WalletTransactionStatus.posted,
        sourceType: 'wallet_credit_expiration',
        sourceId: grant.id,
        idempotencyKey,
        actorUserId: context.actorUserId,
        workspaceId: context.workspaceId,
        projectId: context.projectId,
        description: `Expired ${amount.toString()} compute points.`,
        metadata: {
          grantId: grant.id,
          grantType: grant.grantType,
          expiresAt: grant.expiresAt?.toISOString() ?? null,
        },
      },
    });
    const entry = await tx.walletLedgerEntry.create({
      data: {
        transactionId: transaction.id,
        accountId: account.id,
        entryType: WalletLedgerEntryType.expire,
        currency: account.currency,
        balanceKind: account.balanceKind,
        amount,
        availableDelta: -amount,
        heldDelta: 0n,
        availableBalanceAfter: nextAvailable,
        heldBalanceAfter: current.heldBalance,
        reason: 'compute_point_expired',
      },
    });

    const nextExpired = grant.expiredAmount + amount;
    await tx.walletCreditGrant.update({
      where: { id: grant.id },
      data: {
        availableAmount: 0n,
        expiredAmount: nextExpired,
        status: creditGrantStatusAfter({
          totalAmount: grant.totalAmount,
          availableAmount: 0n,
          heldAmount: grant.heldAmount,
          consumedAmount: grant.consumedAmount,
          expiredAmount: nextExpired,
          reversedAmount: grant.reversedAmount,
        }),
      },
    });
    await tx.walletCreditAllocation.create({
      data: {
        grantId: grant.id,
        transactionId: transaction.id,
        ledgerEntryId: entry.id,
        amount,
        availableDelta: -amount,
        heldDelta: 0n,
        consumedDelta: 0n,
        expiredDelta: amount,
        reversedDelta: 0n,
      },
    });
    current = await tx.walletAccount.update({
      where: { id: account.id },
      data: {
        availableBalance: nextAvailable,
        version: { increment: 1 },
      },
    });
  }
  return current;
}

async function holdAvailableCreditGrantsTx(
  tx: WalletTx,
  input: {
    accountId: string;
    transactionId: string;
    ledgerEntryId: string;
    amount: bigint;
  },
) {
  let remaining = input.amount;
  const now = new Date();
  const grants = await tx.walletCreditGrant.findMany({
    where: {
      accountId: input.accountId,
      status: WalletCreditGrantStatus.active,
      availableAmount: { gt: 0n },
      validFrom: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
    },
    orderBy: [
      { expiresAt: { sort: 'asc', nulls: 'last' } },
      { priority: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });

  for (const grant of grants) {
    if (remaining <= 0n) break;
    const take =
      grant.availableAmount < remaining ? grant.availableAmount : remaining;
    const nextAvailable = grant.availableAmount - take;
    const nextHeld = grant.heldAmount + take;
    await tx.walletCreditGrant.update({
      where: { id: grant.id },
      data: {
        availableAmount: nextAvailable,
        heldAmount: nextHeld,
        status: WalletCreditGrantStatus.active,
      },
    });
    await tx.walletCreditAllocation.create({
      data: {
        grantId: grant.id,
        transactionId: input.transactionId,
        ledgerEntryId: input.ledgerEntryId,
        amount: take,
        availableDelta: -take,
        heldDelta: take,
        consumedDelta: 0n,
        expiredDelta: 0n,
        reversedDelta: 0n,
      },
    });
    remaining -= take;
  }

  if (remaining > 0n) {
    throw new ConflictException({
      code: 'INSUFFICIENT_UNEXPIRED_COMPUTE_POINTS',
      msg: 'Not enough usable compute points. Some points may be expired or unavailable.',
      requiredAmount: input.amount.toString(),
      unavailableAmount: remaining.toString(),
    });
  }
}

async function outstandingHeldTx(
  tx: WalletTx,
  jobId: string,
): Promise<OutstandingHeld> {
  const allocations = await tx.walletCreditAllocation.findMany({
    where: {
      transaction: {
        sourceType: 'ai_job',
        sourceId: jobId,
      },
    },
    include: {
      grant: true,
    },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  });

  const byGrant = new Map<string, HeldLot>();
  for (const allocation of allocations) {
    const existing = byGrant.get(allocation.grantId);
    const nextAmount = (existing?.amount ?? 0n) + allocation.heldDelta;
    if (existing) {
      existing.amount = nextAmount;
    } else {
      byGrant.set(allocation.grantId, {
        grantId: allocation.grantId,
        accountId: allocation.grant.accountId,
        amount: nextAmount,
        grant: allocation.grant,
      });
    }
  }

  const lots = [...byGrant.values()].filter((lot) => lot.amount > 0n);
  if (lots.length > 0) {
    const accountId = lots[0].accountId;
    if (lots.some((lot) => lot.accountId !== accountId)) {
      throw new ServiceUnavailableException({
        code: 'AI_JOB_WALLET_ACCOUNT_MIXED',
        msg: 'AI job wallet reservations span multiple accounts.',
        jobId,
      });
    }
    return {
      accountId,
      amount: lots.reduce((sum, lot) => sum + lot.amount, 0n),
      lots,
    };
  }

  const legacyRows = await tx.walletLedgerEntry.findMany({
    where: {
      transaction: {
        sourceType: 'ai_job',
        sourceId: jobId,
      },
    },
    select: {
      accountId: true,
      heldDelta: true,
    },
  });
  const heldByAccount = new Map<string, bigint>();
  for (const row of legacyRows) {
    heldByAccount.set(
      row.accountId,
      (heldByAccount.get(row.accountId) ?? 0n) + row.heldDelta,
    );
  }
  const positive = [...heldByAccount.entries()].filter(([, held]) => held > 0n);
  if (positive.length === 0) return { accountId: '', amount: 0n, lots: [] };
  if (positive.length > 1) {
    throw new ServiceUnavailableException({
      code: 'AI_JOB_WALLET_ACCOUNT_MIXED',
      msg: 'AI job wallet reservations span multiple accounts.',
      jobId,
    });
  }
  const [accountId, amount] = positive[0];
  const legacyLots = await heldGrantLotsForLegacyReservationTx(
    tx,
    accountId,
    amount,
  );
  return { accountId, amount, lots: legacyLots };
}

async function heldGrantLotsForLegacyReservationTx(
  tx: WalletTx,
  accountId: string,
  amount: bigint,
): Promise<HeldLot[]> {
  let remaining = amount;
  const grants = await tx.walletCreditGrant.findMany({
    where: {
      accountId,
      status: WalletCreditGrantStatus.active,
      heldAmount: { gt: 0n },
    },
    orderBy: [
      { expiresAt: { sort: 'asc', nulls: 'last' } },
      { priority: 'asc' },
      { createdAt: 'asc' },
      { id: 'asc' },
    ],
  });
  const lots: HeldLot[] = [];
  for (const grant of grants) {
    if (remaining <= 0n) break;
    const take = grant.heldAmount < remaining ? grant.heldAmount : remaining;
    lots.push({
      grantId: grant.id,
      accountId: grant.accountId,
      amount: take,
      grant,
    });
    remaining -= take;
  }

  if (remaining > 0n) {
    throw new ConflictException({
      code: 'WALLET_CREDIT_GRANT_HELD_MISSING',
      msg: 'Wallet held balance is missing matching credit grant lots.',
      accountId,
      requiredAmount: amount.toString(),
      missingAmount: remaining.toString(),
    });
  }

  return lots;
}

async function applyTerminalCreditGrantAllocationsTx(
  tx: WalletTx,
  input: {
    transactionId: string;
    ledgerEntryId: string;
    entryType: WalletLedgerEntryType;
    lots: HeldLot[];
  },
) {
  for (const lot of input.lots) {
    if (lot.amount <= 0n) continue;
    if (lot.grant.heldAmount < lot.amount) {
      throw new ConflictException({
        code: 'WALLET_CREDIT_GRANT_HELD_INCONSISTENT',
        msg: 'Wallet credit grant held amount is inconsistent.',
        grantId: lot.grantId,
      });
    }

    const isSettle = input.entryType === WalletLedgerEntryType.settle;
    const nextHeld = lot.grant.heldAmount - lot.amount;
    const nextAvailable = isSettle
      ? lot.grant.availableAmount
      : lot.grant.availableAmount + lot.amount;
    const nextConsumed = isSettle
      ? lot.grant.consumedAmount + lot.amount
      : lot.grant.consumedAmount;

    await tx.walletCreditGrant.update({
      where: { id: lot.grantId },
      data: {
        availableAmount: nextAvailable,
        heldAmount: nextHeld,
        consumedAmount: nextConsumed,
        status: creditGrantStatusAfter({
          totalAmount: lot.grant.totalAmount,
          availableAmount: nextAvailable,
          heldAmount: nextHeld,
          consumedAmount: nextConsumed,
          expiredAmount: lot.grant.expiredAmount,
          reversedAmount: lot.grant.reversedAmount,
        }),
      },
    });
    await tx.walletCreditAllocation.create({
      data: {
        grantId: lot.grantId,
        transactionId: input.transactionId,
        ledgerEntryId: input.ledgerEntryId,
        amount: lot.amount,
        availableDelta: isSettle ? 0n : lot.amount,
        heldDelta: -lot.amount,
        consumedDelta: isSettle ? lot.amount : 0n,
        expiredDelta: 0n,
        reversedDelta: 0n,
      },
    });
  }
}

function ensureActiveWalletAccount(account: WalletAccount) {
  if (account.status !== WalletAccountStatus.active) {
    throw new ConflictException({
      code: 'WALLET_ACCOUNT_NOT_ACTIVE',
      msg: 'Wallet account is not active.',
    });
  }
}

async function lockWalletAccountTx(tx: WalletTx, accountId: string) {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${accountId}`})::bigint)
  `;
}

function chargeAmount(snapshot: AiRoutingSnapshot | null | undefined): bigint {
  const policy = snapshot?.policy.quota;
  if (!policy || policy.mode === 'free' || policy.cost <= 0) return 0n;
  return BigInt(Math.max(0, Math.ceil(policy.cost)));
}

function jobScopedIdempotencyKey(prefix: string, jobId: string): string {
  return `${prefix}:${jobId}`;
}

function walletMetadata(input: {
  event: string;
  amount: bigint;
  job: ChargeableJob;
  payer?: Payer;
}) {
  return {
    event: input.event,
    amount: input.amount.toString(),
    jobId: input.job.id,
    modelId: input.job.modelId,
    canonicalModelId: input.job.canonicalModelId ?? null,
    providerBindingId: input.job.providerBindingId ?? null,
    payer: input.payer
      ? {
          ownerType: input.payer.ownerType,
          ownerId: input.payer.ownerId,
          billingScope: input.payer.billingScope,
        }
      : null,
    selectedProvider: input.job.routingSnapshot?.selectedProvider ?? null,
    selectedDeployment: input.job.routingSnapshot?.selectedDeployment ?? null,
    selectedProviderEndpointId:
      input.job.routingSnapshot?.selectedProviderEndpointId ?? null,
    pricing: input.job.routingSnapshot
      ? {
          mode: input.job.routingSnapshot.policy.quota.mode,
          cost: input.job.routingSnapshot.policy.quota.cost,
          reason: input.job.routingSnapshot.policy.quota.reason,
          routeId: input.job.routingSnapshot.routeId,
          presetId: input.job.routingSnapshot.presetId,
          selectedAt: input.job.routingSnapshot.selectedAt,
          snapshotVersion: input.job.routingSnapshot.version,
        }
      : null,
  };
}

function creditGrantStatusAfter(input: {
  totalAmount: bigint;
  availableAmount: bigint;
  heldAmount: bigint;
  consumedAmount: bigint;
  expiredAmount: bigint;
  reversedAmount: bigint;
}): WalletCreditGrantStatus {
  if (input.availableAmount > 0n || input.heldAmount > 0n) {
    return WalletCreditGrantStatus.active;
  }
  if (input.expiredAmount > 0n) return WalletCreditGrantStatus.expired;
  if (input.reversedAmount === input.totalAmount) {
    return WalletCreditGrantStatus.reversed;
  }
  return WalletCreditGrantStatus.exhausted;
}
