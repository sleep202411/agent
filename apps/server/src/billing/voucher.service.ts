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
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
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
        await this.prisma.voucher.createMany({ data });
        const created = await this.prisma.voucher.findMany({
          where: { batchId },
          orderBy: { createdAt: 'asc' },
        });
        return {
          batchId,
          count: created.length,
          vouchers: created.map((v) => this.voucherDto(v)),
        };
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
    const now = new Date();

    const voucher = await this.prisma.voucher.findUnique({ where: { code } });
    if (!voucher) {
      throw new NotFoundException({
        code: 'VOUCHER_NOT_FOUND',
        msg: 'Redemption code is invalid.',
      });
    }

    // Lazy expiry: an active code past its window flips to expired on touch.
    if (
      voucher.status === VoucherStatus.active &&
      voucher.expiresAt &&
      voucher.expiresAt <= now
    ) {
      await this.prisma.voucher.updateMany({
        where: { id: voucher.id, status: VoucherStatus.active },
        data: { status: VoucherStatus.expired },
      });
      throw new GoneException({
        code: 'VOUCHER_EXPIRED',
        msg: 'This redemption code has expired.',
      });
    }
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
      voucher.status === VoucherStatus.redeemed &&
      voucher.redeemedByUserId !== userId
    ) {
      throw new ConflictException({
        code: 'VOUCHER_ALREADY_REDEEMED',
        msg: 'This redemption code has already been used.',
      });
    }

    // compute_point is workspace-owned -> credits land in the redeemer's defaultWorkspace
    // workspace pot (matches admin grants / the wallet the user reads + spends).
    const defaultWorkspace = await this.prisma.workspace.findFirst({
      where: {
        defaultForUserId: userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!defaultWorkspace) {
      throw new ConflictException({
        code: 'DEFAULT_WORKSPACE_MISSING',
        msg: 'No default workspace to receive the credits yet.',
      });
    }

    // Claim: flip active->redeemed exactly once. The WHERE status=active guard
    // makes this a row-locked atomic claim; a concurrent redeemer gets count=0.
    if (voucher.status === VoucherStatus.active) {
      const claim = await this.prisma.voucher.updateMany({
        where: { id: voucher.id, status: VoucherStatus.active },
        data: {
          status: VoucherStatus.redeemed,
          redeemedByUserId: userId,
          redeemedWorkspaceId: defaultWorkspace.id,
          redeemedAt: now,
        },
      });
      if (claim.count === 0) {
        const fresh = await this.prisma.voucher.findUnique({
          where: { id: voucher.id },
          select: { redeemedByUserId: true },
        });
        if (fresh?.redeemedByUserId && fresh.redeemedByUserId !== userId) {
          throw new ConflictException({
            code: 'VOUCHER_ALREADY_REDEEMED',
            msg: 'This redemption code has already been used.',
          });
        }
        // else: a concurrent call by THIS user won the claim -> fall through to
        // the idempotent credit (recovery path).
      }
    }

    if (voucher.grantType !== VoucherGrantType.compute_credits) {
      throw new BadRequestException({
        code: 'VOUCHER_GRANT_TYPE_UNSUPPORTED',
        msg: 'Unsupported voucher grant type.',
      });
    }

    // Credit. Idempotent by voucher id: a retry / same-user re-redeem (e.g. after
    // a crash between claim and credit) credits exactly once (postEntry dedupes).
    const targetWorkspaceId =
      voucher.redeemedWorkspaceId ?? defaultWorkspace.id;
    const amount = BigInt(voucher.computeCreditAmount ?? 0);
    const account = await this.prisma.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.workspace,
          ownerId: targetWorkspaceId,
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
      create: {
        ownerType: WalletOwnerType.workspace,
        ownerId: targetWorkspaceId,
        currency: WalletCurrencyType.compute_point,
        balanceKind: WalletBalanceKind.consumable,
        status: WalletAccountStatus.active,
      },
      update: {},
    });
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
