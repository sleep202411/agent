import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  WalletBalanceKind,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  WorkspaceMemberRole,
} from '@prisma/client';
import {
  CONTENT_REVIEW_MAX_DURATION_SECONDS,
  contentReviewCreditsForDurationSeconds,
} from '@repo/shared';
import { PrismaService } from '../infra/db/db.module';
import { WalletLedgerService, WorkspacePermissionService } from '../workspaces';

const SOURCE = 'content_review';

@Injectable()
export class ContentReviewBillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: WalletLedgerService,
    private readonly workspacePermissions: WorkspacePermissionService,
  ) {}

  async hold(
    userId: string,
    workspaceId: string | undefined,
    durationSeconds: number,
    chargeId: string = randomUUID(),
  ): Promise<{ id: string; credits: number }> {
    const workspace = requireWorkspaceId(workspaceId);
    await this.workspacePermissions.requireWorkspaceRole(
      userId,
      workspace,
      WorkspaceMemberRole.editor,
    );
    if (
      !Number.isInteger(durationSeconds) ||
      durationSeconds < 1 ||
      durationSeconds > CONTENT_REVIEW_MAX_DURATION_SECONDS
    ) {
      throw new BadRequestException({
        code: 'CONTENT_REVIEW_DURATION_INVALID',
        msg: 'Video duration must be between 1 second and 3 hours.',
      });
    }

    const credits = contentReviewCreditsForDurationSeconds(durationSeconds);
    const amount = BigInt(credits);
    const accounts = await this.ledger.ensureDefaultAccounts(
      WalletOwnerType.workspace,
      workspace,
    );
    const account = accounts.find(
      (row) =>
        row.currency === WalletCurrencyType.compute_point &&
        row.balanceKind === WalletBalanceKind.consumable,
    );
    if (!account) {
      throw new ConflictException({
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        msg: 'Not enough compute points. Recharge and try again.',
        requiredAmount: amount.toString(),
        availableBalance: '0',
      });
    }

    await this.ledger.expireLapsedGrants(account.id);
    const fresh = await this.prisma.walletAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    if (fresh.availableBalance < amount) {
      throw new ConflictException({
        code: 'INSUFFICIENT_COMPUTE_POINTS',
        msg: 'Not enough compute points. Recharge and try again.',
        requiredAmount: amount.toString(),
        availableBalance: fresh.availableBalance.toString(),
      });
    }

    try {
      await this.ledger.postEntry({
        accountId: fresh.id,
        entryType: WalletLedgerEntryType.debit,
        amount,
        availableDelta: -amount,
        heldDelta: 0n,
        reason: SOURCE,
        sourceType: SOURCE,
        sourceId: chargeId,
        idempotencyKey: debitKey(chargeId),
        actorUserId: userId,
        workspaceId: workspace,
        description: `AI content review ${credits} compute points`,
        metadata: { durationSeconds, credits },
      });
    } catch (error) {
      remapWalletShortage(error, amount);
      throw error;
    }

    return { id: chargeId, credits };
  }

  async settle(
    userId: string,
    workspaceId: string | undefined,
    chargeId: string,
  ): Promise<{ id: string; credits: number }> {
    const debit = await this.requireDebit(userId, workspaceId, chargeId);
    const refunded = await this.prisma.walletTransaction.findUnique({
      where: { idempotencyKey: refundKey(chargeId) },
    });
    if (refunded) {
      throw new ConflictException({
        code: 'CONTENT_REVIEW_CHARGE_RELEASED',
        msg: 'This content-review charge was already released.',
      });
    }
    return { id: chargeId, credits: creditsFromDebit(debit) };
  }

  async release(
    userId: string,
    workspaceId: string | undefined,
    chargeId: string,
  ): Promise<{ id: string; credits: number }> {
    const debit = await this.findDebit(userId, workspaceId, chargeId);
    if (!debit) {
      return { id: chargeId, credits: 0 };
    }
    const credits = creditsFromDebit(debit);
    const amount = BigInt(credits);
    if (amount <= 0n) {
      return { id: chargeId, credits: 0 };
    }
    const accountId = await this.computeAccountId(
      debit.workspaceId ?? workspaceId,
    );
    await this.ledger.postEntry({
      accountId,
      entryType: WalletLedgerEntryType.refund,
      amount,
      availableDelta: amount,
      heldDelta: 0n,
      reason: `${SOURCE}_refund`,
      sourceType: SOURCE,
      sourceId: chargeId,
      idempotencyKey: refundKey(chargeId),
      actorUserId: userId,
      workspaceId: debit.workspaceId ?? workspaceId ?? null,
      description: `AI content review refund ${credits} compute points`,
      creditGrant: { grantType: WalletCreditGrantType.refund_return },
      metadata: { credits, refundOf: debitKey(chargeId) },
    });
    return { id: chargeId, credits };
  }

  private async findDebit(
    userId: string,
    workspaceId: string | undefined,
    chargeId: string,
  ) {
    const workspace = requireWorkspaceId(workspaceId);
    await this.workspacePermissions.requireWorkspaceRole(
      userId,
      workspace,
      WorkspaceMemberRole.editor,
    );
    const debit = await this.prisma.walletTransaction.findUnique({
      where: { idempotencyKey: debitKey(chargeId) },
      include: { entries: true },
    });
    if (!debit || debit.sourceType !== SOURCE || debit.sourceId !== chargeId) {
      return null;
    }
    if (debit.actorUserId !== userId || debit.workspaceId !== workspace) {
      throw new ForbiddenException({
        code: 'CONTENT_REVIEW_CHARGE_FORBIDDEN',
        msg: 'You cannot settle this content-review charge.',
      });
    }
    return debit;
  }

  private async requireDebit(
    userId: string,
    workspaceId: string | undefined,
    chargeId: string,
  ) {
    const debit = await this.findDebit(userId, workspaceId, chargeId);
    if (!debit) {
      throw new NotFoundException({
        code: 'CONTENT_REVIEW_CHARGE_NOT_FOUND',
        msg: 'Content-review charge not found.',
      });
    }
    return debit;
  }

  private async computeAccountId(workspaceId: string | null | undefined) {
    const workspace = requireWorkspaceId(workspaceId);
    const accounts = await this.ledger.ensureDefaultAccounts(
      WalletOwnerType.workspace,
      workspace,
    );
    const account = accounts.find(
      (row) =>
        row.currency === WalletCurrencyType.compute_point &&
        row.balanceKind === WalletBalanceKind.consumable,
    );
    if (!account) {
      throw new NotFoundException({
        code: 'CONTENT_REVIEW_WALLET_NOT_FOUND',
        msg: 'Workspace compute wallet not found.',
      });
    }
    return account.id;
  }
}

function debitKey(chargeId: string) {
  return `${SOURCE}:debit:${chargeId}`;
}

function refundKey(chargeId: string) {
  return `${SOURCE}:refund:${chargeId}`;
}

function requireWorkspaceId(workspaceId: string | undefined | null): string {
  if (!workspaceId?.trim()) {
    throw new BadRequestException({
      code: 'WORKSPACE_REQUIRED',
      msg: 'A workspace is required to fund this review.',
    });
  }
  return workspaceId.trim();
}

function creditsFromDebit(debit: {
  entries: Array<{ amount: bigint }>;
  metadata: unknown;
}): number {
  const meta =
    debit.metadata && typeof debit.metadata === 'object'
      ? (debit.metadata as { credits?: unknown })
      : null;
  if (typeof meta?.credits === 'number' && Number.isFinite(meta.credits)) {
    return meta.credits;
  }
  return Number(debit.entries[0]?.amount ?? 0n);
}

function remapWalletShortage(error: unknown, amount: bigint): void {
  if (!(error instanceof ConflictException)) return;
  const body = error.getResponse();
  const code =
    body && typeof body === 'object' && 'code' in body
      ? String((body as { code?: unknown }).code)
      : '';
  if (
    code === 'INSUFFICIENT_WALLET_BALANCE' ||
    code === 'INSUFFICIENT_UNEXPIRED_WALLET_GRANTS'
  ) {
    throw new ConflictException({
      code:
        code === 'INSUFFICIENT_UNEXPIRED_WALLET_GRANTS'
          ? 'INSUFFICIENT_UNEXPIRED_COMPUTE_POINTS'
          : 'INSUFFICIENT_COMPUTE_POINTS',
      msg: 'Not enough compute points. Recharge and try again.',
      requiredAmount: amount.toString(),
    });
  }
}
