import { ensurePromotionalWalletAccount } from './promotional-wallet-account';
import { randomInt, randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  GoneException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  VoucherGrantType,
  VoucherStatus,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  type Voucher,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { WalletLedgerService } from '../workspaces';
import { promoCreditExpiresAt } from './credit-policy';
import type {
  GenerateVouchersInput,
  ListVouchersQuery,
  RedeemVoucherInput,
} from './dto';

// Human-readable, unambiguous alphabet (no I/L/O/0/1).
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

function isUniqueViolation(err: unknown): boolean {
  return (
    err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002'
  );
}

/**
 * Redemption vouchers (兑换券). A voucher is redeemed for a DIRECT grant — today,
 * compute_point credits to the redeemer's default-workspace wallet. Distinct
 * from BillingPromotion (which discounts an order). Redeem is financial-grade:
 *
 *   1. Claim — flip active->redeemed with a row-locked conditional update; the
 *      loser of a concurrent redeem gets a precise "already redeemed" error.
 *   2. Credit — wallet postEntry keyed by voucher id, so a retry or a same-user
 *      re-redeem (recovering a crash between claim and credit) credits once.
 */
@Injectable()
export class VoucherService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly walletLedger: WalletLedgerService,
  ) {}

  // --- admin: generate a batch ---------------------------------------------

  async generateVouchers(adminId: string, input: GenerateVouchersInput) {
    if (input.grantType === 'compute_credits' && !input.computeCreditAmount) {
      throw new BadRequestException({
        code: 'VOUCHER_AMOUNT_REQUIRED',
        msg: 'Compute-credit vouchers require a positive credit amount.',
      });
    }
    const batchId = randomUUID();
    const prefix = (input.codePrefix ?? 'FIZZ').toUpperCase();

    // Mint `count` codes; retry the whole batch on the (practically impossible)
    // unique collision — 12 chars over a 31-symbol alphabet is ~2^59 of entropy.
    for (let attempt = 0; attempt < 5; attempt++) {
      const data = Array.from({ length: input.count }, () => ({
        code: this.makeCode(prefix),
        batchId,
        grantType: input.grantType as VoucherGrantType,
        computeCreditAmount: input.computeCreditAmount ?? null,
        expiresAt: input.expiresAt ?? null,
        note: input.note ?? null,
        createdById: adminId,
      }));
      try {
        return await this.prisma.$transaction(async (tx) => {
          await tx.voucher.createMany({ data });
          const created = await tx.voucher.findMany({
            where: { batchId },
            orderBy: { createdAt: 'asc' },
          });
          return {
            batchId,
            count: created.length,
            vouchers: created.map((v) => this.voucherDto(v)),
          };
        });
      } catch (err) {
        if (isUniqueViolation(err) && attempt < 4) continue;
        throw err;
      }
    }
    throw new ConflictException({
      code: 'VOUCHER_CODE_COLLISION',
      msg: 'Could not mint unique voucher codes; please try again.',
    });
  }

  private makeCode(prefix: string): string {
    const groups = Array.from({ length: 3 }, () =>
      Array.from(
        { length: 4 },
        () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)],
      ).join(''),
    );
    return [prefix, ...groups].join('-');
  }

  // --- admin: list ----------------------------------------------------------

  async listVouchers(query: ListVouchersQuery) {
    const where: Prisma.VoucherWhereInput = {};
    if (query.status) where.status = query.status as VoucherStatus;
    if (query.batchId) where.batchId = query.batchId;
    if (query.q) where.code = { contains: query.q.trim().toUpperCase() };
    const rows = await this.prisma.voucher.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 500,
    });
    return { items: rows.map((v) => this.voucherDto(v)) };
  }

  // --- user: redeem ---------------------------------------------------------

  async redeemVoucher(user: AuthUser, input: RedeemVoucherInput) {
    const code = input.code.trim().toUpperCase();
    const userId = String(user.userId);
    const voucher = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM vouchers WHERE code=${code} FOR UPDATE`;
      const current = await tx.voucher.findUnique({ where: { code } });
      if (!current) {
        throw new NotFoundException({
          code: 'VOUCHER_NOT_FOUND',
          msg: 'Redemption code is invalid.',
        });
      }
      if (current.status !== VoucherStatus.active) return current;
      const [{ now }] = await tx.$queryRaw<
        { now: Date }[]
      >`SELECT clock_timestamp() AS now`;
      if (current.expiresAt && current.expiresAt <= now) {
        return tx.voucher.update({
          where: { id: current.id },
          data: { status: VoucherStatus.expired },
        });
      }
      if (current.grantType !== VoucherGrantType.compute_credits) {
        throw new BadRequestException({
          code: 'VOUCHER_GRANT_TYPE_UNSUPPORTED',
          msg: 'Unsupported voucher grant type.',
        });
      }
      const workspace = await tx.workspace.findFirst({
        where: { defaultForUserId: userId, deletedAt: null },
        select: { id: true },
      });
      if (!workspace) {
        throw new ConflictException({
          code: 'DEFAULT_WORKSPACE_MISSING',
          msg: 'No default workspace to receive the credits yet.',
        });
      }
      return tx.voucher.update({
        where: { id: current.id },
        data: {
          status: VoucherStatus.redeemed,
          redeemedByUserId: userId,
          redeemedWorkspaceId: workspace.id,
          redeemedAt: now,
        },
      });
    });
    if (voucher.status === VoucherStatus.expired) {
      throw new GoneException({
        code: 'VOUCHER_EXPIRED',
        msg: 'This redemption code has expired.',
      });
    }
    if (voucher.status === VoucherStatus.void) {
      throw new GoneException({
        code: 'VOUCHER_VOID',
        msg: 'This redemption code is no longer valid.',
      });
    }
    if (
      voucher.status !== VoucherStatus.redeemed ||
      voucher.redeemedByUserId !== userId
    ) {
      throw new ConflictException({
        code: 'VOUCHER_ALREADY_REDEEMED',
        msg: 'This redemption code has already been used.',
      });
    }
    if (!voucher.redeemedWorkspaceId) {
      throw new ConflictException({
        code: 'VOUCHER_REDEMPTION_WORKSPACE_MISSING',
        msg: 'The recorded redemption has no destination workspace.',
      });
    }
    if (voucher.grantType !== VoucherGrantType.compute_credits) {
      throw new BadRequestException({
        code: 'VOUCHER_GRANT_TYPE_UNSUPPORTED',
        msg: 'Unsupported voucher grant type.',
      });
    }

    // Credit. Idempotent by voucher id: a retry / same-user re-redeem (e.g. after
    // a crash between claim and credit) credits exactly once (postEntry dedupes).
    const targetWorkspaceId = voucher.redeemedWorkspaceId;
    const amount = BigInt(voucher.computeCreditAmount ?? 0);
    const account = await ensurePromotionalWalletAccount(
      this.prisma,
      targetWorkspaceId,
    );
    const posted = await this.walletLedger.postEntry({
      accountId: account.id,
      entryType: WalletLedgerEntryType.adjustment,
      amount,
      availableDelta: amount,
      heldDelta: 0n,
      sourceType: 'voucher_redeem',
      sourceId: voucher.id,
      idempotencyKey: `voucher_redeem:${voucher.id}`,
      actorUserId: userId,
      workspaceId: targetWorkspaceId,
      description: `Voucher ${voucher.code} redeemed`,
      reason: 'voucher_compute_point_credit',
      metadata: {
        voucherId: voucher.id,
        voucherCode: voucher.code,
        batchId: voucher.batchId,
      },
      creditGrant: {
        grantType: WalletCreditGrantType.campaign_reward,
        expiresAt: promoCreditExpiresAt(),
        metadata: { voucherId: voucher.id, voucherCode: voucher.code },
      },
    });

    return {
      granted: {
        grantType: 'compute_credits' as const,
        currency: WalletCurrencyType.compute_point,
        amount: amount.toString(),
        workspaceId: targetWorkspaceId,
      },
      alreadyRedeemed: posted.deduped,
    };
  }

  private voucherDto(v: Voucher) {
    return {
      id: v.id,
      code: v.code,
      batchId: v.batchId,
      grantType: v.grantType,
      computeCreditAmount: v.computeCreditAmount,
      status: v.status,
      expiresAt: v.expiresAt?.toISOString() ?? null,
      redeemedByUserId: v.redeemedByUserId,
      redeemedWorkspaceId: v.redeemedWorkspaceId,
      redeemedAt: v.redeemedAt?.toISOString() ?? null,
      note: v.note,
      createdAt: v.createdAt.toISOString(),
    };
  }
}
