import { ensureWalletAccount } from './wallet-account-admission';
import { randomUUID } from 'node:crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import {
  Prisma,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCreditGrantStatus,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  WalletTransactionStatus,
  type WalletAccount,
  type WalletLedgerEntry,
  type WalletTransaction,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { enqueueWalletChanged } from './wallet-realtime';

// compute_point is workspace-owned (the workspace you work in is the pot);
// community_point — the creator economy — is user-owned. Each owner type
// provisions only the accounts that apply to it, so there are no orphan pots.
const WORKSPACE_WALLET_ACCOUNTS = [
  {
    currency: WalletCurrencyType.compute_point,
    balanceKind: WalletBalanceKind.consumable,
  },
] as const;

const USER_WALLET_ACCOUNTS = [
  {
    currency: WalletCurrencyType.community_point,
    balanceKind: WalletBalanceKind.consumable,
  },
  {
    currency: WalletCurrencyType.community_point,
    balanceKind: WalletBalanceKind.withdrawable,
  },
] as const;

export interface PostWalletEntryInput {
  accountId: string;
  entryType: WalletLedgerEntryType;
  amount: bigint;
  availableDelta: bigint;
  heldDelta: bigint;
  reason: string;
  sourceType: string;
  sourceId?: string | null;
  idempotencyKey: string;
  actorUserId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  creditGrant?: {
    grantType: WalletCreditGrantType;
    validFrom?: Date | null;
    expiresAt?: Date | null;
    priority?: number | null;
    metadata?: Record<string, unknown>;
  };
}

export interface PostedWalletEntry {
  transaction: WalletTransaction;
  entry: WalletLedgerEntry;
  account: WalletAccount;
  deduped: boolean;
}

@Injectable()
export class WalletLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaultAccounts(
    ownerType: WalletOwnerType,
    ownerId: string,
    client: Prisma.TransactionClient = this.prisma,
  ): Promise<WalletAccount[]> {
    const specs =
      ownerType === WalletOwnerType.workspace
        ? WORKSPACE_WALLET_ACCOUNTS
        : USER_WALLET_ACCOUNTS;
    const accounts: WalletAccount[] = [];
    for (const accountSpec of specs) {
      accounts.push(
        await ensureWalletAccount(client, {
          ownerType,
          ownerId,
          currency: accountSpec.currency,
          balanceKind: accountSpec.balanceKind,
        }),
      );
    }
    return accounts;
  }

  async postEntry(input: PostWalletEntryInput): Promise<PostedWalletEntry> {
    assertPositiveLedgerAmount(input.amount);

    // Sweep lapsed grants first so the denormalized balance is honest before the
    // admission check (a stale-inflated balance would admit a spend the FIFO
    // consume then can't fulfill). No-op + cheap when nothing has lapsed.
    await this.expireLapsedGrants(input.accountId);

    return this.prisma.$transaction((tx) => this.postEntryTx(tx, input));
  }

  /**
   * Post a wallet entry inside an existing business transaction. This is the
   * financial boundary for flows such as crew approval/cash-out: the domain
   * state and the wallet journal either commit together or both roll back.
   *
   * Callers that debit expiring consumable grants must sweep those grants
   * before entering their transaction. Withdrawable creator/crew earnings do
   * not expire and can use this method directly.
   */
  async postEntryTx(
    tx: Prisma.TransactionClient,
    input: PostWalletEntryInput,
  ): Promise<PostedWalletEntry> {
    assertPositiveLedgerAmount(input.amount);

    // Match callers that already hold the account lock; then serialize one intent
    // even when competing callers accidentally supply different accounts.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${input.accountId}`})::bigint)
    `;

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:intent:${input.idempotencyKey}`})::bigint)`;

    const existing = await tx.walletTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { entries: true },
    });
    if (existing?.entries[0]) {
      const entry = existing.entries[0];
      if (
        existing.entries.length !== 1 ||
        entry.accountId !== input.accountId ||
        entry.entryType !== input.entryType ||
        entry.amount !== input.amount ||
        entry.availableDelta !== input.availableDelta ||
        entry.heldDelta !== input.heldDelta ||
        existing.sourceType !== input.sourceType ||
        existing.sourceId !== (input.sourceId ?? null)
      ) {
        throw new ConflictException({
          code: 'WALLET_ENTRY_INTENT_CONFLICT',
          msg: 'This wallet entry intent was already used for a different request.',
        });
      }
      if (input.creditGrant) {
        const grant = await tx.walletCreditGrant.findFirst({
          where: { accountId: input.accountId, transactionId: existing.id },
        });
        if (!grant || grant.grantType !== input.creditGrant.grantType) {
          throw new ConflictException({
            code: 'WALLET_ENTRY_INTENT_CONFLICT',
            msg: 'This wallet entry intent was already used for different grant terms.',
          });
        }
      }
      const account = await tx.walletAccount.findUniqueOrThrow({
        where: { id: existing.entries[0].accountId },
      });
      return {
        transaction: existing,
        entry: existing.entries[0],
        account,
        deduped: true,
      };
    }

    const account = await tx.walletAccount.findUniqueOrThrow({
      where: { id: input.accountId },
    });
    if (account.status !== WalletAccountStatus.active) {
      throw new ConflictException({
        code: 'WALLET_ACCOUNT_NOT_ACTIVE',
        msg: 'Wallet account is not active.',
      });
    }

    const nextAvailable = account.availableBalance + input.availableDelta;
    const nextHeld = account.heldBalance + input.heldDelta;
    if (nextAvailable < 0n || nextHeld < 0n) {
      throw new ConflictException({
        code: 'INSUFFICIENT_WALLET_BALANCE',
        msg: 'Wallet balance is insufficient.',
      });
    }

    const transaction = await tx.walletTransaction.create({
      data: {
        status: WalletTransactionStatus.posted,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        idempotencyKey: input.idempotencyKey,
        actorUserId: input.actorUserId ?? null,
        workspaceId: input.workspaceId ?? null,
        projectId: input.projectId ?? null,
        description: input.description ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });

    const entry = await tx.walletLedgerEntry.create({
      data: {
        transactionId: transaction.id,
        accountId: account.id,
        entryType: input.entryType,
        currency: account.currency,
        balanceKind: account.balanceKind,
        amount: input.amount,
        availableDelta: input.availableDelta,
        heldDelta: input.heldDelta,
        availableBalanceAfter: nextAvailable,
        heldBalanceAfter: nextHeld,
        reason: input.reason,
      },
    });

    if (isCreditGrantBackedAccount(account)) {
      if (input.availableDelta > 0n && input.heldDelta === 0n) {
        await createCreditGrantTx(tx, {
          account,
          transaction,
          entry,
          input,
        });
      } else if (input.availableDelta < 0n && input.heldDelta === 0n) {
        await consumeAvailableGrantsTx(tx, {
          accountId: account.id,
          transactionId: transaction.id,
          ledgerEntryId: entry.id,
          amount: -input.availableDelta,
          entryType: input.entryType,
        });
      }
    }

    const updated = await tx.walletAccount.update({
      where: { id: account.id },
      data: {
        availableBalance: nextAvailable,
        heldBalance: nextHeld,
        version: { increment: 1 },
      },
    });

    // Realtime: reflect the new compute balance without polling (atomic in this
    // tx — the event and the balance write commit together). No-op non-compute.
    await enqueueWalletChanged(tx, updated, input.actorUserId);

    return { transaction, entry, account: updated, deduped: false };
  }

  /**
   * Sweep lapsed credit grants for an account: any active grant past its
   * expiresAt with availableAmount > 0 is expired — an `expire` ledger entry is
   * posted, the grant's remaining available moves to expiredAmount, and the
   * account's denormalized availableBalance is decremented to match. This is
   * what makes credit expiry real on the balance (the spend path already refuses
   * expired grants). Idempotent (a re-run finds nothing), advisory-locked, and
   * cheap: a pre-check means reads never write unless something actually lapsed.
   */
  async expireLapsedGrants(accountId: string): Promise<{ expired: bigint }> {
    const now = new Date();
    const pending = await this.prisma.walletCreditGrant.findFirst({
      where: {
        accountId,
        status: WalletCreditGrantStatus.active,
        availableAmount: { gt: 0n },
        expiresAt: { not: null, lte: now },
      },
      select: { id: true },
    });
    if (!pending) return { expired: 0n };

    return this.prisma.$transaction(async (tx) => {
      // expireLapsedGrantsTx is lock-free by contract (its raw-write callers
      // already hold the account lock). As the standalone entry point we MUST
      // take the per-account advisory lock ourselves — it writes availableBalance
      // absolutely from a re-read, so without the lock a concurrent locked spend
      // that commits in between would be clobbered (balance/grant drift →
      // INSUFFICIENT_UNEXPIRED_WALLET_GRANTS on a positive balance).
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${accountId}`})::bigint)
      `;
      return expireLapsedGrantsTx(tx, accountId);
    });
  }
}

type WalletTx = Prisma.TransactionClient;

function assertPositiveLedgerAmount(amount: bigint) {
  if (amount <= 0n) {
    throw new ConflictException({
      code: 'INVALID_LEDGER_AMOUNT',
      msg: 'Ledger amount must be positive.',
    });
  }
}

/**
 * Expire lapsed grants for an account INSIDE a caller's transaction (the
 * tx-scoped core of expireLapsedGrants — same effect, no own transaction). Use
 * this from a raw-write spend path that must sweep-then-debit atomically. The
 * caller should already hold the account advisory lock. Idempotent + no-op when
 * nothing has lapsed.
 */
export async function expireLapsedGrantsTx(
  tx: WalletTx,
  accountId: string,
): Promise<{ expired: bigint }> {
  const now = new Date();
  const grants = await tx.walletCreditGrant.findMany({
    where: {
      accountId,
      status: WalletCreditGrantStatus.active,
      availableAmount: { gt: 0n },
      expiresAt: { not: null, lte: now },
    },
    orderBy: { id: 'asc' },
  });
  if (grants.length === 0) return { expired: 0n };

  const account = await tx.walletAccount.findUniqueOrThrow({
    where: { id: accountId },
  });
  const transaction = await tx.walletTransaction.create({
    data: {
      status: WalletTransactionStatus.posted,
      sourceType: 'credit_expiry',
      sourceId: accountId,
      idempotencyKey: `credit_expiry:${accountId}:${randomUUID()}`,
      workspaceId:
        account.ownerType === WalletOwnerType.workspace
          ? account.ownerId
          : null,
      description: 'Credit grant expiry sweep',
      metadata: {},
    },
  });

  let running = account.availableBalance;
  let total = 0n;
  for (const grant of grants) {
    const amount = grant.availableAmount;
    running -= amount;
    total += amount;
    const entry = await tx.walletLedgerEntry.create({
      data: {
        transactionId: transaction.id,
        accountId,
        entryType: WalletLedgerEntryType.expire,
        currency: account.currency,
        balanceKind: account.balanceKind,
        amount,
        availableDelta: -amount,
        heldDelta: 0n,
        availableBalanceAfter: running,
        heldBalanceAfter: account.heldBalance,
        reason: 'credit_grant_expired',
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
    await tx.walletCreditGrant.update({
      where: { id: grant.id },
      data: {
        availableAmount: 0n,
        expiredAmount: grant.expiredAmount + amount,
        status: WalletCreditGrantStatus.expired,
      },
    });
  }
  const updated = await tx.walletAccount.update({
    where: { id: accountId },
    data: { availableBalance: running, version: { increment: 1 } },
  });
  // Only push when something actually expired (else the balance is unchanged).
  if (total > 0n) await enqueueWalletChanged(tx, updated);
  return { expired: total };
}

async function createCreditGrantTx(
  tx: WalletTx,
  args: {
    account: WalletAccount;
    transaction: WalletTransaction;
    entry: WalletLedgerEntry;
    input: PostWalletEntryInput;
  },
) {
  const grant = args.input.creditGrant;
  const grantType = grant?.grantType ?? inferCreditGrantType(args.input);
  const validFrom = grant?.validFrom ?? new Date();
  const expiresAt = grant?.expiresAt ?? null;
  const amount = args.input.availableDelta;

  if (amount <= 0n) return;
  if (expiresAt && expiresAt <= validFrom) {
    throw new ConflictException({
      code: 'WALLET_GRANT_EXPIRES_BEFORE_START',
      msg: 'Wallet credit grant expiry must be after its start time.',
    });
  }

  const creditGrant = await tx.walletCreditGrant.create({
    data: {
      accountId: args.account.id,
      transactionId: args.transaction.id,
      grantType,
      status: WalletCreditGrantStatus.active,
      totalAmount: amount,
      availableAmount: amount,
      heldAmount: 0n,
      consumedAmount: 0n,
      expiredAmount: 0n,
      reversedAmount: 0n,
      priority: grant?.priority ?? defaultGrantPriority(grantType, expiresAt),
      validFrom,
      expiresAt,
      sourceType: args.input.sourceType,
      sourceId: args.input.sourceId ?? null,
      metadata: {
        ...(args.input.metadata ?? {}),
        ...(grant?.metadata ?? {}),
        walletTransactionId: args.transaction.id,
        walletLedgerEntryId: args.entry.id,
      } as Prisma.InputJsonValue,
    },
  });

  await tx.walletCreditAllocation.create({
    data: {
      grantId: creditGrant.id,
      transactionId: args.transaction.id,
      ledgerEntryId: args.entry.id,
      amount,
      availableDelta: amount,
      heldDelta: 0n,
      consumedDelta: 0n,
      expiredDelta: 0n,
      reversedDelta: 0n,
    },
  });
}

export async function consumeAvailableGrantsTx(
  tx: WalletTx,
  args: {
    accountId: string;
    transactionId: string;
    ledgerEntryId: string;
    amount: bigint;
    entryType: WalletLedgerEntryType;
  },
) {
  let remaining = args.amount;
  const now = new Date();
  const grants = await tx.walletCreditGrant.findMany({
    where: {
      accountId: args.accountId,
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
    const reversedDelta = shouldReverseGrant(args.entryType) ? take : 0n;
    const consumedDelta = shouldReverseGrant(args.entryType) ? 0n : take;
    const nextConsumed = grant.consumedAmount + consumedDelta;
    const nextReversed = grant.reversedAmount + reversedDelta;

    await tx.walletCreditGrant.update({
      where: { id: grant.id },
      data: {
        availableAmount: nextAvailable,
        consumedAmount: nextConsumed,
        reversedAmount: nextReversed,
        status: grantStatusAfter({
          totalAmount: grant.totalAmount,
          availableAmount: nextAvailable,
          heldAmount: grant.heldAmount,
          consumedAmount: nextConsumed,
          expiredAmount: grant.expiredAmount,
          reversedAmount: nextReversed,
        }),
      },
    });
    await tx.walletCreditAllocation.create({
      data: {
        grantId: grant.id,
        transactionId: args.transactionId,
        ledgerEntryId: args.ledgerEntryId,
        amount: take,
        availableDelta: -take,
        heldDelta: 0n,
        consumedDelta,
        expiredDelta: 0n,
        reversedDelta,
      },
    });
    remaining -= take;
  }

  if (remaining > 0n) {
    throw new ConflictException({
      code: 'INSUFFICIENT_UNEXPIRED_WALLET_GRANTS',
      msg: 'Wallet balance is unavailable because usable credit grants are insufficient.',
      requiredAmount: args.amount.toString(),
      remainingAmount: remaining.toString(),
    });
  }
}

/**
 * Whether a wallet account is backed by credit grants (FIFO lots with expiry)
 * rather than a plain running balance. The SINGLE source of truth — every raw
 * write that touches such an account MUST keep grants in sync with the balance.
 *
 * consumable pots for BOTH currencies are grant-backed:
 *   - compute_point/consumable — workspace credits (paid = non-expiring grant,
 *     promo/membership = expiring).
 *   - community_point/consumable — user credits (paid recharge = non-expiring,
 *     gifted referral points = 30d expiring).
 * WITHDRAWABLE community_point (the creator/referral cash-out pool) is a plain
 * balance — earned money never expires — and is intentionally NOT grant-backed.
 */
export function isGrantBackedCurrencyKind(
  currency: WalletCurrencyType,
  balanceKind: WalletBalanceKind,
): boolean {
  return (
    balanceKind === WalletBalanceKind.consumable &&
    (currency === WalletCurrencyType.compute_point ||
      currency === WalletCurrencyType.community_point)
  );
}

function isCreditGrantBackedAccount(account: WalletAccount): boolean {
  return isGrantBackedCurrencyKind(account.currency, account.balanceKind);
}

function inferCreditGrantType(
  input: PostWalletEntryInput,
): WalletCreditGrantType {
  if (input.sourceType === 'billing_order') {
    const grantType = grantTypeFromMetadata(input.metadata);
    return grantType ?? WalletCreditGrantType.purchase_topup;
  }
  if (input.sourceType.includes('check_in')) {
    return WalletCreditGrantType.check_in_reward;
  }
  if (
    input.sourceType.includes('campaign') ||
    input.sourceType.includes('promotion') ||
    input.sourceType.includes('activity')
  ) {
    return WalletCreditGrantType.campaign_reward;
  }
  if (
    input.sourceType.includes('admin') ||
    input.sourceType.includes('adjustment') ||
    input.entryType === WalletLedgerEntryType.adjustment
  ) {
    return WalletCreditGrantType.admin_adjustment;
  }
  if (input.entryType === WalletLedgerEntryType.refund) {
    return WalletCreditGrantType.refund_return;
  }
  return WalletCreditGrantType.system_grant;
}

function grantTypeFromMetadata(
  metadata?: Record<string, unknown>,
): WalletCreditGrantType | null {
  const value = metadata?.grantType;
  return typeof value === 'string' && value in WalletCreditGrantType
    ? (value as WalletCreditGrantType)
    : null;
}

function defaultGrantPriority(
  grantType: WalletCreditGrantType,
  expiresAt: Date | null,
): number {
  if (expiresAt) return 10;
  if (grantType === WalletCreditGrantType.membership_included) return 20;
  if (grantType === WalletCreditGrantType.check_in_reward) return 30;
  if (grantType === WalletCreditGrantType.campaign_reward) return 40;
  if (grantType === WalletCreditGrantType.admin_adjustment) return 80;
  if (grantType === WalletCreditGrantType.purchase_topup) return 100;
  return 120;
}

function shouldReverseGrant(entryType: WalletLedgerEntryType): boolean {
  return (
    entryType === WalletLedgerEntryType.refund ||
    entryType === WalletLedgerEntryType.adjustment ||
    entryType === WalletLedgerEntryType.transfer_out
  );
}

function grantStatusAfter(input: {
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
