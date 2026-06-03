import { ConflictException, Injectable } from '@nestjs/common';
import {
  BillingLedgerAccountStatus,
  BillingLedgerAccountType,
  BillingLedgerAllocationTarget,
  BillingLedgerEntryDirection,
  BillingLedgerJournalType,
  BillingLedgerNormalBalance,
  BillingReconciliationItemStatus,
  BillingReconciliationStatus,
  BillingSettlementStatus,
  PaymentProvider,
  Prisma,
  WalletBalanceKind,
  WalletCurrencyType,
  type BillingLedgerAccount,
  type BillingLedgerEntry,
  type BillingLedgerJournal,
  type BillingOrder,
  type BillingPaymentIntent,
  type BillingPrice,
  type BillingPriceLedgerAllocation,
  type BillingRefund,
} from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../infra/db/db.module';

type LedgerAccountSpec = {
  code: string;
  name: string;
  accountType: BillingLedgerAccountType;
  normalBalance: BillingLedgerNormalBalance;
  currency: string;
  provider?: PaymentProvider | null;
  metadata?: Record<string, unknown>;
};

type LedgerEntryInput = {
  account: LedgerAccountSpec;
  direction: BillingLedgerEntryDirection;
  amountMinor: bigint;
  description?: string | null;
  metadata?: Record<string, unknown>;
};

type PostLedgerJournalInput = {
  journalType: BillingLedgerJournalType;
  sourceType: string;
  sourceId?: string | null;
  idempotencyKey: string;
  provider?: PaymentProvider | null;
  currency: string;
  orderId?: string | null;
  paymentIntentId?: string | null;
  refundId?: string | null;
  providerEventId?: string | null;
  settlementId?: string | null;
  reversalOfId?: string | null;
  description?: string | null;
  metadata?: Record<string, unknown>;
  postedAt?: Date;
  entries: LedgerEntryInput[];
};

type PostedJournal = BillingLedgerJournal & {
  entries: (BillingLedgerEntry & { account: BillingLedgerAccount })[];
};

type LedgerOrder = BillingOrder & {
  price: BillingPrice & { ledgerAllocations: BillingPriceLedgerAllocation[] };
};

@Injectable()
export class BillingLedgerService {
  constructor(private readonly prisma: PrismaService) {}

  async postJournal(input: PostLedgerJournalInput): Promise<PostedJournal> {
    return this.prisma.$transaction((tx) => this.postJournalTx(tx, input));
  }

  async postJournalTx(
    tx: Prisma.TransactionClient,
    input: PostLedgerJournalInput,
  ): Promise<PostedJournal> {
    const existing = await tx.billingLedgerJournal.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: { entries: { include: { account: true } } },
    });
    if (existing) return existing;

    const currency = normalizeCurrency(input.currency);
    if (input.entries.length < 2) {
      throw new ConflictException({
        code: 'BILLING_LEDGER_REQUIRES_DOUBLE_ENTRY',
        msg: 'Billing ledger journal requires at least two entries.',
      });
    }

    const totals = input.entries.reduce(
      (acc, entry) => {
        if (entry.amountMinor <= 0n) {
          throw new ConflictException({
            code: 'BILLING_LEDGER_AMOUNT_INVALID',
            msg: 'Billing ledger entry amount must be positive.',
          });
        }
        if (normalizeCurrency(entry.account.currency) !== currency) {
          throw new ConflictException({
            code: 'BILLING_LEDGER_CURRENCY_MISMATCH',
            msg: 'Billing ledger entry currency must match the journal currency.',
          });
        }
        if (entry.direction === BillingLedgerEntryDirection.debit) {
          acc.debit += entry.amountMinor;
        } else {
          acc.credit += entry.amountMinor;
        }
        return acc;
      },
      { debit: 0n, credit: 0n },
    );
    if (totals.debit !== totals.credit) {
      throw new ConflictException({
        code: 'BILLING_LEDGER_NOT_BALANCED',
        msg: 'Billing ledger journal debit and credit totals must match.',
      });
    }

    const accountByCode = new Map<string, BillingLedgerAccount>();
    for (const entry of input.entries) {
      const spec = entry.account;
      if (accountByCode.has(spec.code)) continue;
      const account = await tx.billingLedgerAccount.upsert({
        where: { code: spec.code },
        create: {
          code: spec.code,
          name: spec.name,
          accountType: spec.accountType,
          normalBalance: spec.normalBalance,
          status: BillingLedgerAccountStatus.active,
          currency,
          provider: spec.provider ?? null,
          metadata: (spec.metadata ?? {}) as Prisma.InputJsonValue,
        },
        update: {
          name: spec.name,
          accountType: spec.accountType,
          normalBalance: spec.normalBalance,
          status: BillingLedgerAccountStatus.active,
          currency,
          provider: spec.provider ?? null,
          metadata: (spec.metadata ?? {}) as Prisma.InputJsonValue,
          archivedAt: null,
        },
      });
      accountByCode.set(spec.code, account);
    }

    const accountIds = Array.from(accountByCode.values())
      .map((account) => account.id)
      .sort();
    for (const accountId of accountIds) {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`billing:ledger:account:${accountId}`})::bigint)
      `;
    }

    const lockedAccounts = await tx.billingLedgerAccount.findMany({
      where: { id: { in: accountIds } },
    });
    const lockedById = new Map(
      lockedAccounts.map((account) => [account.id, account]),
    );

    const journal = await tx.billingLedgerJournal.create({
      data: {
        journalNo: createJournalNo(),
        journalType: input.journalType,
        sourceType: input.sourceType,
        sourceId: input.sourceId ?? null,
        idempotencyKey: input.idempotencyKey,
        provider: input.provider ?? null,
        currency,
        orderId: input.orderId ?? null,
        paymentIntentId: input.paymentIntentId ?? null,
        refundId: input.refundId ?? null,
        providerEventId: input.providerEventId ?? null,
        settlementId: input.settlementId ?? null,
        reversalOfId: input.reversalOfId ?? null,
        totalDebitMinor: totals.debit,
        totalCreditMinor: totals.credit,
        description: input.description ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        postedAt: input.postedAt ?? new Date(),
      },
    });

    const createdEntries: (BillingLedgerEntry & {
      account: BillingLedgerAccount;
    })[] = [];
    for (const entry of input.entries) {
      const account = accountByCode.get(entry.account.code);
      if (!account)
        throw new Error(`Missing ledger account ${entry.account.code}`);
      const locked = lockedById.get(account.id);
      if (!locked)
        throw new Error(`Missing locked ledger account ${account.id}`);
      const normalDelta = normalBalanceDelta(locked, entry);
      const nextBalance = locked.balanceMinor + normalDelta;
      const created = await tx.billingLedgerEntry.create({
        data: {
          journalId: journal.id,
          accountId: locked.id,
          direction: entry.direction,
          currency,
          amountMinor: entry.amountMinor,
          balanceAfterMinor: nextBalance,
          description: entry.description ?? null,
          metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
        },
        include: { account: true },
      });
      await tx.billingLedgerAccount.update({
        where: { id: locked.id },
        data: {
          postedDebitMinor:
            entry.direction === BillingLedgerEntryDirection.debit
              ? { increment: entry.amountMinor }
              : undefined,
          postedCreditMinor:
            entry.direction === BillingLedgerEntryDirection.credit
              ? { increment: entry.amountMinor }
              : undefined,
          balanceMinor: { increment: normalDelta },
        },
      });
      locked.balanceMinor = nextBalance;
      createdEntries.push(created);
    }

    return { ...journal, entries: createdEntries };
  }

  async postPaymentCaptureTx(
    tx: Prisma.TransactionClient,
    input: {
      order: BillingOrder;
      paymentIntent?: BillingPaymentIntent | null;
      providerEventId?: string | null;
      payload?: Record<string, unknown>;
      postedAt?: Date;
    },
  ): Promise<PostedJournal> {
    const { order } = input;
    const currency = normalizeCurrency(order.currency);
    return this.postJournalTx(tx, {
      journalType: BillingLedgerJournalType.payment_capture,
      sourceType: 'billing_order',
      sourceId: order.id,
      idempotencyKey: `billing:ledger:payment_capture:${order.id}`,
      provider: order.provider,
      currency,
      orderId: order.id,
      paymentIntentId: input.paymentIntent?.id ?? null,
      providerEventId: input.providerEventId ?? null,
      description: `Payment captured for order ${order.orderNo}`,
      metadata: {
        orderNo: order.orderNo,
        orderType: order.orderType,
        subjectType: order.subjectType,
        subjectId: order.subjectId,
        providerPayload: input.payload ?? null,
      },
      postedAt: input.postedAt,
      entries: [
        {
          account: providerReceivableAccount(order.provider, currency),
          direction: BillingLedgerEntryDirection.debit,
          amountMinor: order.amountMinor,
          description: `Provider receivable ${order.orderNo}`,
        },
        {
          account: customerFundsClearingAccount(currency),
          direction: BillingLedgerEntryDirection.credit,
          amountMinor: order.amountMinor,
          description: `Customer funds clearing ${order.orderNo}`,
        },
      ],
    });
  }

  async postFulfillmentAllocationTx(
    tx: Prisma.TransactionClient,
    input: {
      order: LedgerOrder;
      walletTransactionId?: string | null;
      entitlementGrantId?: string | null;
      postedAt?: Date;
    },
  ): Promise<PostedJournal> {
    const { order } = input;
    const allocations = resolveLedgerAllocations(order);
    return this.postJournalTx(tx, {
      journalType: BillingLedgerJournalType.fulfillment_allocation,
      sourceType: 'billing_order',
      sourceId: order.id,
      idempotencyKey: `billing:ledger:fulfillment_allocation:${order.id}`,
      provider: order.provider,
      currency: normalizeCurrency(order.currency),
      orderId: order.id,
      description: `Fulfillment allocation for order ${order.orderNo}`,
      metadata: {
        orderNo: order.orderNo,
        priceId: order.priceId,
        itemId: order.itemId,
        walletTransactionId: input.walletTransactionId ?? null,
        entitlementGrantId: input.entitlementGrantId ?? null,
      },
      postedAt: input.postedAt,
      entries: [
        {
          account: customerFundsClearingAccount(order.currency),
          direction: BillingLedgerEntryDirection.debit,
          amountMinor: order.amountMinor,
          description: `Clear customer funds ${order.orderNo}`,
        },
        ...allocations.map((allocation) => ({
          account: allocation.account,
          direction: BillingLedgerEntryDirection.credit,
          amountMinor: allocation.amountMinor,
          description: allocation.description,
          metadata: allocation.metadata,
        })),
      ],
    });
  }

  async postRefundTx(
    tx: Prisma.TransactionClient,
    input: {
      refund: BillingRefund;
      order: LedgerOrder;
      paymentIntent?: BillingPaymentIntent | null;
      providerEventId?: string | null;
      payload?: Record<string, unknown>;
      postedAt?: Date;
    },
  ): Promise<PostedJournal> {
    const { order, refund } = input;
    const currency = normalizeCurrency(order.currency);
    const debitEntries = order.fulfilledAt
      ? refundFulfillmentDebitEntries(order, refund.amountMinor)
      : [
          {
            account: customerFundsClearingAccount(currency),
            direction: BillingLedgerEntryDirection.debit,
            amountMinor: refund.amountMinor,
            description: `Refund customer funds ${order.orderNo}`,
            metadata: {},
          },
        ];

    return this.postJournalTx(tx, {
      journalType: BillingLedgerJournalType.refund,
      sourceType: 'billing_refund',
      sourceId: refund.id,
      idempotencyKey: `billing:ledger:refund:${refund.id}`,
      provider: refund.provider,
      currency,
      orderId: order.id,
      paymentIntentId: input.paymentIntent?.id ?? refund.paymentIntentId,
      refundId: refund.id,
      providerEventId: input.providerEventId ?? null,
      description: `Refund ${refund.refundNo} for order ${order.orderNo}`,
      metadata: {
        refundNo: refund.refundNo,
        orderNo: order.orderNo,
        reasonCode: refund.reasonCode,
        providerPayload: input.payload ?? null,
      },
      postedAt: input.postedAt,
      entries: [
        ...debitEntries,
        {
          account: providerReceivableAccount(order.provider, currency),
          direction: BillingLedgerEntryDirection.credit,
          amountMinor: refund.amountMinor,
          description: `Reduce provider receivable ${order.orderNo}`,
        },
      ],
    });
  }

  async listAdminLedgerJournals(query: {
    cursor?: string;
    limit: number;
    journalType?: string;
    provider?: string;
    currency?: string;
  }) {
    const rows = await this.prisma.billingLedgerJournal.findMany({
      where: {
        journalType: query.journalType as BillingLedgerJournalType | undefined,
        provider: query.provider as PaymentProvider | undefined,
        currency: query.currency
          ? normalizeCurrency(query.currency)
          : undefined,
      },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: {
        entries: {
          include: { account: true },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ postedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return {
      items: items.map((journal) => ({
        id: journal.id,
        journalNo: journal.journalNo,
        journalType: journal.journalType,
        status: journal.status,
        provider: journal.provider,
        currency: journal.currency,
        totalDebitMinor: journal.totalDebitMinor.toString(),
        totalCreditMinor: journal.totalCreditMinor.toString(),
        sourceType: journal.sourceType,
        sourceId: journal.sourceId,
        orderId: journal.orderId,
        refundId: journal.refundId,
        description: journal.description,
        postedAt: journal.postedAt.toISOString(),
        entries: journal.entries.map((entry) => ({
          id: entry.id,
          direction: entry.direction,
          amountMinor: entry.amountMinor.toString(),
          balanceAfterMinor: entry.balanceAfterMinor.toString(),
          description: entry.description,
          account: {
            id: entry.account.id,
            code: entry.account.code,
            name: entry.account.name,
            accountType: entry.account.accountType,
            normalBalance: entry.account.normalBalance,
          },
        })),
      })),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async listAdminSettlements(query: {
    cursor?: string;
    limit: number;
    provider?: string;
    status?: string;
    currency?: string;
  }) {
    const rows = await this.prisma.billingSettlement.findMany({
      where: {
        provider: query.provider as PaymentProvider | undefined,
        status: query.status as BillingSettlementStatus | undefined,
        currency: query.currency
          ? normalizeCurrency(query.currency)
          : undefined,
      },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: {
        _count: {
          select: {
            ledgerJournals: true,
            reconciliationItems: true,
          },
        },
      },
      orderBy: [{ settledAt: 'desc' }, { createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return {
      items: items.map((settlement) => ({
        id: settlement.id,
        provider: settlement.provider,
        providerSettlementId: settlement.providerSettlementId,
        status: settlement.status,
        currency: settlement.currency,
        grossAmountMinor: settlement.grossAmountMinor.toString(),
        feeAmountMinor: settlement.feeAmountMinor.toString(),
        netAmountMinor: settlement.netAmountMinor.toString(),
        settledAt: settlement.settledAt?.toISOString() ?? null,
        createdAt: settlement.createdAt.toISOString(),
        updatedAt: settlement.updatedAt.toISOString(),
        journalCount: settlement._count.ledgerJournals,
        reconciliationItemCount: settlement._count.reconciliationItems,
      })),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async listAdminReconciliationRuns(query: {
    cursor?: string;
    limit: number;
    provider?: string;
    status?: string;
    currency?: string;
  }) {
    const rows = await this.prisma.billingReconciliationRun.findMany({
      where: {
        provider: query.provider as PaymentProvider | undefined,
        status: query.status as BillingReconciliationStatus | undefined,
        currency: query.currency
          ? normalizeCurrency(query.currency)
          : undefined,
      },
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: {
        items: {
          where: {
            status: { not: BillingReconciliationItemStatus.matched },
          },
          orderBy: { createdAt: 'desc' },
          take: 8,
        },
        _count: { select: { items: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return {
      items: items.map((run) => ({
        id: run.id,
        provider: run.provider,
        status: run.status,
        currency: run.currency,
        periodStart: run.periodStart.toISOString(),
        periodEnd: run.periodEnd.toISOString(),
        checkedAt: run.checkedAt?.toISOString() ?? null,
        matchedCount: run.matchedCount,
        mismatchCount: run.mismatchCount,
        missingInternalCount: run.missingInternalCount,
        missingProviderCount: run.missingProviderCount,
        error: run.error,
        createdAt: run.createdAt.toISOString(),
        updatedAt: run.updatedAt.toISOString(),
        itemCount: run._count.items,
        openItems: run.items.map((item) => ({
          id: item.id,
          status: item.status,
          issueType: item.issueType,
          orderId: item.orderId,
          paymentIntentId: item.paymentIntentId,
          providerEventId: item.providerEventId,
          settlementId: item.settlementId,
          providerReference: item.providerReference,
          currency: item.currency,
          providerAmountMinor: item.providerAmountMinor?.toString() ?? null,
          internalAmountMinor: item.internalAmountMinor?.toString() ?? null,
          differenceMinor: item.differenceMinor?.toString() ?? null,
          createdAt: item.createdAt.toISOString(),
        })),
      })),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async getAdminLedgerOverview() {
    const [accounts, journalCount, settlementCount, openReconciliationCount] =
      await Promise.all([
        this.prisma.billingLedgerAccount.findMany({
          where: { status: BillingLedgerAccountStatus.active },
          orderBy: [
            { accountType: 'asc' },
            { currency: 'asc' },
            { code: 'asc' },
          ],
          take: 100,
        }),
        this.prisma.billingLedgerJournal.count(),
        this.prisma.billingSettlement.count(),
        this.prisma.billingReconciliationRun.count({
          where: { status: BillingReconciliationStatus.running },
        }),
      ]);

    return {
      generatedAt: new Date().toISOString(),
      metrics: {
        activeAccounts: accounts.length,
        journalCount,
        settlementCount,
        openReconciliationCount,
      },
      accounts: accounts.map((account) => ({
        id: account.id,
        code: account.code,
        name: account.name,
        accountType: account.accountType,
        normalBalance: account.normalBalance,
        currency: account.currency,
        provider: account.provider,
        postedDebitMinor: account.postedDebitMinor.toString(),
        postedCreditMinor: account.postedCreditMinor.toString(),
        balanceMinor: account.balanceMinor.toString(),
        updatedAt: account.updatedAt.toISOString(),
      })),
    };
  }
}

function resolveLedgerAllocations(order: LedgerOrder): Array<{
  account: LedgerAccountSpec;
  amountMinor: bigint;
  description: string;
  metadata: Record<string, unknown>;
}> {
  const activeAllocations = order.price.ledgerAllocations
    .filter((allocation) => !allocation.archivedAt)
    .sort(
      (a, b) =>
        a.priority - b.priority ||
        a.createdAt.getTime() - b.createdAt.getTime(),
    );

  if (activeAllocations.length === 0) {
    return [inferredAllocationForPrice(order, order.amountMinor)];
  }

  const sumBps = activeAllocations.reduce(
    (sum, allocation) => sum + (allocation.allocationBps ?? 0),
    0,
  );
  const entries = activeAllocations.map((allocation) => {
    const amountMinor =
      allocation.amountMinor !== null && allocation.amountMinor !== undefined
        ? allocation.amountMinor * BigInt(order.quantity)
        : (order.amountMinor * BigInt(allocation.allocationBps ?? 0)) / 10_000n;
    return allocationEntry(order, allocation, amountMinor);
  });
  const total = entries.reduce((sum, entry) => sum + entry.amountMinor, 0n);
  const remainder = order.amountMinor - total;
  if (remainder !== 0n && sumBps === 10_000) {
    const lastBpsEntry = [...entries]
      .reverse()
      .find((entry) => entry.metadata.allocationBps);
    if (lastBpsEntry) {
      lastBpsEntry.amountMinor += remainder;
    }
  }

  const finalTotal = entries.reduce(
    (sum, entry) => sum + entry.amountMinor,
    0n,
  );
  if (
    finalTotal !== order.amountMinor ||
    entries.some((entry) => entry.amountMinor <= 0n)
  ) {
    throw new ConflictException({
      code: 'BILLING_LEDGER_ALLOCATION_UNBALANCED',
      msg: 'Billing price ledger allocations must equal the order amount.',
    });
  }
  return entries;
}

function refundFulfillmentDebitEntries(
  order: LedgerOrder,
  refundAmountMinor: bigint,
): LedgerEntryInput[] {
  const allocations = resolveLedgerAllocations(order);
  if (refundAmountMinor === order.amountMinor) {
    return allocations.map((allocation) => ({
      account: allocation.account,
      direction: BillingLedgerEntryDirection.debit,
      amountMinor: allocation.amountMinor,
      description: `Reverse ${allocation.description}`,
      metadata: {
        ...allocation.metadata,
        refundProration: 'full',
      },
    }));
  }

  let allocated = 0n;
  return allocations
    .map((allocation, index) => {
      const isLast = index === allocations.length - 1;
      const amountMinor = isLast
        ? refundAmountMinor - allocated
        : (allocation.amountMinor * refundAmountMinor) / order.amountMinor;
      allocated += amountMinor;
      return {
        account: allocation.account,
        direction: BillingLedgerEntryDirection.debit,
        amountMinor,
        description: `Reverse ${allocation.description}`,
        metadata: {
          ...allocation.metadata,
          refundProration: 'partial',
        },
      };
    })
    .filter((entry) => entry.amountMinor > 0n);
}

function allocationEntry(
  order: LedgerOrder,
  allocation: BillingPriceLedgerAllocation,
  amountMinor: bigint,
) {
  const account = accountForAllocation(order, allocation);
  return {
    account,
    amountMinor,
    description: `${allocation.target} ${order.orderNo}`,
    metadata: {
      allocationId: allocation.id,
      target: allocation.target,
      allocationBps: allocation.allocationBps,
      allocationAmountMinor: allocation.amountMinor?.toString() ?? null,
      walletCurrency: allocation.walletCurrency,
      walletBalanceKind: allocation.walletBalanceKind,
      planKey: allocation.planKey,
      revenueCategory: allocation.revenueCategory,
    },
  };
}

function inferredAllocationForPrice(order: LedgerOrder, amountMinor: bigint) {
  // Prefer the order grant snapshot (fall back to the live price) so the wallet
  // liability account routes to the same currency/kind that fulfillment credits.
  const grantCurrency =
    order.grantsWalletCurrency ?? order.price.grantsWalletCurrency;
  const grantBalanceKind =
    order.grantsWalletBalanceKind ?? order.price.grantsWalletBalanceKind;
  const grantAmount =
    order.grantsWalletAmount ?? order.price.grantsWalletAmount;
  if (grantCurrency) {
    return {
      account: walletLiabilityAccount(
        grantCurrency,
        grantBalanceKind,
        order.currency,
      ),
      amountMinor,
      description: `Wallet credit liability ${order.orderNo}`,
      metadata: {
        inferred: true,
        target: BillingLedgerAllocationTarget.wallet_credit_liability,
        walletCurrency: grantCurrency,
        walletBalanceKind: grantBalanceKind ?? WalletBalanceKind.consumable,
        walletGrantAmount: grantAmount?.toString() ?? null,
      },
    };
  }
  if (order.price.grantsPlanKey) {
    return {
      account: deferredMembershipAccount(
        order.price.grantsPlanKey,
        order.currency,
      ),
      amountMinor,
      description: `Deferred membership revenue ${order.orderNo}`,
      metadata: {
        inferred: true,
        target: BillingLedgerAllocationTarget.subscription_deferred_revenue,
        planKey: order.price.grantsPlanKey,
      },
    };
  }
  return {
    account: immediateRevenueAccount(order.price.itemId, order.currency),
    amountMinor,
    description: `Immediate billing revenue ${order.orderNo}`,
    metadata: {
      inferred: true,
      target: BillingLedgerAllocationTarget.immediate_revenue,
      productType: order.price.metadata,
    },
  };
}

function accountForAllocation(
  order: LedgerOrder,
  allocation: BillingPriceLedgerAllocation,
): LedgerAccountSpec {
  switch (allocation.target) {
    case BillingLedgerAllocationTarget.wallet_credit_liability:
      return walletLiabilityAccount(
        allocation.walletCurrency ??
          order.grantsWalletCurrency ??
          order.price.grantsWalletCurrency,
        allocation.walletBalanceKind ??
          order.grantsWalletBalanceKind ??
          order.price.grantsWalletBalanceKind ??
          WalletBalanceKind.consumable,
        order.currency,
      );
    case BillingLedgerAllocationTarget.subscription_deferred_revenue:
      return deferredMembershipAccount(
        allocation.planKey ?? order.price.grantsPlanKey,
        order.currency,
      );
    case BillingLedgerAllocationTarget.immediate_revenue:
      return immediateRevenueAccount(
        allocation.revenueCategory ??
          productRevenueCategory(order.price.metadata, order.price.itemId),
        order.currency,
      );
  }
  throw new ConflictException({
    code: 'BILLING_LEDGER_ALLOCATION_TARGET_UNSUPPORTED',
    msg: 'Billing ledger allocation target is unsupported.',
  });
}

function providerReceivableAccount(
  provider: PaymentProvider,
  currency: string,
): LedgerAccountSpec {
  const normalized = normalizeCurrency(currency);
  return {
    code: `asset.provider_receivable.${provider}.${normalized}`,
    name: `${provider} receivable ${normalized}`,
    accountType: BillingLedgerAccountType.asset,
    normalBalance: BillingLedgerNormalBalance.debit,
    currency: normalized,
    provider,
  };
}

function customerFundsClearingAccount(currency: string): LedgerAccountSpec {
  const normalized = normalizeCurrency(currency);
  return {
    code: `clearing.customer_funds.${normalized}`,
    name: `Customer funds clearing ${normalized}`,
    accountType: BillingLedgerAccountType.clearing,
    normalBalance: BillingLedgerNormalBalance.credit,
    currency: normalized,
  };
}

function walletLiabilityAccount(
  walletCurrency: WalletCurrencyType | null | undefined,
  walletBalanceKind: WalletBalanceKind | null | undefined,
  currency: string,
): LedgerAccountSpec {
  if (!walletCurrency) {
    throw new ConflictException({
      code: 'BILLING_LEDGER_WALLET_CURRENCY_REQUIRED',
      msg: 'Wallet liability allocation requires a wallet currency.',
    });
  }
  const normalizedBalanceKind =
    walletBalanceKind ?? WalletBalanceKind.consumable;
  if (normalizedBalanceKind !== WalletBalanceKind.consumable) {
    throw new ConflictException({
      code: 'BILLING_LEDGER_WITHDRAWABLE_GRANT_NOT_SELLABLE',
      msg: 'Withdrawable community points cannot be granted by checkout products or coupons.',
    });
  }
  const normalized = normalizeCurrency(currency);
  return {
    code: `liability.wallet_credit.${walletCurrency}.${normalizedBalanceKind}.${normalized}`,
    name: `${walletCurrency} ${normalizedBalanceKind} wallet credit liability ${normalized}`,
    accountType: BillingLedgerAccountType.liability,
    normalBalance: BillingLedgerNormalBalance.credit,
    currency: normalized,
    metadata: { walletCurrency, walletBalanceKind: normalizedBalanceKind },
  };
}

function deferredMembershipAccount(
  planKey: string | null | undefined,
  currency: string,
): LedgerAccountSpec {
  if (!planKey) {
    throw new ConflictException({
      code: 'BILLING_LEDGER_PLAN_KEY_REQUIRED',
      msg: 'Deferred membership allocation requires a plan key.',
    });
  }
  const normalized = normalizeCurrency(currency);
  return {
    code: `liability.deferred_membership.${safeCode(planKey)}.${normalized}`,
    name: `${planKey} deferred membership revenue ${normalized}`,
    accountType: BillingLedgerAccountType.liability,
    normalBalance: BillingLedgerNormalBalance.credit,
    currency: normalized,
    metadata: { planKey },
  };
}

function immediateRevenueAccount(
  category: string,
  currency: string,
): LedgerAccountSpec {
  const normalized = normalizeCurrency(currency);
  return {
    code: `revenue.billing.${safeCode(category)}.${normalized}`,
    name: `${category} billing revenue ${normalized}`,
    accountType: BillingLedgerAccountType.revenue,
    normalBalance: BillingLedgerNormalBalance.credit,
    currency: normalized,
    metadata: { category },
  };
}

function normalBalanceDelta(
  account: BillingLedgerAccount,
  entry: LedgerEntryInput,
): bigint {
  const sameAsNormal = account.normalBalance === entry.direction;
  return sameAsNormal ? entry.amountMinor : -entry.amountMinor;
}

function normalizeCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) {
    throw new ConflictException({
      code: 'BILLING_LEDGER_CURRENCY_INVALID',
      msg: 'Billing ledger currency must be a 3-letter ISO code.',
    });
  }
  return normalized;
}

function productRevenueCategory(
  metadata: Prisma.JsonValue,
  fallback: string,
): string {
  const objectMetadata = metadata as Record<string, unknown> | null;
  if (
    objectMetadata &&
    typeof objectMetadata === 'object' &&
    !Array.isArray(objectMetadata) &&
    typeof objectMetadata.revenueCategory === 'string'
  ) {
    return objectMetadata.revenueCategory;
  }
  return fallback;
}

function safeCode(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

function createJournalNo(): string {
  const compactDate = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return `BLJ-${compactDate}-${randomUUID().slice(0, 12)}`;
}
