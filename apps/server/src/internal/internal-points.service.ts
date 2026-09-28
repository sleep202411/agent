import { ensureWalletAccount } from '../workspaces/wallet-account-admission';
import { BadRequestException, Injectable } from '@nestjs/common';
import {
  Prisma,
  WalletBalanceKind,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  type WalletAccount,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { WalletLedgerService, WorkspacesService } from '../workspaces';
import type {
  CommunityGrantInput,
  DeductPointsInput,
  GrantPointsInput,
  MigratePointsInput,
} from './internal-points.dto';

/** Sanity ceiling per grant call — a runaway caller can't mint an outsized
 *  balance in one shot. Campaign totals are the caller's responsibility. */
const COMMUNITY_GRANT_MAX_AMOUNT = 50_000;

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * The Java <-> PG points bridge for the lazy per-user migration. Java keeps the
 * old MySQL balance for un-migrated users; it calls `migrate` (once per user) to
 * move that user onto the PG compute_point wallet, then routes that user's
 * deduct/grant here. Everything maps to the user's default-workspace pot
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
    const existing = await this.prisma.pointsMigration.findUnique({
      where: { userId },
    });
    let accepted = existing;
    let alreadyMigrated = Boolean(existing);
    if (!accepted) {
      const workspaceId = await this.defaultWorkspaceId(userId);
      try {
        accepted = await this.prisma.pointsMigration.create({
          data: { userId, migratedBalance: input.balance, workspaceId },
        });
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
        accepted = await this.prisma.pointsMigration.findUnique({
          where: { userId },
        });
        if (!accepted) throw err;
        alreadyMigrated = true;
      }
    }
    const workspaceId = accepted.workspaceId;
    const migratedBalance = accepted.migratedBalance;

    // Credit the ingested balance idempotently (keyed by user). A re-call (or a
    // crash between marker-create and credit) credits exactly once; a different
    // balance on a later call dedupes to the first.
    // `alreadyMigrated` must reflect whether the migration CREDIT was already
    // applied (the ledger is the source of truth), not merely whether the marker
    // row exists — the two can drift (e.g. the marker is missing but the per-user
    // credit is already in the ledger), which previously made this flag lie:
    // alreadyMigrated=false while the balance was already the migrated one.
    let balance: bigint;
    if (migratedBalance > 0) {
      const account = await this.account(workspaceId);
      const amount = BigInt(migratedBalance);
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
        metadata: { userId, migratedBalance },
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

  /** Whether this user has already been migrated onto the PG compute_point
   *  wallet (the points migration marker exists). Drives the studio entry point. */
  async isMigrated(userId: string): Promise<boolean> {
    const marker = await this.prisma.pointsMigration.findUnique({
      where: { userId },
      select: { userId: true },
    });
    return marker !== null;
  }

  /** Direct spend from a migrated user's wallet (FIFO grant consumption). */
  async deduct(input: DeductPointsInput) {
    const workspaceId = await this.defaultWorkspaceId(input.userId);
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
    // Java may still call the registration bonus bridge after its own legacy
    // balance grant is disabled. A successful no-op keeps registration open and
    // prevents Java's error fallback from crediting the legacy balance instead.
    if (
      process.env.REGISTRATION_COMPUTE_BONUS_PAUSED === 'true' &&
      (input.reason?.trim().toLowerCase() === 'register_bonus' ||
        input.idempotencyKey.trim().toLowerCase().startsWith('register_bonus:'))
    ) {
      const current = await this.getBalance(input.userId);
      return {
        userId: input.userId,
        granted: '0',
        balance: current.balance,
        deduped: true,
      };
    }

    const workspaceId = await this.defaultWorkspaceId(input.userId);
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

  /** Campaign community-point grant (promo codes redeemed on the Java side).
   *  community_point is user-owned — never a workspace pot — so this posts to
   *  the user's own consumable account; no default-workspace provisioning. */
  async grantCommunity(input: CommunityGrantInput) {
    if (input.amount > COMMUNITY_GRANT_MAX_AMOUNT) {
      throw new BadRequestException({
        code: 'AMOUNT_EXCEEDS_CAP',
        msg: `Single grant capped at ${COMMUNITY_GRANT_MAX_AMOUNT} community points.`,
      });
    }
    const account = await this.communityAccount(input.userId);
    const amount = BigInt(input.amount);
    const posted = await this.walletLedger.postEntry({
      accountId: account.id,
      entryType: WalletLedgerEntryType.credit,
      amount,
      availableDelta: amount,
      heldDelta: 0n,
      sourceType: 'java_community_grant',
      sourceId: input.idempotencyKey,
      // The userId is baked into the server-side key so one caller key can never
      // dedupe across users: the ledger's idempotency_key is GLOBALLY unique, and
      // a cross-user hit would report success while crediting nobody.
      idempotencyKey: `community_grant:${input.userId}:${input.idempotencyKey}`,
      actorUserId: input.userId,
      workspaceId: null,
      description: input.reason ?? 'Java community-point grant',
      reason: 'java_community_grant',
      metadata: { userId: input.userId, reason: input.reason ?? null },
      creditGrant: {
        grantType: WalletCreditGrantType.system_grant,
        expiresAt: input.expiresAt ?? null,
        metadata: { userId: input.userId, reason: input.reason ?? null },
      },
    });
    return {
      userId: input.userId,
      // Ledger truth, not the request echo: on a deduped retry the amount that
      // actually posted may differ from what this call asked for.
      granted: posted.entry.amount.toString(),
      balance: posted.account.availableBalance.toString(),
      deduped: posted.deduped,
    };
  }

  /** PG balance + migration status (Java reads this to display / route). */
  async getBalance(userId: string) {
    const ws = await this.prisma.workspace.findFirst({
      where: {
        defaultForUserId: userId,
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

  private async defaultWorkspaceId(userId: string): Promise<string> {
    // Auto-provision the default workspace if missing — pure legacy users who've
    // never used the new platform don't have one yet, and we don't want migration
    // to fail on that. Idempotent + advisory-locked; reuses the canonical
    // workspace + owner-member upsert.
    const workspace = await this.workspaces.ensureDefaultWorkspace({ userId });
    return workspace.id;
  }

  private async account(workspaceId: string): Promise<WalletAccount> {
    return ensureWalletAccount(this.prisma, {
      ownerType: WalletOwnerType.workspace,
      ownerId: workspaceId,
      currency: WalletCurrencyType.compute_point,
      balanceKind: WalletBalanceKind.consumable,
    });
  }

  private async communityAccount(userId: string): Promise<WalletAccount> {
    return ensureWalletAccount(this.prisma, {
      ownerType: WalletOwnerType.user,
      ownerId: userId,
      currency: WalletCurrencyType.community_point,
      balanceKind: WalletBalanceKind.consumable,
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
