import { ConflictException, Injectable } from '@nestjs/common';
import {
  Prisma,
  WalletAccountStatus,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  WalletTransactionStatus,
  type WalletAccount,
  type WalletLedgerEntry,
  type WalletTransaction,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';

const DEFAULT_CURRENCIES = [
  WalletCurrencyType.bubble,
  WalletCurrencyType.community_point,
  WalletCurrencyType.revenue_credit,
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
}

export interface PostedWalletEntry {
  transaction: WalletTransaction;
  entry: WalletLedgerEntry;
  account: WalletAccount;
}

@Injectable()
export class WalletLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async ensureDefaultAccounts(
    ownerType: WalletOwnerType,
    ownerId: string,
  ): Promise<WalletAccount[]> {
    const accounts: WalletAccount[] = [];
    for (const currency of DEFAULT_CURRENCIES) {
      accounts.push(
        await this.prisma.walletAccount.upsert({
          where: {
            ownerType_ownerId_currency: {
              ownerType,
              ownerId,
              currency,
            },
          },
          create: {
            ownerType,
            ownerId,
            currency,
            status: WalletAccountStatus.active,
          },
          update: {},
        }),
      );
    }
    return accounts;
  }

  async postEntry(input: PostWalletEntryInput): Promise<PostedWalletEntry> {
    if (input.amount <= 0n) {
      throw new ConflictException({
        code: 'INVALID_LEDGER_AMOUNT',
        msg: 'Ledger amount must be positive.',
      });
    }

    return this.prisma.$transaction(async (tx) => {
      const existing = await tx.walletTransaction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { entries: true },
      });
      if (existing?.entries[0]) {
        const account = await tx.walletAccount.findUniqueOrThrow({
          where: { id: existing.entries[0].accountId },
        });
        return {
          transaction: existing,
          entry: existing.entries[0],
          account,
        };
      }

      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${input.accountId}`})::bigint)
      `;

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
          amount: input.amount,
          availableDelta: input.availableDelta,
          heldDelta: input.heldDelta,
          availableBalanceAfter: nextAvailable,
          heldBalanceAfter: nextHeld,
          reason: input.reason,
        },
      });

      const updated = await tx.walletAccount.update({
        where: { id: account.id },
        data: {
          availableBalance: nextAvailable,
          heldBalance: nextHeld,
          version: { increment: 1 },
        },
      });

      return { transaction, entry, account: updated };
    });
  }
}
