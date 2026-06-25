import { Injectable } from '@nestjs/common';
import {
  Prisma,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  WorkspaceType,
  type WalletAccount,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { WalletLedgerService, WorkspacesService } from '../workspaces';
import type {
  DeductPointsInput,
  GrantPointsInput,
  MigratePointsInput,
} from './internal-points.dto';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * The Java <-> PG points bridge for the lazy per-user migration. Java keeps the
 * old MySQL balance for un-migrated users; it calls `migrate` (once per user) to
 * move that user onto the PG compute_point wallet, then routes that user's
 * deduct/grant here. Everything maps to the user's personal-workspace pot
 * (compute_point is workspace-owned) and is idempotent.
 */
@Injectable()
export class InternalPointsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletLedger: WalletLedgerService,
    private readonly workspaces: WorkspacesService,
  ) {}

  /** Ingest the user's Java balance into PG exactly once; idempotent per user. */
  async migrate(input: MigratePointsInput) {
    const { userId } = input;
    const workspaceId = await this.personalWorkspaceId(userId);

    const existing = await this.prisma.pointsMigration.findUnique({
      where: { userId },
    });
    if (!existing) {
      try {
        await this.prisma.pointsMigration.create({
          data: { userId, migratedBalance: input.balance, workspaceId },
        });
      } catch (err) {
        // Raced a concurrent migrate for the same user -> the marker exists now.
        if (!isUniqueViolation(err)) throw err;
      }
    }

    // Credit the ingested balance idempotently (keyed by user). A re-call (or a
    // crash between marker-create and credit) credits exactly once; a different
    // balance on a later call dedupes to the first.
    // `alreadyMigrated` must reflect whether the migration CREDIT was already
    // applied (the ledger is the source of truth), not merely whether the marker
    // row exists — the two can drift (e.g. the marker is missing but the per-user
    // credit is already in the ledger), which previously made this flag lie:
    // alreadyMigrated=false while the balance was already the migrated one.
    let balance: bigint;
    let alreadyMigrated = Boolean(existing);
    if (input.balance > 0) {
      const account = await this.account(workspaceId);
      const amount = BigInt(input.balance);
      const posted = await this.walletLedger.postEntry({
        accountId: account.id,
        entryType: WalletLedgerEntryType.credit,
        amount,
        availableDelta: amount,
        heldDelta: 0n,
        sourceType: 'points_migration',
        sourceId: userId,
        idempotencyKey: `points_migration:${userId}`,
        actorUserId: userId,
        workspaceId,
        description: 'Legacy points migration',
        reason: 'legacy_points_migration',
        metadata: { userId, migratedBalance: input.balance },
        creditGrant: {
          grantType: WalletCreditGrantType.migration,
          expiresAt: null,
          metadata: { userId },
        },
      });
      balance = posted.account.availableBalance;
      // Credit already in the ledger => this user was already migrated, even if
      // the marker row was missing. This also keeps the crash-recovery path
      // honest: a marker with no prior credit reports alreadyMigrated=false here.
      alreadyMigrated = posted.deduped;
    } else {
      // <= 0 (incl. a legacy negative/overdrawn balance): the debt is FORGIVEN —
      // the new wallet starts at 0 (the DB enforces non-negative balances). The
      // original (possibly negative) balance is kept in the migration marker
      // (migratedBalance) for audit.
      balance = await this.availableBalance(workspaceId);
    }

    return {
      userId,
      workspaceId,
      alreadyMigrated,
      balance: balance.toString(),
    };
  }

  /** Direct spend from a migrated user's wallet (FIFO grant consumption). */
  async deduct(input: DeductPointsInput) {
    const workspaceId = await this.personalWorkspaceId(input.userId);
    const account = await this.account(workspaceId);
    const amount = BigInt(input.amount);
    // postEntry enforces sufficient balance (INSUFFICIENT_WALLET_BALANCE) and
    // consumes credit grants FIFO; idempotent by the caller's key.
    const posted = await this.walletLedger.postEntry({
      accountId: account.id,
      entryType: WalletLedgerEntryType.debit,
      amount,
      availableDelta: -amount,
      heldDelta: 0n,
      sourceType: 'java_points_deduct',
      sourceId: input.idempotencyKey,
      idempotencyKey: `points_deduct:${input.idempotencyKey}`,
      actorUserId: input.userId,
      workspaceId,
      description: input.reason ?? 'Java points deduction',
      reason: 'java_points_deduct',
      metadata: { userId: input.userId, reason: input.reason ?? null },
    });
    return {
      userId: input.userId,
      deducted: amount.toString(),
      balance: posted.account.availableBalance.toString(),
      deduped: posted.deduped,
    };
  }

  /** Credit a migrated user's wallet (post-migration bonuses/refunds). */
  async grant(input: GrantPointsInput) {
    const workspaceId = await this.personalWorkspaceId(input.userId);
    const account = await this.account(workspaceId);
    const amount = BigInt(input.amount);
    const posted = await this.walletLedger.postEntry({
      accountId: account.id,
      entryType: WalletLedgerEntryType.credit,
      amount,
      availableDelta: amount,
      heldDelta: 0n,
      sourceType: 'java_points_grant',
      sourceId: input.idempotencyKey,
      idempotencyKey: `points_grant:${input.idempotencyKey}`,
      actorUserId: input.userId,
      workspaceId,
      description: input.reason ?? 'Java points grant',
      reason: 'java_points_grant',
      metadata: { userId: input.userId, reason: input.reason ?? null },
      creditGrant: {
        grantType: WalletCreditGrantType.system_grant,
        expiresAt: null,
        metadata: { userId: input.userId, reason: input.reason ?? null },
      },
    });
    return {
      userId: input.userId,
      granted: amount.toString(),
      balance: posted.account.availableBalance.toString(),
      deduped: posted.deduped,
    };
  }

  /** PG balance + migration status (Java reads this to display / route). */
  async getBalance(userId: string) {
    const ws = await this.prisma.workspace.findFirst({
      where: {
        ownerUserId: userId,
        type: WorkspaceType.personal,
        deletedAt: null,
      },
      select: { id: true },
    });
    const migration = await this.prisma.pointsMigration.findUnique({
      where: { userId },
    });
    const balance = ws ? await this.availableBalance(ws.id) : 0n;
    return {
      userId,
      migrated: Boolean(migration),
      balance: balance.toString(),
    };
  }

  // --- helpers -------------------------------------------------------------

  private async personalWorkspaceId(userId: string): Promise<string> {
    // Auto-provision the personal workspace if missing — pure legacy users who've
    // never used the new platform don't have one yet, and we don't want migration
    // to fail on that. Idempotent + advisory-locked; reuses the canonical
    // workspace + owner-member upsert.
    const workspace = await this.workspaces.ensurePersonalWorkspace({ userId });
    return workspace.id;
  }

  private async account(workspaceId: string): Promise<WalletAccount> {
    return this.prisma.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.workspace,
          ownerId: workspaceId,
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
      create: {
        ownerType: WalletOwnerType.workspace,
        ownerId: workspaceId,
        currency: WalletCurrencyType.compute_point,
        balanceKind: WalletBalanceKind.consumable,
        status: WalletAccountStatus.active,
      },
      update: {},
    });
  }

  private async availableBalance(workspaceId: string): Promise<bigint> {
    const account = await this.prisma.walletAccount.findUnique({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.workspace,
          ownerId: workspaceId,
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
      select: { id: true },
    });
    if (!account) return 0n;
    // Honest balance: drop any lapsed grants first.
    await this.walletLedger.expireLapsedGrants(account.id);
    const fresh = await this.prisma.walletAccount.findUnique({
      where: { id: account.id },
      select: { availableBalance: true },
    });
    return fresh?.availableBalance ?? 0n;
  }
}
