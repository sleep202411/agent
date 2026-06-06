import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  BillingProviderBindingStatus,
  BillingRefundStatus,
  BillingOrderStatus,
  BillingOrderType,
  BillingPriceInterval,
  BillingPromotionDurationType,
  BillingPromotionRedemptionStatus,
  BillingPromotionStatus,
  BillingProductType,
  BillingSubjectType,
  BillingSubscriptionStatus,
  EntitlementGrantStatus,
  PaymentIntentKind,
  PaymentIntentStatus,
  PaymentProvider,
  PaymentProviderEventStatus,
  Prisma,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  WalletTransactionStatus,
  WorkspaceMemberRole,
  type BillingOrder,
  type BillingPaymentIntent,
  type BillingPaymentProviderEvent,
  type BillingPrice,
  type BillingCatalogItem,
  type BillingLedgerJournal,
  type BillingProviderPriceBinding,
  type BillingPriceLedgerAllocation,
  type BillingPromotion,
  type BillingPromotionProviderBinding,
  type BillingRefund,
  type WalletAccount,
} from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import type {
  CreateBillingCheckoutInput,
  CreateCustomRechargeInput,
  CreateAdminBillingPriceInput,
  CreateAdminBillingPromotionInput,
  CreateAdminBillingRefundInput,
  ListAdminBillingOrdersQuery,
  ListAdminBillingProviderEventsQuery,
  ListAdminBillingPricesQuery,
  ListAdminBillingPromotionsQuery,
  ListAdminBillingRefundsQuery,
  ListBillingPricesQuery,
  QuoteAdminBillingRefundInput,
  UpdateAdminBillingPriceInput,
  UpdateAdminBillingPromotionInput,
  UpsertAdminBillingProviderBindingInput,
  UpsertAdminBillingPromotionProviderBindingInput,
} from './dto';
import { PaymentProviderRegistry } from './payment-provider-registry.service';
import type {
  CreatePaymentIntentResult,
  CreateProviderRefundResult,
  HostedCheckoutResult,
} from './providers/payment-provider';
import { BillingLedgerService } from './billing-ledger.service';

type PriceWithItem = BillingPrice & { item: BillingCatalogItem };
type PriceWithProviderBindings = PriceWithItem & {
  providerBindings: BillingProviderPriceBinding[];
};
type OrderWithPrice = BillingOrder & { price: BillingPrice };
type OrderWithLedgerPrice = BillingOrder & {
  price: BillingPrice & { ledgerAllocations: BillingPriceLedgerAllocation[] };
};
type AdminOrderWithRelations = BillingOrder & {
  item: BillingCatalogItem;
  price: BillingPrice;
  paymentIntents: BillingPaymentIntent[];
  refunds: BillingRefund[];
};
type AdminRefundWithRelations = BillingRefund & {
  order: BillingOrder & { item: BillingCatalogItem };
  paymentIntent: BillingPaymentIntent | null;
};
type AdminProviderEventWithRelations = BillingPaymentProviderEvent & {
  paymentIntent: (BillingPaymentIntent & { order: BillingOrder }) | null;
  refund: (BillingRefund & { order: BillingOrder }) | null;
  ledgerJournals: Pick<
    BillingLedgerJournal,
    'id' | 'journalNo' | 'journalType' | 'status'
  >[];
};
type RefundPolicyOrder = BillingOrder & {
  item: BillingCatalogItem;
  price: BillingPrice & { ledgerAllocations: BillingPriceLedgerAllocation[] };
  paymentIntents: BillingPaymentIntent[];
  refunds: BillingRefund[];
};
type RefundPolicyIssue = {
  code: string;
  msg: string;
};
type RefundQuoteOrderDto = {
  id: string;
  orderNo: string;
  status: BillingOrderStatus;
  orderType: BillingOrderType;
  provider: PaymentProvider;
  currency: string;
  amountMinor: string;
  refundedAmountMinor: string;
  userId: string;
  subjectType: BillingSubjectType;
  subjectId: string;
  paidAt: string | null;
  fulfilledAt: string | null;
  item: {
    id: string;
    code: string;
    name: string;
    productType: BillingProductType;
  };
  price: {
    id: string;
    grantsWalletCurrency: WalletCurrencyType | null;
    grantsWalletAmount: string | null;
    grantsPlanKey: string | null;
    grantDurationDays: number | null;
  };
};
type RefundPolicyQuote = {
  order: RefundQuoteOrderDto;
  policy: {
    userSelfServiceAllowed: false;
    adminOnly: true;
    providerSupported: boolean;
    automaticRefundAllowed: boolean;
    calculationMode: 'amount' | 'percent' | 'suggested';
  };
  refundableAmountMinor: string;
  maxPolicyRefundMinor: string;
  suggestedAmountMinor: string;
  requestedAmountMinor: string;
  requestedPercentBps: number | null;
  benefitImpact:
    | {
        type: 'none';
        automaticReversalAllowed: true;
        description: string;
      }
    | {
        type: 'wallet';
        walletCurrency: WalletCurrencyType;
        totalGrantedAmount: string;
        alreadyReversedAmount: string;
        requestedReversalAmount: string;
        availableBalance: string;
        automaticReversalAllowed: boolean;
        description: string;
      }
    | {
        type: 'membership';
        planKey: string;
        startsAt: string;
        endsAt: string | null;
        unusedBps: number;
        revokeEntitlement: boolean;
        automaticReversalAllowed: boolean;
        description: string;
      };
  blockers: RefundPolicyIssue[];
  warnings: RefundPolicyIssue[];
};
type PromotionWithBindings = BillingPromotion & {
  providerBindings: BillingPromotionProviderBinding[];
  appliesItem: BillingCatalogItem | null;
  appliesPrice: (BillingPrice & { item: BillingCatalogItem }) | null;
  _count: { redemptions: number };
};
type CheckoutPromotionReservation = {
  promotion: BillingPromotion;
  discountAmountMinor: bigint;
  providerCouponId: string | null;
};

@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly permissions: WorkspacePermissionService,
    private readonly ledger: BillingLedgerService,
  ) {}

  async listPrices(query: ListBillingPricesQuery) {
    const provider =
      (query.provider as PaymentProvider | undefined) ??
      this.providerRegistry.defaultProviderForRuntime();
    const activeProviderBindingWhere = {
      provider,
      status: BillingProviderBindingStatus.active,
      archivedAt: null,
    } satisfies Prisma.BillingProviderPriceBindingWhereInput;
    const prices = await this.prisma.billingPrice.findMany({
      where: {
        isActive: query.includeInactive ? undefined : true,
        archivedAt: query.includeInactive ? undefined : null,
        currency: query.currency,
        item: {
          isActive: query.includeInactive ? undefined : true,
          archivedAt: query.includeInactive ? undefined : null,
          productType: query.productType as BillingProductType | undefined,
        },
        providerBindings: query.includeInactive
          ? undefined
          : { some: activeProviderBindingWhere },
      },
      include: {
        item: true,
        providerBindings: {
          where: query.includeInactive
            ? { provider }
            : activeProviderBindingWhere,
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ amountMinor: 'asc' }, { createdAt: 'asc' }],
    });

    return {
      provider,
      prices: prices.map((price) => this.priceDto(price, provider)),
    };
  }

  async getAdminOverview() {
    const now = new Date();
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const [
      activeCatalogItems,
      activePrices,
      providerBindings,
      pendingOrders,
      fulfilledOrders7d,
      failedOrders7d,
      paymentFailures7d,
      revenue7d,
      walletAccounts,
      walletLedgerEntries,
      recentOrders,
    ] = await Promise.all([
      this.prisma.billingCatalogItem.count({
        where: { isActive: true, archivedAt: null },
      }),
      this.prisma.billingPrice.count({
        where: { isActive: true, archivedAt: null },
      }),
      this.prisma.billingProviderPriceBinding.findMany({
        where: { archivedAt: null },
        select: {
          id: true,
          provider: true,
          status: true,
          providerProductId: true,
          providerPriceId: true,
          price: {
            select: {
              id: true,
              currency: true,
              amountMinor: true,
              item: { select: { code: true, name: true, productType: true } },
            },
          },
        },
        orderBy: [{ provider: 'asc' }, { createdAt: 'desc' }],
        take: 30,
      }),
      this.prisma.billingOrder.count({
        where: { status: BillingOrderStatus.pending_payment },
      }),
      this.prisma.billingOrder.count({
        where: {
          status: BillingOrderStatus.fulfilled,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.billingOrder.count({
        where: {
          status: BillingOrderStatus.failed,
          createdAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.billingPaymentIntent.count({
        where: {
          status: PaymentIntentStatus.failed,
          updatedAt: { gte: sevenDaysAgo },
        },
      }),
      this.prisma.billingOrder.groupBy({
        by: ['currency'],
        where: {
          status: {
            in: [BillingOrderStatus.paid, BillingOrderStatus.fulfilled],
          },
          paidAt: { gte: sevenDaysAgo },
        },
        _sum: { amountMinor: true },
      }),
      this.prisma.walletAccount.findMany({
        include: {
          _count: { select: { ledgerEntries: true } },
        },
        orderBy: { updatedAt: 'desc' },
        take: 50,
      }),
      this.prisma.walletLedgerEntry.findMany({
        include: {
          account: true,
          transaction: true,
        },
        orderBy: { createdAt: 'desc' },
        take: 12,
      }),
      this.prisma.billingOrder.findMany({
        include: {
          item: true,
          price: true,
          paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 },
          refunds: { orderBy: { createdAt: 'desc' }, take: 3 },
        },
        orderBy: { createdAt: 'desc' },
        take: 8,
      }),
    ]);

    return {
      generatedAt: now.toISOString(),
      metrics: {
        activeCatalogItems,
        activePrices,
        activeProviderBindings: providerBindings.filter(
          (binding) => binding.status === BillingProviderBindingStatus.active,
        ).length,
        incompleteProviderBindings: providerBindings.filter(
          (binding) =>
            binding.provider === PaymentProvider.airwallex &&
            binding.status === BillingProviderBindingStatus.active &&
            !binding.providerPriceId,
        ).length,
        pendingOrders,
        fulfilledOrders7d,
        failedOrders7d,
        paymentFailures7d,
        revenue7d: revenue7d.map((row) => ({
          currency: row.currency,
          amountMinor: (row._sum.amountMinor ?? 0n).toString(),
        })),
      },
      providerBindings: providerBindings.map((binding) => ({
        id: binding.id,
        provider: binding.provider,
        status: binding.status,
        providerProductId: binding.providerProductId,
        providerPriceId: binding.providerPriceId,
        price: {
          id: binding.price.id,
          code: binding.price.item.code,
          name: binding.price.item.name,
          productType: binding.price.item.productType,
          currency: binding.price.currency,
          amountMinor: binding.price.amountMinor.toString(),
        },
      })),
      walletAccounts: walletAccounts.map((account) => ({
        id: account.id,
        ownerType: account.ownerType,
        ownerId: account.ownerId,
        currency: account.currency,
        balanceKind: account.balanceKind,
        status: account.status,
        availableBalance: account.availableBalance.toString(),
        heldBalance: account.heldBalance.toString(),
        ledgerEntryCount: account._count.ledgerEntries,
        updatedAt: account.updatedAt.toISOString(),
      })),
      walletLedgerEntries: walletLedgerEntries.map((entry) => ({
        id: entry.id,
        transactionId: entry.transactionId,
        accountId: entry.accountId,
        ownerType: entry.account.ownerType,
        ownerId: entry.account.ownerId,
        entryType: entry.entryType,
        currency: entry.currency,
        balanceKind: entry.balanceKind,
        amount: entry.amount.toString(),
        availableDelta: entry.availableDelta.toString(),
        heldDelta: entry.heldDelta.toString(),
        availableBalanceAfter: entry.availableBalanceAfter.toString(),
        heldBalanceAfter: entry.heldBalanceAfter.toString(),
        reason: entry.reason,
        sourceType: entry.transaction.sourceType,
        sourceId: entry.transaction.sourceId,
        idempotencyKey: entry.transaction.idempotencyKey,
        description: entry.transaction.description,
        createdAt: entry.createdAt.toISOString(),
      })),
      recentOrders: recentOrders.map((order) => this.adminOrderDto(order)),
    };
  }

  async listAdminPrices(query: ListAdminBillingPricesQuery) {
    const where = {
      isActive: query.includeInactive ? undefined : true,
      archivedAt: query.includeInactive ? undefined : null,
      currency: query.currency,
      item: {
        productType: query.productType as BillingProductType | undefined,
        isActive: query.includeInactive ? undefined : true,
        archivedAt: query.includeInactive ? undefined : null,
      },
      providerBindings: query.provider
        ? {
            some: {
              provider: query.provider as PaymentProvider,
              archivedAt: null,
            },
          }
        : undefined,
    } satisfies Prisma.BillingPriceWhereInput;

    const prices = await this.prisma.billingPrice.findMany({
      where,
      include: {
        item: true,
        providerBindings: {
          where: query.includeInactive ? undefined : { archivedAt: null },
          orderBy: [{ provider: 'asc' }, { createdAt: 'desc' }],
        },
        _count: {
          select: {
            orders: true,
            subscriptions: true,
          },
        },
      },
      orderBy: [
        { item: { productType: 'asc' } },
        { currency: 'asc' },
        { amountMinor: 'asc' },
      ],
      take: 200,
    });

    return {
      items: prices.map((price) => ({
        id: price.id,
        itemId: price.itemId,
        code: price.item.code,
        name: price.item.name,
        productType: price.item.productType,
        description: price.item.description,
        currency: price.currency,
        amountMinor: price.amountMinor.toString(),
        interval: price.interval,
        subjectType: price.subjectType,
        grantsWalletCurrency: price.grantsWalletCurrency,
        grantsWalletBalanceKind: price.grantsWalletBalanceKind,
        grantsWalletAmount: price.grantsWalletAmount?.toString() ?? null,
        grantsPlanKey: price.grantsPlanKey,
        grantDurationDays: price.grantDurationDays,
        isActive: price.isActive && price.item.isActive,
        archivedAt: price.archivedAt?.toISOString() ?? null,
        providerBindings: price.providerBindings.map((binding) => ({
          id: binding.id,
          provider: binding.provider,
          status: binding.status,
          providerProductId: binding.providerProductId,
          providerPriceId: binding.providerPriceId,
          providerMode: binding.providerMode,
          syncError: binding.syncError,
          lastSyncedAt: binding.lastSyncedAt?.toISOString() ?? null,
          archivedAt: binding.archivedAt?.toISOString() ?? null,
        })),
        counts: {
          orders: price._count.orders,
          subscriptions: price._count.subscriptions,
        },
        updatedAt: price.updatedAt.toISOString(),
      })),
    };
  }

  async createAdminPrice(adminId: string, input: CreateAdminBillingPriceInput) {
    const itemCode = input.itemCode ?? buildBillingItemCode(input);
    return this.prisma.$transaction(async (tx) => {
      const item = await tx.billingCatalogItem.upsert({
        where: { code: itemCode },
        create: {
          code: itemCode,
          name: input.itemName,
          description: input.itemDescription ?? null,
          productType: input.productType as BillingProductType,
          metadata: (input.itemMetadata ?? {}) as Prisma.InputJsonValue,
        },
        update: {
          name: input.itemName,
          description: input.itemDescription ?? null,
          productType: input.productType as BillingProductType,
          isActive: true,
          archivedAt: null,
          metadata: (input.itemMetadata ?? {}) as Prisma.InputJsonValue,
        },
      });

      const price = await tx.billingPrice.create({
        data: {
          itemId: item.id,
          currency: input.currency,
          amountMinor: input.amountMinor,
          interval: input.interval as BillingPriceInterval,
          subjectType: input.subjectType as BillingSubjectType,
          grantsWalletCurrency:
            (input.grantsWalletCurrency as WalletCurrencyType | undefined) ??
            null,
          grantsWalletBalanceKind: input.grantsWalletCurrency
            ? WalletBalanceKind.consumable
            : null,
          grantsWalletAmount: input.grantsWalletAmount ?? null,
          grantsPlanKey: input.grantsPlanKey ?? null,
          grantDurationDays: input.grantDurationDays ?? null,
          metadata: {
            ...(input.priceMetadata ?? {}),
            createdByAdminId: adminId,
          } as Prisma.InputJsonValue,
          providerBindings: {
            create: input.providerBindings.map((binding) => ({
              provider: binding.provider as PaymentProvider,
              providerProductId: binding.providerProductId ?? null,
              providerPriceId: binding.providerPriceId ?? null,
              providerMode: binding.providerMode ?? null,
              status: binding.status as BillingProviderBindingStatus,
              metadata: (binding.metadata ?? {}) as Prisma.InputJsonValue,
            })),
          },
        },
        include: {
          item: true,
          providerBindings: { orderBy: [{ provider: 'asc' }] },
          _count: { select: { orders: true, subscriptions: true } },
        },
      });
      return this.adminPriceDto(price);
    });
  }

  async updateAdminPrice(priceId: string, input: UpdateAdminBillingPriceInput) {
    const price = await this.prisma.billingPrice.findUnique({
      where: { id: priceId },
      include: { item: true },
    });
    if (!price) {
      throw new NotFoundException({
        code: 'BILLING_PRICE_NOT_FOUND',
        msg: 'Billing price not found.',
      });
    }
    const archivedAt =
      input.archived === undefined
        ? price.archivedAt
        : input.archived
          ? new Date()
          : null;
    await this.prisma.$transaction([
      this.prisma.billingCatalogItem.update({
        where: { id: price.itemId },
        data: {
          name: input.itemName ?? undefined,
          description:
            input.itemDescription === undefined
              ? undefined
              : input.itemDescription,
        },
      }),
      this.prisma.billingPrice.update({
        where: { id: priceId },
        data: {
          isActive: input.isActive ?? undefined,
          archivedAt,
          metadata: input.priceMetadata
            ? (input.priceMetadata as Prisma.InputJsonValue)
            : undefined,
        },
      }),
    ]);
    return this.getAdminPrice(priceId);
  }

  async upsertAdminProviderBinding(
    priceId: string,
    input: UpsertAdminBillingProviderBindingInput,
  ) {
    const price = await this.prisma.billingPrice.findUnique({
      where: { id: priceId },
    });
    if (!price) {
      throw new NotFoundException({
        code: 'BILLING_PRICE_NOT_FOUND',
        msg: 'Billing price not found.',
      });
    }
    const existing = await this.prisma.billingProviderPriceBinding.findFirst({
      where: {
        priceId,
        provider: input.provider as PaymentProvider,
        archivedAt: null,
      },
    });
    const data = {
      providerProductId: input.providerProductId ?? null,
      providerPriceId: input.providerPriceId ?? null,
      providerMode: input.providerMode ?? null,
      status: input.status as BillingProviderBindingStatus,
      syncError: null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    };
    if (existing) {
      return this.prisma.billingProviderPriceBinding.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.prisma.billingProviderPriceBinding.create({
      data: {
        priceId,
        provider: input.provider as PaymentProvider,
        ...data,
      },
    });
  }

  async syncAdminProviderBinding(bindingId: string) {
    const binding = await this.prisma.billingProviderPriceBinding.findUnique({
      where: { id: bindingId },
      include: { price: { include: { item: true } } },
    });
    if (!binding || binding.archivedAt) {
      throw new NotFoundException({
        code: 'BILLING_PROVIDER_BINDING_NOT_FOUND',
        msg: 'Billing provider binding not found.',
      });
    }
    const adapter = this.providerRegistry.get(binding.provider);
    if (!adapter.syncPrice) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_PROVIDER_CATALOG_SYNC_UNSUPPORTED',
        msg: `Payment provider "${binding.provider}" does not support catalog sync yet.`,
      });
    }
    await this.prisma.billingProviderPriceBinding.update({
      where: { id: binding.id },
      data: {
        status: BillingProviderBindingStatus.sync_pending,
        syncError: null,
      },
    });
    try {
      const result = await adapter.syncPrice({
        requestId: randomUUID(),
        productName: binding.price.item.name,
        productDescription: binding.price.item.description,
        productActive:
          binding.price.item.isActive && !binding.price.item.archivedAt,
        providerProductId: binding.providerProductId,
        priceDescription: binding.price.item.description,
        priceActive: binding.price.isActive && !binding.price.archivedAt,
        currency: binding.price.currency,
        amountMinor: binding.price.amountMinor,
        interval: binding.price.interval,
      });
      return this.prisma.billingProviderPriceBinding.update({
        where: { id: binding.id },
        data: {
          providerProductId: result.providerProductId,
          providerPriceId: result.providerPriceId,
          providerPayload: result.raw as Prisma.InputJsonValue,
          status: BillingProviderBindingStatus.active,
          syncError: null,
          lastSyncedAt: new Date(),
        },
      });
    } catch (err) {
      await this.prisma.billingProviderPriceBinding.update({
        where: { id: binding.id },
        data: {
          status: BillingProviderBindingStatus.sync_failed,
          syncError:
            err instanceof Error ? err.message : 'Provider sync failed.',
        },
      });
      throw err;
    }
  }

  async listAdminPromotions(query: ListAdminBillingPromotionsQuery) {
    const search = query.q?.trim();
    const rows = await this.prisma.billingPromotion.findMany({
      where: {
        status: query.status as BillingPromotionStatus | undefined,
        archivedAt: query.includeArchived ? undefined : null,
        providerBindings: query.provider
          ? {
              some: {
                provider: query.provider as PaymentProvider,
                archivedAt: null,
              },
            }
          : undefined,
        ...(search
          ? {
              OR: [
                {
                  code: { contains: search.toUpperCase(), mode: 'insensitive' },
                },
                { name: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      include: {
        appliesItem: true,
        appliesPrice: { include: { item: true } },
        providerBindings: {
          where: query.includeArchived ? undefined : { archivedAt: null },
          orderBy: [{ provider: 'asc' }],
        },
        _count: { select: { redemptions: true } },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: 200,
    });
    return { items: rows.map((row) => this.adminPromotionDto(row)) };
  }

  async createAdminPromotion(
    adminId: string,
    input: CreateAdminBillingPromotionInput,
  ) {
    const promotion = await this.prisma.billingPromotion.create({
      data: {
        code: input.code,
        name: input.name,
        description: input.description ?? null,
        status: input.status as BillingPromotionStatus,
        percentOffBps: input.percentOffBps,
        durationType: input.durationType as BillingPromotionDurationType,
        durationCount: input.durationCount ?? null,
        durationUnit: input.durationUnit ?? null,
        appliesProductType:
          (input.appliesProductType as BillingProductType | undefined) ?? null,
        appliesItemId: input.appliesItemId ?? null,
        appliesPriceId: input.appliesPriceId ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        maxRedemptions: input.maxRedemptions ?? null,
        maxRedemptionsPerUser: input.maxRedemptionsPerUser ?? null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        createdById: adminId,
        providerBindings: {
          create: input.providerBindings.map((binding) => ({
            provider: binding.provider as PaymentProvider,
            providerCouponId: binding.providerCouponId ?? null,
            status: binding.status as BillingProviderBindingStatus,
            metadata: (binding.metadata ?? {}) as Prisma.InputJsonValue,
          })),
        },
      },
      include: {
        appliesItem: true,
        appliesPrice: { include: { item: true } },
        providerBindings: { orderBy: [{ provider: 'asc' }] },
        _count: { select: { redemptions: true } },
      },
    });
    return this.adminPromotionDto(promotion);
  }

  async updateAdminPromotion(
    promotionId: string,
    adminId: string,
    input: UpdateAdminBillingPromotionInput,
  ) {
    const existing = await this.prisma.billingPromotion.findUnique({
      where: { id: promotionId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'BILLING_PROMOTION_NOT_FOUND',
        msg: 'Billing promotion not found.',
      });
    }
    const promotion = await this.prisma.billingPromotion.update({
      where: { id: promotionId },
      data: {
        name: input.name ?? undefined,
        description:
          input.description === undefined ? undefined : input.description,
        status: input.status as BillingPromotionStatus | undefined,
        startsAt: input.startsAt === undefined ? undefined : input.startsAt,
        endsAt: input.endsAt === undefined ? undefined : input.endsAt,
        maxRedemptions:
          input.maxRedemptions === undefined ? undefined : input.maxRedemptions,
        maxRedemptionsPerUser:
          input.maxRedemptionsPerUser === undefined
            ? undefined
            : input.maxRedemptionsPerUser,
        metadata: input.metadata
          ? (input.metadata as Prisma.InputJsonValue)
          : undefined,
        updatedById: adminId,
        archivedAt:
          input.archived === undefined
            ? undefined
            : input.archived
              ? new Date()
              : null,
      },
      include: {
        appliesItem: true,
        appliesPrice: { include: { item: true } },
        providerBindings: { orderBy: [{ provider: 'asc' }] },
        _count: { select: { redemptions: true } },
      },
    });
    return this.adminPromotionDto(promotion);
  }

  async upsertAdminPromotionProviderBinding(
    promotionId: string,
    input: UpsertAdminBillingPromotionProviderBindingInput,
  ) {
    const promotion = await this.prisma.billingPromotion.findUnique({
      where: { id: promotionId },
    });
    if (!promotion) {
      throw new NotFoundException({
        code: 'BILLING_PROMOTION_NOT_FOUND',
        msg: 'Billing promotion not found.',
      });
    }
    const existing =
      await this.prisma.billingPromotionProviderBinding.findFirst({
        where: {
          promotionId,
          provider: input.provider as PaymentProvider,
          archivedAt: null,
        },
      });
    const data = {
      providerCouponId: input.providerCouponId ?? null,
      status: input.status as BillingProviderBindingStatus,
      syncError: null,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    };
    if (existing) {
      return this.prisma.billingPromotionProviderBinding.update({
        where: { id: existing.id },
        data,
      });
    }
    return this.prisma.billingPromotionProviderBinding.create({
      data: {
        promotionId,
        provider: input.provider as PaymentProvider,
        ...data,
      },
    });
  }

  async syncAdminPromotionProviderBinding(bindingId: string) {
    const binding =
      await this.prisma.billingPromotionProviderBinding.findUnique({
        where: { id: bindingId },
        include: { promotion: true },
      });
    if (!binding || binding.archivedAt) {
      throw new NotFoundException({
        code: 'BILLING_PROMOTION_PROVIDER_BINDING_NOT_FOUND',
        msg: 'Billing promotion provider binding not found.',
      });
    }
    const adapter = this.providerRegistry.get(binding.provider);
    if (!adapter.syncCoupon) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_PROVIDER_COUPON_SYNC_UNSUPPORTED',
        msg: `Payment provider "${binding.provider}" does not support coupon sync yet.`,
      });
    }
    await this.prisma.billingPromotionProviderBinding.update({
      where: { id: binding.id },
      data: {
        status: BillingProviderBindingStatus.sync_pending,
        syncError: null,
      },
    });
    try {
      const result = await adapter.syncCoupon({
        requestId: randomUUID(),
        name: binding.promotion.name,
        description: binding.promotion.description,
        active:
          binding.promotion.status === BillingPromotionStatus.active &&
          !binding.promotion.archivedAt,
        percentOffBps: binding.promotion.percentOffBps,
        durationType: binding.promotion.durationType,
        durationCount: binding.promotion.durationCount,
        durationUnit: binding.promotion.durationUnit,
        expiresAt: binding.promotion.endsAt,
        metadata: {
          fizzdragon_promotion_id: binding.promotion.id,
          fizzdragon_promotion_code: binding.promotion.code,
        },
      });
      return this.prisma.billingPromotionProviderBinding.update({
        where: { id: binding.id },
        data: {
          providerCouponId: result.providerCouponId,
          providerPayload: result.raw as Prisma.InputJsonValue,
          status: BillingProviderBindingStatus.active,
          syncError: null,
          lastSyncedAt: new Date(),
        },
      });
    } catch (err) {
      await this.prisma.billingPromotionProviderBinding.update({
        where: { id: binding.id },
        data: {
          status: BillingProviderBindingStatus.sync_failed,
          syncError:
            err instanceof Error ? err.message : 'Provider coupon sync failed.',
        },
      });
      throw err;
    }
  }

  async listAdminOrders(query: ListAdminBillingOrdersQuery) {
    const search = query.q?.trim();
    const where = {
      status: query.status as BillingOrderStatus | undefined,
      provider: query.provider as PaymentProvider | undefined,
      ...(search
        ? {
            OR: [
              { orderNo: { contains: search, mode: 'insensitive' } },
              { userId: { contains: search, mode: 'insensitive' } },
              { subjectId: { contains: search, mode: 'insensitive' } },
              { description: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    } satisfies Prisma.BillingOrderWhereInput;

    const rows = await this.prisma.billingOrder.findMany({
      where,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: {
        item: true,
        price: true,
        paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 },
        refunds: { orderBy: { createdAt: 'desc' }, take: 3 },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return {
      items: items.map((order) => this.adminOrderDto(order)),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async listAdminRefunds(query: ListAdminBillingRefundsQuery) {
    const search = query.q?.trim();
    const where = {
      status: query.status as BillingRefundStatus | undefined,
      provider: query.provider as PaymentProvider | undefined,
      ...(search
        ? {
            OR: [
              { refundNo: { contains: search, mode: 'insensitive' } },
              { reasonCode: { contains: search, mode: 'insensitive' } },
              { operatorNote: { contains: search, mode: 'insensitive' } },
              {
                order: {
                  is: {
                    OR: [
                      { orderNo: { contains: search, mode: 'insensitive' } },
                      { userId: { contains: search, mode: 'insensitive' } },
                      {
                        subjectId: { contains: search, mode: 'insensitive' },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    } satisfies Prisma.BillingRefundWhereInput;

    const rows = await this.prisma.billingRefund.findMany({
      where,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: {
        order: { include: { item: true } },
        paymentIntent: true,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return {
      items: items.map((refund) => this.adminRefundDto(refund)),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async listAdminProviderEvents(query: ListAdminBillingProviderEventsQuery) {
    const search = query.q?.trim();
    const exactId = search && isUuid(search) ? search : null;
    const where = {
      status: query.status as PaymentProviderEventStatus | undefined,
      provider: query.provider as PaymentProvider | undefined,
      eventType: query.eventType
        ? { contains: query.eventType, mode: 'insensitive' }
        : undefined,
      ...(search
        ? {
            OR: [
              { providerEventId: { contains: search, mode: 'insensitive' } },
              { eventType: { contains: search, mode: 'insensitive' } },
              { error: { contains: search, mode: 'insensitive' } },
              ...(exactId
                ? [
                    { id: exactId },
                    { orderId: exactId },
                    { paymentIntentId: exactId },
                    { refundId: exactId },
                  ]
                : []),
              {
                paymentIntent: {
                  is: {
                    order: {
                      is: {
                        OR: [
                          {
                            orderNo: {
                              contains: search,
                              mode: 'insensitive',
                            },
                          },
                          {
                            userId: {
                              contains: search,
                              mode: 'insensitive',
                            },
                          },
                        ],
                      },
                    },
                  },
                },
              },
              {
                refund: {
                  is: {
                    OR: [
                      {
                        refundNo: {
                          contains: search,
                          mode: 'insensitive',
                        },
                      },
                      {
                        requestId: {
                          contains: search,
                          mode: 'insensitive',
                        },
                      },
                    ],
                  },
                },
              },
            ],
          }
        : {}),
    } satisfies Prisma.BillingPaymentProviderEventWhereInput;

    const rows = await this.prisma.billingPaymentProviderEvent.findMany({
      where,
      cursor: query.cursor ? { id: query.cursor } : undefined,
      skip: query.cursor ? 1 : 0,
      include: {
        paymentIntent: { include: { order: true } },
        refund: { include: { order: true } },
        ledgerJournals: {
          select: {
            id: true,
            journalNo: true,
            journalType: true,
            status: true,
          },
          orderBy: { postedAt: 'desc' },
          take: 3,
        },
      },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const items = rows.slice(0, query.limit);
    return {
      items: items.map((event) => this.adminProviderEventDto(event)),
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async reprocessAdminProviderEvent(eventId: string) {
    const event = await this.prisma.billingPaymentProviderEvent.findUnique({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    if (!event) {
      throw new NotFoundException({
        code: 'BILLING_PROVIDER_EVENT_NOT_FOUND',
        msg: 'Billing provider event not found.',
      });
    }
    if (event.status === PaymentProviderEventStatus.processed) {
      throw new ConflictException({
        code: 'BILLING_PROVIDER_EVENT_ALREADY_PROCESSED',
        msg: 'Processed provider events cannot be replayed from admin.',
      });
    }
    await this.processStoredProviderEvent(event.id);
    return this.getAdminProviderEvent(event.id);
  }

  async ignoreAdminProviderEvent(eventId: string, reason: string) {
    const event = await this.prisma.billingPaymentProviderEvent.findUnique({
      where: { id: eventId },
      select: { id: true, status: true },
    });
    if (!event) {
      throw new NotFoundException({
        code: 'BILLING_PROVIDER_EVENT_NOT_FOUND',
        msg: 'Billing provider event not found.',
      });
    }
    if (event.status === PaymentProviderEventStatus.processed) {
      throw new ConflictException({
        code: 'BILLING_PROVIDER_EVENT_ALREADY_PROCESSED',
        msg: 'Processed provider events cannot be ignored.',
      });
    }
    await this.prisma.billingPaymentProviderEvent.update({
      where: { id: event.id },
      data: {
        status: PaymentProviderEventStatus.ignored,
        processedAt: new Date(),
        error: reason,
      },
    });
    return this.getAdminProviderEvent(event.id);
  }

  async quoteAdminRefund(
    input: QuoteAdminBillingRefundInput,
  ): Promise<RefundPolicyQuote> {
    return this.prisma.$transaction(async (tx) => {
      const order = await this.loadRefundPolicyOrderTx(tx, input.orderId);
      return this.buildRefundPolicyQuoteTx(tx, order, input);
    });
  }

  async createAdminRefund(
    adminId: string,
    input: CreateAdminBillingRefundInput,
  ) {
    const existing = await this.prisma.billingRefund.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      include: {
        order: { include: { item: true } },
        paymentIntent: true,
      },
    });
    if (existing) return this.adminRefundDto(existing);

    const prepared = await this.prisma.$transaction((tx) =>
      this.prepareAdminRefundTx(tx, adminId, input),
    );

    const adapter = this.providerRegistry.get(prepared.refund.provider);
    if (!adapter.createRefund) {
      await this.markRefundFailedAfterProviderError(
        prepared.refund.id,
        'BILLING_REFUND_PROVIDER_UNSUPPORTED',
        `Payment provider "${prepared.refund.provider}" does not support refunds yet.`,
      );
      throw new ConflictException({
        code: 'BILLING_REFUND_PROVIDER_UNSUPPORTED',
        msg: `Payment provider "${prepared.refund.provider}" does not support refunds yet.`,
      });
    }

    let providerResult: CreateProviderRefundResult;
    try {
      providerResult = await adapter.createRefund({
        requestId: prepared.refund.requestId,
        providerPaymentIntentId: prepared.providerPaymentIntentId,
        amountMinor: prepared.refund.amountMinor,
        currency: prepared.refund.currency,
        reason: refundReasonForProvider(prepared.refund),
        metadata: {
          fizzdragon_refund_id: prepared.refund.id,
          fizzdragon_refund_no: prepared.refund.refundNo,
          fizzdragon_order_id: prepared.refund.orderId,
        },
      });
    } catch (err) {
      await this.markRefundFailedAfterProviderError(
        prepared.refund.id,
        'BILLING_REFUND_PROVIDER_CREATE_FAILED',
        err instanceof Error ? err.message : 'Provider refund creation failed.',
      );
      throw err;
    }

    const submitted = await this.prisma.$transaction((tx) =>
      this.applyProviderRefundSubmissionTx(
        tx,
        prepared.refund.id,
        providerResult,
      ),
    );
    return this.adminRefundDto(submitted);
  }

  async createCheckout(user: AuthUser, input: CreateBillingCheckoutInput) {
    this.assertReturnUrlAllowed(input.successUrl);
    this.assertReturnUrlAllowed(input.backUrl);

    const existingOrder = await this.prisma.billingOrder.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: user.userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: {
        paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (existingOrder) {
      return {
        order: this.orderDto(existingOrder),
        paymentIntent: existingOrder.paymentIntents[0]
          ? this.paymentIntentDto(existingOrder.paymentIntents[0])
          : null,
      };
    }

    const provider =
      (input.provider as PaymentProvider | undefined) ??
      this.providerRegistry.defaultProviderForRuntime();
    const price = await this.prisma.billingPrice.findFirst({
      where: {
        id: input.priceId,
        isActive: true,
        archivedAt: null,
        item: { isActive: true, archivedAt: null },
      },
      include: {
        item: true,
        providerBindings: {
          where: {
            provider,
            status: BillingProviderBindingStatus.active,
            archivedAt: null,
          },
          take: 1,
        },
      },
    });
    if (!price) {
      throw new NotFoundException({
        code: 'BILLING_PRICE_NOT_FOUND',
        msg: 'Billing price not found.',
      });
    }
    const subject = await this.resolveCheckoutSubject(user, price, input);
    const quantity = input.quantity;
    const subtotalAmountMinor = price.amountMinor * BigInt(quantity);
    const requestId = randomUUID();
    const orderNo = createOrderNo();
    const orderType = orderTypeForPrice(price);

    const { order, promotionReservation } = await this.prisma.$transaction(
      async (tx) => {
        const promotionReservation = input.promotionCode
          ? await this.reserveCheckoutPromotionTx(tx, {
              userId: user.userId,
              provider,
              code: input.promotionCode,
              price,
              subtotalAmountMinor,
              now: new Date(),
            })
          : null;
        const discountAmountMinor =
          promotionReservation?.discountAmountMinor ?? 0n;
        const amountMinor = subtotalAmountMinor - discountAmountMinor;
        const requiresExternalPayment = amountMinor > 0n;
        const providerBinding = requiresExternalPayment
          ? price.providerBindings[0]
          : null;
        if (requiresExternalPayment && !providerBinding) {
          throw new ConflictException({
            code: 'BILLING_PRICE_PROVIDER_BINDING_MISSING',
            msg: `Billing price is not available through "${provider}".`,
          });
        }
        if (providerBinding) {
          assertProviderBindingReady(providerBinding);
        }
        const order = await tx.billingOrder.create({
          data: {
            orderNo,
            idempotencyKey: input.idempotencyKey,
            userId: user.userId,
            workspaceId: subject.workspaceId,
            subjectType: subject.subjectType,
            subjectId: subject.subjectId,
            orderType,
            status: BillingOrderStatus.pending_payment,
            itemId: price.itemId,
            priceId: price.id,
            providerBindingId: providerBinding?.id ?? null,
            provider: requiresExternalPayment
              ? provider
              : PaymentProvider.internal,
            currency: price.currency,
            subtotalAmountMinor,
            discountAmountMinor,
            amountMinor,
            quantity,
            // Freeze the wallet grant on the order at checkout so fulfillment +
            // refund are authoritative off this snapshot and never drift if the
            // price grant is later edited. Null for non-grant prices (the guards
            // fall back to the price, preserving today's behaviour exactly).
            grantsWalletAmount: price.grantsWalletAmount,
            grantsWalletCurrency: price.grantsWalletCurrency,
            grantsWalletBalanceKind: price.grantsWalletBalanceKind,
            description: price.item.name,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            metadata: {
              checkout: {
                successUrl: input.successUrl,
                backUrl: input.backUrl,
                providerBindingId: providerBinding?.id ?? null,
              },
              promotion: promotionReservation
                ? {
                    id: promotionReservation.promotion.id,
                    code: promotionReservation.promotion.code,
                    discountAmountMinor:
                      promotionReservation.discountAmountMinor.toString(),
                    providerCouponId: promotionReservation.providerCouponId,
                  }
                : null,
            },
          },
          include: { price: true },
        });
        if (promotionReservation) {
          await tx.billingPromotionRedemption.create({
            data: {
              promotionId: promotionReservation.promotion.id,
              orderId: order.id,
              userId: user.userId,
              codeSnapshot: promotionReservation.promotion.code,
              provider: requiresExternalPayment
                ? provider
                : PaymentProvider.internal,
              status: BillingPromotionRedemptionStatus.reserved,
              currency: price.currency,
              subtotalAmountMinor,
              discountAmountMinor: promotionReservation.discountAmountMinor,
              metadata: {
                priceId: price.id,
                itemId: price.itemId,
                productType: price.item.productType,
              },
            },
          });
          await tx.billingPromotion.update({
            where: { id: promotionReservation.promotion.id },
            data: { redemptionCount: { increment: 1 } },
          });
        }
        return { order, promotionReservation };
      },
    );

    if (order.amountMinor === 0n) {
      await this.prisma.$transaction((tx) =>
        this.markOrderPaidAndFulfill(tx, order, new Date(), null, null, {
          internalPromotionCheckout: true,
          promotionCode: promotionReservation?.promotion.code ?? null,
        }),
      );
      const fulfilledOrder = await this.prisma.billingOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });
      return {
        order: this.orderDto(fulfilledOrder),
        paymentIntent: null,
      };
    }

    const providerBinding = price.providerBindings[0];
    assertProviderBindingReady(providerBinding);
    const adapter = this.providerRegistry.get(provider);

    const mode =
      price.interval === BillingPriceInterval.one_time
        ? 'PAYMENT'
        : 'SUBSCRIPTION';
    let checkout: HostedCheckoutResult;
    try {
      checkout = await adapter.createHostedCheckout({
        requestId,
        mode,
        successUrl: input.successUrl,
        backUrl: input.backUrl,
        providerCouponId: promotionReservation?.providerCouponId ?? undefined,
        lineItems: [
          {
            providerPriceId: providerBinding.providerPriceId,
            internalPriceId: price.id,
            name: price.item.name,
            currency: price.currency,
            amountMinor: price.amountMinor,
            quantity,
            providerCouponId:
              promotionReservation?.providerCouponId ?? undefined,
          },
        ],
        metadata: {
          fizzdragon_order_id: order.id,
          fizzdragon_order_no: order.orderNo,
          fizzdragon_user_id: user.userId,
          fizzdragon_subject_type: subject.subjectType,
          fizzdragon_subject_id: subject.subjectId,
        },
      });
    } catch (err) {
      await this.prisma.$transaction(async (tx) => {
        await tx.billingOrder.update({
          where: { id: order.id },
          data: {
            status: BillingOrderStatus.failed,
            metadata: {
              ...(order.metadata as Record<string, unknown>),
              providerError:
                err instanceof Error
                  ? err.message
                  : 'Provider checkout failed.',
            },
          },
        });
        await this.voidReservedPromotionsForOrderTx(tx, order.id);
      });
      throw err;
    }

    const paymentIntent = await this.prisma.billingPaymentIntent.create({
      data: {
        orderId: order.id,
        provider,
        kind: PaymentIntentKind.hosted_checkout,
        status: PaymentIntentStatus.requires_action,
        requestId,
        providerCheckoutId: checkout.providerCheckoutId,
        providerCustomerId: checkout.providerCustomerId,
        providerSubscriptionId: checkout.providerSubscriptionId,
        providerInvoiceId: checkout.providerInvoiceId,
        checkoutUrl: checkout.checkoutUrl,
        clientSecret: checkout.clientSecret,
        currency: order.currency,
        amountMinor: order.amountMinor,
        providerStatus: checkout.providerStatus,
        providerPayload: checkout.raw as Prisma.InputJsonValue,
        expiresAt: checkout.expiresAt ?? order.expiresAt,
      },
    });

    return {
      order: this.orderDto(order),
      paymentIntent: this.paymentIntentDto(paymentIntent),
    };
  }

  // Ad-hoc, arbitrary-amount community-point recharge via Airwallex Payment
  // Intents (no catalog selection, no provider-price binding). The amount is the
  // input; the order snapshots its own fiat amount + wallet grant, and the
  // standard webhook -> markOrderPaidAndFulfill machinery credits the wallet on
  // payment_intent.succeeded. The client receives the intent id + client_secret +
  // env and launches the Airwallex hosted page via the browser SDK.
  async createCustomRecharge(
    user: AuthUser,
    input: CreateCustomRechargeInput,
    shopperCountry: string,
  ) {
    this.assertReturnUrlAllowed(input.successUrl);
    this.assertReturnUrlAllowed(input.backUrl);

    const sdkEnv = airwallexSdkEnv();
    const country = (shopperCountry || 'US').toUpperCase();

    // Idempotency: a repeated (userId, idempotencyKey) returns the prior order +
    // intent instead of minting a second payable order — mirrors createCheckout.
    const existingOrder = await this.prisma.billingOrder.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: user.userId,
          idempotencyKey: input.idempotencyKey,
        },
      },
      include: {
        paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 },
      },
    });
    if (existingOrder) {
      return {
        order: this.orderDto(existingOrder),
        paymentIntent: existingOrder.paymentIntents[0]
          ? this.paymentIntentDto(existingOrder.paymentIntents[0])
          : null,
        shopperCountry: country,
        env: sdkEnv,
      };
    }

    const provider =
      (input.provider as PaymentProvider | undefined) ??
      this.providerRegistry.defaultProviderForRuntime();
    const adapter = this.providerRegistry.get(provider);
    if (!adapter.createPaymentIntent) {
      throw new ServiceUnavailableException({
        code: 'BILLING_PROVIDER_NO_PAYMENT_INTENT',
        msg: `"${provider}" does not support custom-amount recharge.`,
      });
    }

    // The hidden anchor SKU carries only the points-per-$1 ratio + wallet currency
    // for ledger routing. It has no provider binding, so it never appears in the
    // public listing and is reached only here.
    const anchor = await this.prisma.billingPrice.findFirst({
      where: {
        isActive: true,
        archivedAt: null,
        item: {
          code: CUSTOM_RECHARGE_ITEM_CODE,
          isActive: true,
          archivedAt: null,
        },
      },
      include: { item: true },
    });
    if (!anchor || !anchor.grantsWalletCurrency || !anchor.grantsWalletAmount) {
      throw new ServiceUnavailableException({
        code: 'BILLING_CUSTOM_RECHARGE_UNAVAILABLE',
        msg: 'Custom recharge is not configured.',
      });
    }

    const dollars = BigInt(input.amountDollars);
    const amountMinor = dollars * 100n;
    // Snapshot the per-unit grant on the order; quantity stays 1 so the existing
    // grant math (grant = snapshot * quantity) yields ratio * dollars points.
    const grantSnapshot = anchor.grantsWalletAmount * dollars;
    const requestId = randomUUID();
    const orderNo = createOrderNo();

    const order = await this.prisma.billingOrder.create({
      data: {
        orderNo,
        idempotencyKey: input.idempotencyKey,
        userId: user.userId,
        workspaceId: null,
        subjectType: BillingSubjectType.user,
        subjectId: user.userId,
        orderType: BillingOrderType.community_point_topup,
        status: BillingOrderStatus.pending_payment,
        itemId: anchor.itemId,
        priceId: anchor.id,
        providerBindingId: null,
        provider,
        currency: anchor.currency,
        subtotalAmountMinor: amountMinor,
        discountAmountMinor: 0n,
        amountMinor,
        quantity: 1,
        grantsWalletAmount: grantSnapshot,
        grantsWalletCurrency: anchor.grantsWalletCurrency,
        grantsWalletBalanceKind:
          anchor.grantsWalletBalanceKind ?? WalletBalanceKind.consumable,
        description: anchor.item.name,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        metadata: {
          checkout: {
            successUrl: input.successUrl,
            backUrl: input.backUrl,
          },
          customRecharge: {
            amountDollars: input.amountDollars,
            shopperCountry: country,
          },
        },
      },
      include: { price: true },
    });

    let intent: CreatePaymentIntentResult;
    try {
      intent = await adapter.createPaymentIntent({
        requestId,
        amountMinor,
        currency: order.currency,
        merchantOrderId: order.orderNo,
        returnUrl: input.successUrl,
        metadata: {
          fizzdragon_order_id: order.id,
          fizzdragon_order_no: order.orderNo,
          fizzdragon_user_id: user.userId,
        },
      });
    } catch (err) {
      await this.prisma.billingOrder.update({
        where: { id: order.id },
        data: {
          status: BillingOrderStatus.failed,
          metadata: {
            ...(order.metadata as Record<string, unknown>),
            providerError:
              err instanceof Error
                ? err.message
                : 'Provider payment intent failed.',
          },
        },
      });
      throw err;
    }

    const paymentIntent = await this.prisma.billingPaymentIntent.create({
      data: {
        orderId: order.id,
        provider,
        kind: PaymentIntentKind.payment_intent,
        status: PaymentIntentStatus.requires_action,
        requestId,
        providerPaymentIntentId: intent.providerPaymentIntentId,
        clientSecret: intent.clientSecret,
        currency: order.currency,
        amountMinor: order.amountMinor,
        providerStatus: intent.providerStatus,
        providerPayload: intent.raw as Prisma.InputJsonValue,
        expiresAt: order.expiresAt,
      },
    });

    return {
      order: this.orderDto(order),
      paymentIntent: this.paymentIntentDto(paymentIntent),
      shopperCountry: country,
      env: sdkEnv,
    };
  }

  async getOrder(user: AuthUser, orderId: string) {
    const order = await this.prisma.billingOrder.findFirst({
      where: { id: orderId },
      include: { paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'BILLING_ORDER_NOT_FOUND',
        msg: 'Billing order not found.',
      });
    }
    if (order.userId !== user.userId) {
      if (!order.workspaceId) {
        throw new ForbiddenException({
          code: 'BILLING_ORDER_ACCESS_DENIED',
          msg: 'You do not have access to this billing order.',
        });
      }
      await this.permissions.requireWorkspaceRole(
        user.userId,
        order.workspaceId,
        WorkspaceMemberRole.billing,
      );
    }

    return {
      order: this.orderDto(order),
      paymentIntent: order.paymentIntents[0]
        ? this.paymentIntentDto(order.paymentIntents[0])
        : null,
    };
  }

  async handleAirwallexWebhook(input: {
    rawBody: Buffer;
    timestamp?: string | string[];
    signature?: string | string[];
    testSecret?: string | string[];
  }) {
    const adapter = this.providerRegistry.get(PaymentProvider.airwallex);
    const verification = adapter.verifyWebhook(input);
    const payload = JSON.parse(input.rawBody.toString('utf8')) as Record<
      string,
      unknown
    >;
    const providerEventId = providerEventKey(payload, input.rawBody);
    const eventType = eventTypeFromPayload(payload);
    const storedEvent = await this.storeProviderEvent({
      provider: PaymentProvider.airwallex,
      providerEventId,
      eventType,
      payload: {
        ...payload,
        fizzdragon: {
          signatureSkipped: verification.signatureSkipped,
        },
      },
    });
    if (storedEvent.status === PaymentProviderEventStatus.processed) {
      return { received: true, deduped: true };
    }
    const processed = await this.processStoredProviderEvent(storedEvent.id, {
      allowProcessedNoop: true,
    });
    return {
      received: true,
      matched: processed.status === PaymentProviderEventStatus.processed,
      status: processed.status,
    };
  }

  private async storeProviderEvent(input: {
    provider: PaymentProvider;
    providerEventId: string;
    eventType: string;
    payload: Record<string, unknown>;
  }): Promise<BillingPaymentProviderEvent> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`billing:provider_event:${input.provider}:${input.providerEventId}`})::bigint)
      `;

      const existing = await tx.billingPaymentProviderEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: input.provider,
            providerEventId: input.providerEventId,
          },
        },
      });
      if (existing?.status === PaymentProviderEventStatus.processed) {
        return existing;
      }

      if (existing) {
        return tx.billingPaymentProviderEvent.update({
          where: { id: existing.id },
          data: {
            eventType: input.eventType,
            status: PaymentProviderEventStatus.received,
            payload: input.payload as Prisma.InputJsonValue,
            error: null,
            processedAt: null,
          },
        });
      }

      return tx.billingPaymentProviderEvent.create({
        data: {
          provider: input.provider,
          providerEventId: input.providerEventId,
          eventType: input.eventType,
          payload: input.payload as Prisma.InputJsonValue,
        },
      });
    });
  }

  private async processStoredProviderEvent(
    eventId: string,
    options: { allowProcessedNoop?: boolean } = {},
  ): Promise<BillingPaymentProviderEvent> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`billing:provider_event:${eventId}`})::bigint)
        `;
        const providerEvent =
          await tx.billingPaymentProviderEvent.findUniqueOrThrow({
            where: { id: eventId },
          });
        if (
          providerEvent.status === PaymentProviderEventStatus.processed &&
          options.allowProcessedNoop
        ) {
          return providerEvent;
        }
        if (providerEvent.status === PaymentProviderEventStatus.processed) {
          throw new ConflictException({
            code: 'BILLING_PROVIDER_EVENT_ALREADY_PROCESSED',
            msg: 'Processed provider events cannot be replayed.',
          });
        }
        const payload = providerPayloadRecord(providerEvent.payload);
        const eventType =
          providerEvent.eventType || eventTypeFromPayload(payload);
        const refundMatch = isRefundEvent(eventType)
          ? await this.matchRefund(tx, payload)
          : null;
        const match = refundMatch
          ? null
          : await this.matchPaymentIntent(tx, payload);

        if (!match && !refundMatch) {
          return tx.billingPaymentProviderEvent.update({
            where: { id: providerEvent.id },
            data: {
              status: PaymentProviderEventStatus.ignored,
              orderId: null,
              paymentIntentId: null,
              refundId: null,
              processedAt: new Date(),
              error: 'No matching payment intent or refund found.',
            },
          });
        }

        await tx.billingPaymentProviderEvent.update({
          where: { id: providerEvent.id },
          data: {
            orderId: refundMatch?.orderId ?? match?.orderId ?? null,
            paymentIntentId: refundMatch?.paymentIntentId ?? match?.id ?? null,
            refundId: refundMatch?.id ?? null,
            status: PaymentProviderEventStatus.received,
            error: null,
          },
        });

        if (refundMatch) {
          await this.applyProviderRefundEvent(
            tx,
            refundMatch,
            eventType,
            payload,
            providerEvent.id,
          );
        } else if (match) {
          await this.applyProviderEvent(
            tx,
            match,
            eventType,
            payload,
            providerEvent.id,
          );
        }
        return tx.billingPaymentProviderEvent.update({
          where: { id: providerEvent.id },
          data: {
            status: PaymentProviderEventStatus.processed,
            processedAt: new Date(),
            error: null,
          },
        });
      });
    } catch (err) {
      if (!isProviderEventAlreadyProcessedError(err)) {
        await this.markProviderEventFailed(eventId, err);
      }
      throw err;
    }
  }

  private async markProviderEventFailed(
    eventId: string,
    err: unknown,
  ): Promise<void> {
    await this.prisma.billingPaymentProviderEvent
      .update({
        where: { id: eventId },
        data: {
          status: PaymentProviderEventStatus.failed,
          processedAt: new Date(),
          error: providerEventErrorMessage(err),
        },
      })
      .catch(() => undefined);
  }

  private async applyProviderEvent(
    tx: Prisma.TransactionClient,
    intent: BillingPaymentIntent,
    eventType: string,
    payload: Record<string, unknown>,
    providerEventId: string,
  ): Promise<void> {
    const now = new Date();
    const providerStatus = stringAt(payload, ['data', 'status']);
    if (isPaymentSucceededEvent(eventType, providerStatus)) {
      await tx.billingPaymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.succeeded,
          providerStatus: providerStatus ?? eventType,
          providerPayload: payload as Prisma.InputJsonValue,
          providerPaymentIntentId:
            stringAt(payload, ['data', 'payment_intent_id']) ??
            (eventType.startsWith('payment_intent.')
              ? stringAt(payload, ['data', 'id'])
              : intent.providerPaymentIntentId),
          // Only treat data.id as an invoice id for invoice.* events. For a
          // payment_intent.* event data.id is the PI id (handled above), so
          // falling back to it here would pollute providerInvoiceId.
          providerInvoiceId:
            stringAt(payload, ['data', 'invoice_id']) ??
            (eventType.startsWith('invoice.')
              ? stringAt(payload, ['data', 'id'])
              : intent.providerInvoiceId),
          providerSubscriptionId:
            stringAt(payload, ['data', 'subscription_id']) ??
            intent.providerSubscriptionId,
          completedAt: now,
        },
      });
      const order = await tx.billingOrder.findUniqueOrThrow({
        where: { id: intent.orderId },
        include: { price: true },
      });
      const providerSubscriptionId =
        stringAt(payload, ['data', 'subscription_id']) ??
        intent.providerSubscriptionId;
      if (
        providerSubscriptionId &&
        order.orderType === BillingOrderType.subscription_checkout
      ) {
        await this.upsertSubscriptionFromProviderEvent(
          tx,
          order,
          providerSubscriptionId,
          payload,
          now,
        );
      }
      await this.markOrderPaidAndFulfill(
        tx,
        order,
        now,
        intent,
        providerEventId,
        payload,
      );
      return;
    }

    if (isPaymentFailedEvent(eventType, providerStatus)) {
      await tx.billingPaymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.failed,
          providerStatus: providerStatus ?? eventType,
          providerPayload: payload as Prisma.InputJsonValue,
        },
      });
      await tx.billingOrder.updateMany({
        where: {
          id: intent.orderId,
          status: {
            in: [
              BillingOrderStatus.draft,
              BillingOrderStatus.pending_payment,
              BillingOrderStatus.failed,
            ],
          },
        },
        data: { status: BillingOrderStatus.failed, version: { increment: 1 } },
      });
      await this.voidReservedPromotionsForOrderTx(tx, intent.orderId);
    }
  }

  private async applyProviderRefundEvent(
    tx: Prisma.TransactionClient,
    refund: BillingRefund,
    eventType: string,
    payload: Record<string, unknown>,
    providerEventId: string,
  ): Promise<void> {
    const providerStatus =
      stringAt(payload, ['data', 'status']) ?? refund.providerStatus;
    const providerRefundId =
      stringAt(payload, ['data', 'id']) ?? refund.providerRefundId;
    await tx.billingRefund.update({
      where: { id: refund.id },
      data: {
        providerRefundId,
        providerStatus,
        providerPayload: payload as Prisma.InputJsonValue,
      },
    });

    if (providerRefundSucceeded(providerStatus)) {
      await this.finalizeRefundSucceededTx(tx, refund.id, {
        providerEventId,
        providerStatus,
        payload,
      });
      return;
    }

    if (providerRefundFailed(eventType, providerStatus)) {
      await this.failRefundTx(tx, refund.id, {
        failureCode: 'BILLING_REFUND_PROVIDER_FAILED',
        failureMessage:
          stringAt(payload, ['data', 'failure_reason']) ??
          stringAt(payload, ['data', 'error_message']) ??
          'Payment provider reported refund failure.',
        eventType: 'provider.refund.failed',
        providerEventId,
        providerStatus,
        payload,
      });
      return;
    }

    if (refund.status !== BillingRefundStatus.provider_pending) {
      await tx.billingRefund.update({
        where: { id: refund.id },
        data: { status: BillingRefundStatus.provider_pending },
      });
      await this.recordRefundEventTx(tx, {
        refundId: refund.id,
        eventType: 'provider.refund.pending',
        fromStatus: refund.status,
        toStatus: BillingRefundStatus.provider_pending,
        providerStatus,
        providerEventId,
        payload,
      });
    }
  }

  private async loadRefundPolicyOrderTx(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<RefundPolicyOrder> {
    const order = await tx.billingOrder.findUnique({
      where: { id: orderId },
      include: {
        item: true,
        price: {
          include: {
            ledgerAllocations: {
              where: { archivedAt: null },
              orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
            },
          },
        },
        paymentIntents: {
          where: { status: PaymentIntentStatus.succeeded },
          orderBy: [{ completedAt: 'desc' }, { createdAt: 'desc' }],
          take: 1,
        },
        refunds: {
          where: { status: { in: activeRefundStatuses() } },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!order) {
      throw new NotFoundException({
        code: 'BILLING_ORDER_NOT_FOUND',
        msg: 'Billing order not found.',
      });
    }
    return order;
  }

  private async buildRefundPolicyQuoteTx(
    tx: Prisma.TransactionClient,
    order: RefundPolicyOrder,
    input: QuoteAdminBillingRefundInput | CreateAdminBillingRefundInput,
  ): Promise<RefundPolicyQuote> {
    const blockers: RefundPolicyIssue[] = [];
    const warnings: RefundPolicyIssue[] = [
      {
        code: 'BILLING_REFUND_ADMIN_ONLY',
        msg: 'Refunds are an internal admin operation and are not exposed as a user self-service flow.',
      },
    ];
    const activeRefundAmount = order.refunds.reduce(
      (sum, refund) => sum + refund.amountMinor,
      0n,
    );
    const refundableAmount = order.amountMinor - activeRefundAmount;

    if (order.provider !== PaymentProvider.airwallex) {
      blockers.push({
        code: 'BILLING_REFUND_PROVIDER_UNSUPPORTED',
        msg: `Refunds for provider "${order.provider}" are not implemented yet.`,
      });
    }
    if (
      order.status !== BillingOrderStatus.paid &&
      order.status !== BillingOrderStatus.fulfilled &&
      order.status !== BillingOrderStatus.partially_refunded
    ) {
      blockers.push({
        code: 'BILLING_REFUND_ORDER_STATUS_INVALID',
        msg: 'Only paid or fulfilled orders can be refunded.',
      });
    }
    if (order.amountMinor <= 0n) {
      blockers.push({
        code: 'BILLING_REFUND_ZERO_AMOUNT_ORDER',
        msg: 'Zero-amount internal orders cannot be refunded through a payment provider.',
      });
    }
    if (refundableAmount <= 0n) {
      blockers.push({
        code: 'BILLING_REFUND_NOTHING_REMAINING',
        msg: 'This order has no remaining refundable amount.',
      });
    }

    const paymentIntent = order.paymentIntents[0];
    const providerPaymentIntentId = paymentIntent
      ? providerPaymentIntentIdForRefund(paymentIntent)
      : null;
    if (!paymentIntent || !providerPaymentIntentId) {
      blockers.push({
        code: 'BILLING_REFUND_PAYMENT_INTENT_MISSING',
        msg: 'A succeeded provider payment intent is required before refunding.',
      });
    }

    const requestedPercentBps = input.percentBps ?? null;
    const requestedAmount = resolveRequestedRefundAmount(
      refundableAmount,
      input,
    );
    if (requestedAmount > refundableAmount) {
      blockers.push({
        code: 'BILLING_REFUND_AMOUNT_EXCEEDS_REMAINING',
        msg: 'Refund amount exceeds the remaining refundable amount.',
      });
    }

    const initialPolicy = await this.resolveRefundBenefitPolicyTx(tx, order, {
      requestedAmount,
      activeRefundAmount,
      activeRefunds: order.refunds,
    });

    const maxPolicyRefund =
      initialPolicy.maxPolicyRefund < refundableAmount
        ? initialPolicy.maxPolicyRefund
        : refundableAmount;
    const suggestedAmount = maxPolicyRefund > 0n ? maxPolicyRefund : 0n;
    const finalRequestedAmount =
      input.amountMinor !== undefined || input.percentBps !== undefined
        ? requestedAmount
        : suggestedAmount;
    const policy =
      finalRequestedAmount === requestedAmount
        ? initialPolicy
        : await this.resolveRefundBenefitPolicyTx(tx, order, {
            requestedAmount: finalRequestedAmount,
            activeRefundAmount,
            activeRefunds: order.refunds,
          });
    blockers.push(...policy.blockers);
    warnings.push(...policy.warnings);

    if (finalRequestedAmount <= 0n) {
      blockers.push({
        code: 'BILLING_REFUND_AMOUNT_REQUIRED',
        msg: 'Refund amount must be greater than zero.',
      });
    }
    if (finalRequestedAmount > maxPolicyRefund) {
      blockers.push({
        code: 'BILLING_REFUND_AMOUNT_EXCEEDS_POLICY',
        msg: 'Refund amount exceeds the policy-allowed amount for current entitlement usage.',
      });
    }

    return {
      order: this.refundQuoteOrderDto(order),
      policy: {
        userSelfServiceAllowed: false,
        adminOnly: true,
        providerSupported: order.provider === PaymentProvider.airwallex,
        automaticRefundAllowed: blockers.length === 0,
        calculationMode:
          input.percentBps !== undefined
            ? 'percent'
            : input.amountMinor !== undefined
              ? 'amount'
              : 'suggested',
      },
      refundableAmountMinor: positiveOrZero(refundableAmount).toString(),
      maxPolicyRefundMinor: positiveOrZero(maxPolicyRefund).toString(),
      suggestedAmountMinor: positiveOrZero(suggestedAmount).toString(),
      requestedAmountMinor: positiveOrZero(finalRequestedAmount).toString(),
      requestedPercentBps,
      benefitImpact: policy.benefitImpact,
      blockers: dedupePolicyIssues(blockers),
      warnings: dedupePolicyIssues(warnings),
    };
  }

  private async resolveRefundBenefitPolicyTx(
    tx: Prisma.TransactionClient,
    order: RefundPolicyOrder,
    input: {
      requestedAmount: bigint;
      activeRefundAmount: bigint;
      activeRefunds: BillingRefund[];
    },
  ): Promise<{
    maxPolicyRefund: bigint;
    benefitImpact: RefundPolicyQuote['benefitImpact'];
    blockers: RefundPolicyIssue[];
    warnings: RefundPolicyIssue[];
  }> {
    const refundableAmount = positiveOrZero(
      order.amountMinor - input.activeRefundAmount,
    );
    if (!order.fulfilledAt) {
      return {
        maxPolicyRefund: refundableAmount,
        benefitImpact: {
          type: 'none',
          automaticReversalAllowed: true,
          description:
            'Order is paid but not fulfilled; no virtual entitlement needs reversal before provider refund.',
        },
        blockers: [],
        warnings: [],
      };
    }

    if (order.price.grantsPlanKey) {
      return this.membershipRefundPolicyTx(tx, order, input);
    }

    // Prefer the order grant snapshot; fall back to the live price for legacy
    // orders. Routing off the snapshot means a later price edit can't make a
    // granted order look benefit-less (which would refund fiat without clawing
    // back the credits).
    if (
      (order.grantsWalletCurrency ?? order.price.grantsWalletCurrency) &&
      (order.grantsWalletAmount ?? order.price.grantsWalletAmount)
    ) {
      return this.walletRefundPolicyTx(tx, order, input);
    }

    return {
      maxPolicyRefund: refundableAmount,
      benefitImpact: {
        type: 'none',
        automaticReversalAllowed: true,
        description:
          'Fulfilled order has no platform wallet or membership entitlement attached.',
      },
      blockers: [],
      warnings: [],
    };
  }

  private async walletRefundPolicyTx(
    tx: Prisma.TransactionClient,
    order: RefundPolicyOrder,
    input: {
      requestedAmount: bigint;
      activeRefundAmount: bigint;
      activeRefunds: BillingRefund[];
    },
  ): Promise<{
    maxPolicyRefund: bigint;
    benefitImpact: RefundPolicyQuote['benefitImpact'];
    blockers: RefundPolicyIssue[];
    warnings: RefundPolicyIssue[];
  }> {
    const blockers: RefundPolicyIssue[] = [];
    const warnings: RefundPolicyIssue[] = [];
    // Prefer the per-order grant snapshot (custom recharges carry their grant here;
    // the price only holds the per-$1 ratio); fall back to the price for legacy orders.
    const walletCurrency =
      order.grantsWalletCurrency ?? order.price.grantsWalletCurrency;
    const grantAmount =
      order.grantsWalletAmount ?? order.price.grantsWalletAmount;
    if (!walletCurrency || !grantAmount) {
      return {
        maxPolicyRefund: positiveOrZero(
          order.amountMinor - input.activeRefundAmount,
        ),
        benefitImpact: {
          type: 'none',
          automaticReversalAllowed: true,
          description: 'No wallet grant is attached to this order.',
        },
        blockers,
        warnings,
      };
    }

    const totalGrant = grantAmount * BigInt(order.quantity);
    const alreadyReversed = input.activeRefunds.reduce(
      (sum, refund) => sum + (refund.walletReversalAmount ?? 0n),
      0n,
    );
    const remainingGrant = positiveOrZero(totalGrant - alreadyReversed);
    const walletAccount = await this.findWalletAccountForOrderTx(
      tx,
      order,
      walletCurrency,
    );
    if (!walletAccount) {
      blockers.push({
        code: 'BILLING_REFUND_WALLET_ACCOUNT_MISSING',
        msg: 'The credited wallet account no longer exists.',
      });
    } else if (walletAccount.status !== WalletAccountStatus.active) {
      blockers.push({
        code: 'BILLING_REFUND_WALLET_ACCOUNT_NOT_ACTIVE',
        msg: 'The credited wallet account is not active.',
      });
    }

    const availableBalance = walletAccount?.availableBalance ?? 0n;
    const requestedReversal = calculateWalletRefundReversalAmount({
      order,
      refundAmountMinor: input.requestedAmount,
      activeRefundAmountAfter: input.activeRefundAmount + input.requestedAmount,
      activeRefunds: input.activeRefunds,
    });
    if (requestedReversal > availableBalance) {
      blockers.push({
        code: 'BILLING_REFUND_WALLET_BALANCE_CONSUMED',
        msg: 'Refund is blocked because the granted credits have already been consumed.',
      });
    }

    const maxByWallet =
      totalGrant <= 0n
        ? 0n
        : availableBalance >= remainingGrant
          ? positiveOrZero(order.amountMinor - input.activeRefundAmount)
          : (availableBalance * order.amountMinor) / totalGrant;
    const maxPolicyRefund = minBigInt(
      positiveOrZero(order.amountMinor - input.activeRefundAmount),
      maxByWallet,
    );
    if (maxPolicyRefund <= 0n) {
      blockers.push({
        code: 'BILLING_REFUND_WALLET_NO_AVAILABLE_CREDIT',
        msg: 'No granted credits remain available for automatic reversal.',
      });
    }
    warnings.push({
      code: 'BILLING_REFUND_WALLET_NOT_CASH_VALUE',
      msg: 'Wallet points are not fiat; refund amount is based on the original paid order, while wallet reversal removes the corresponding platform credits.',
    });

    return {
      maxPolicyRefund,
      benefitImpact: {
        type: 'wallet',
        walletCurrency,
        totalGrantedAmount: totalGrant.toString(),
        alreadyReversedAmount: alreadyReversed.toString(),
        requestedReversalAmount: requestedReversal.toString(),
        availableBalance: availableBalance.toString(),
        automaticReversalAllowed: blockers.length === 0,
        description:
          'Automatic refund requires enough available wallet credits to reverse the refunded portion.',
      },
      blockers,
      warnings,
    };
  }

  private async membershipRefundPolicyTx(
    tx: Prisma.TransactionClient,
    order: RefundPolicyOrder,
    input: {
      requestedAmount: bigint;
      activeRefundAmount: bigint;
      activeRefunds: BillingRefund[];
    },
  ): Promise<{
    maxPolicyRefund: bigint;
    benefitImpact: RefundPolicyQuote['benefitImpact'];
    blockers: RefundPolicyIssue[];
    warnings: RefundPolicyIssue[];
  }> {
    const blockers: RefundPolicyIssue[] = [];
    const warnings: RefundPolicyIssue[] = [];
    const planKey = order.price.grantsPlanKey ?? 'membership';
    const grant = await tx.entitlementGrant.findUnique({
      where: {
        sourceType_sourceId: {
          sourceType: 'billing_order',
          sourceId: order.id,
        },
      },
    });
    if (!grant || grant.status !== EntitlementGrantStatus.active) {
      blockers.push({
        code: 'BILLING_REFUND_ENTITLEMENT_NOT_ACTIVE',
        msg: 'The membership entitlement is not active and cannot be automatically refunded.',
      });
    }
    const startsAt = grant?.startsAt ?? order.fulfilledAt ?? order.paidAt;
    const endsAt = grant?.endsAt ?? null;
    if (!startsAt || !endsAt) {
      blockers.push({
        code: 'BILLING_REFUND_MEMBERSHIP_PERIOD_REQUIRED',
        msg: 'Membership refund requires a finite active service period so unused value can be prorated.',
      });
    }

    const now = new Date();
    const unusedBps =
      startsAt && endsAt ? calculateUnusedPeriodBps(startsAt, endsAt, now) : 0;
    const proratedMax =
      (order.amountMinor * BigInt(unusedBps)) / 10_000n -
      input.activeRefundAmount;
    const maxPolicyRefund = minBigInt(
      positiveOrZero(order.amountMinor - input.activeRefundAmount),
      positiveOrZero(proratedMax),
    );
    if (maxPolicyRefund <= 0n) {
      blockers.push({
        code: 'BILLING_REFUND_MEMBERSHIP_NO_UNUSED_VALUE',
        msg: 'Membership has no unused refundable value remaining.',
      });
    }
    if (input.requestedAmount > maxPolicyRefund) {
      blockers.push({
        code: 'BILLING_REFUND_MEMBERSHIP_PRORATION_EXCEEDED',
        msg: 'Membership refund exceeds the unused service-period value.',
      });
    }
    warnings.push({
      code: 'BILLING_REFUND_MEMBERSHIP_REVOKES_REMAINING_ACCESS',
      msg: 'Membership refunds revoke the remaining entitlement; goodwill compensation without revocation should be handled outside provider refunds.',
    });

    return {
      maxPolicyRefund,
      benefitImpact: {
        type: 'membership',
        planKey,
        startsAt: startsAt?.toISOString() ?? new Date(0).toISOString(),
        endsAt: endsAt?.toISOString() ?? null,
        unusedBps,
        revokeEntitlement: true,
        automaticReversalAllowed: blockers.length === 0,
        description:
          'Membership refund is capped by unused service time and revokes remaining access.',
      },
      blockers,
      warnings,
    };
  }

  private async findWalletAccountForOrderTx(
    tx: Prisma.TransactionClient,
    order: RefundPolicyOrder,
    walletCurrency: WalletCurrencyType,
  ): Promise<WalletAccount | null> {
    const ownerType =
      order.subjectType === BillingSubjectType.workspace
        ? WalletOwnerType.workspace
        : WalletOwnerType.user;
    return tx.walletAccount.findUnique({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType,
          ownerId: order.subjectId,
          currency: walletCurrency,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
    });
  }

  private async prepareAdminRefundTx(
    tx: Prisma.TransactionClient,
    adminId: string,
    input: CreateAdminBillingRefundInput,
  ): Promise<{ refund: BillingRefund; providerPaymentIntentId: string }> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`billing:order:${input.orderId}`})::bigint)
    `;

    const order = await this.loadRefundPolicyOrderTx(tx, input.orderId);
    const activeRefundAmount = order.refunds.reduce(
      (sum, refund) => sum + refund.amountMinor,
      0n,
    );
    const quote = await this.buildRefundPolicyQuoteTx(tx, order, input);
    if (quote.blockers.length > 0) {
      const blocker = quote.blockers[0];
      throw new ConflictException({
        code: blocker.code,
        msg: blocker.msg,
        details: quote,
      });
    }
    const refundAmountMinor = BigInt(quote.requestedAmountMinor);

    const paymentIntent = order.paymentIntents[0];
    const providerPaymentIntentId = paymentIntent
      ? providerPaymentIntentIdForRefund(paymentIntent)
      : null;
    if (!paymentIntent || !providerPaymentIntentId) {
      throw new ConflictException({
        code: 'BILLING_REFUND_PAYMENT_INTENT_MISSING',
        msg: 'A succeeded provider payment intent is required before refunding.',
      });
    }

    const refund = await tx.billingRefund.create({
      data: {
        refundNo: createRefundNo(),
        orderId: order.id,
        paymentIntentId: paymentIntent.id,
        provider: order.provider,
        status: BillingRefundStatus.requested,
        idempotencyKey: input.idempotencyKey,
        requestId: randomUUID(),
        providerPaymentIntentId,
        currency: order.currency,
        amountMinor: refundAmountMinor,
        reasonCode: input.reasonCode,
        operatorNote: input.operatorNote || null,
        requestedById: adminId,
        metadata: {
          orderNo: order.orderNo,
          activeRefundAmountMinor: activeRefundAmount.toString(),
          calculationMode: quote.policy.calculationMode,
          requestedPercentBps: quote.requestedPercentBps,
          refundableAmountMinor: quote.refundableAmountMinor,
          maxPolicyRefundMinor: quote.maxPolicyRefundMinor,
          suggestedAmountMinor: quote.suggestedAmountMinor,
          warnings: quote.warnings,
          benefitImpact: quote.benefitImpact,
        },
      },
    });

    const benefitPatch = await this.reserveRefundBenefitsTx(tx, {
      order,
      refund,
      activeRefunds: order.refunds,
      activeRefundAmount,
    });
    const preparedRefund =
      Object.keys(benefitPatch).length > 0
        ? await tx.billingRefund.update({
            where: { id: refund.id },
            data: benefitPatch,
          })
        : refund;

    await this.recordRefundEventTx(tx, {
      refundId: preparedRefund.id,
      eventType: 'admin.refund.requested',
      toStatus: BillingRefundStatus.requested,
      actorAdminId: adminId,
      payload: {
        amountMinor: refundAmountMinor.toString(),
        requestedPercentBps: quote.requestedPercentBps,
        calculationMode: quote.policy.calculationMode,
        reasonCode: input.reasonCode,
      },
    });

    return { refund: preparedRefund, providerPaymentIntentId };
  }

  private async reserveRefundBenefitsTx(
    tx: Prisma.TransactionClient,
    input: {
      order: OrderWithLedgerPrice & { refunds: BillingRefund[] };
      refund: BillingRefund;
      activeRefunds: BillingRefund[];
      activeRefundAmount: bigint;
    },
  ): Promise<Prisma.BillingRefundUpdateInput> {
    const { order, refund } = input;
    if (!order.fulfilledAt) return {};

    const activeAfter = input.activeRefundAmount + refund.amountMinor;
    if (order.price.grantsPlanKey) {
      const grant = await tx.entitlementGrant.findUnique({
        where: {
          sourceType_sourceId: {
            sourceType: 'billing_order',
            sourceId: order.id,
          },
        },
      });
      if (!grant || grant.status !== EntitlementGrantStatus.active) {
        throw new ConflictException({
          code: 'BILLING_REFUND_ENTITLEMENT_NOT_ACTIVE',
          msg: 'The membership entitlement is not active and cannot be automatically refunded.',
        });
      }
      await tx.entitlementGrant.update({
        where: { id: grant.id },
        data: {
          status: EntitlementGrantStatus.revoked,
          revokedAt: new Date(),
          metadata: {
            ...(isRecord(grant.metadata) ? grant.metadata : {}),
            revokedByRefundId: refund.id,
            revokedByRefundNo: refund.refundNo,
            refundedAmountMinor: refund.amountMinor.toString(),
            refundedAmountAfterMinor: activeAfter.toString(),
          },
        },
      });
      return { entitlementGrant: { connect: { id: grant.id } } };
    }

    const grantCurrency =
      order.grantsWalletCurrency ?? order.price.grantsWalletCurrency;
    const grantAmount =
      order.grantsWalletAmount ?? order.price.grantsWalletAmount;
    if (!grantCurrency || !grantAmount) {
      return {};
    }

    const reversalAmount = calculateWalletRefundReversalAmount({
      order,
      refundAmountMinor: refund.amountMinor,
      activeRefundAmountAfter: activeAfter,
      activeRefunds: input.activeRefunds,
    });
    if (reversalAmount <= 0n) return {};

    const walletTransactionId = await this.postWalletRefundReversalTx(tx, {
      order,
      refund,
      amount: reversalAmount,
    });
    return {
      walletReversalCurrency: grantCurrency,
      walletReversalAmount: reversalAmount,
      walletTransaction: { connect: { id: walletTransactionId } },
    };
  }

  private async postWalletRefundReversalTx(
    tx: Prisma.TransactionClient,
    input: {
      order: OrderWithPrice;
      refund: BillingRefund;
      amount: bigint;
    },
  ): Promise<string> {
    // Resolve from the order snapshot (fall back to price) so we reverse from the
    // exact account that was credited at fulfillment, even if the price's grant
    // currency/kind was later changed.
    const walletCurrency =
      input.order.grantsWalletCurrency ??
      input.order.price.grantsWalletCurrency;
    const balanceKind =
      input.order.grantsWalletBalanceKind ??
      input.order.price.grantsWalletBalanceKind ??
      WalletBalanceKind.consumable;
    if (!walletCurrency) {
      throw new ConflictException({
        code: 'BILLING_REFUND_WALLET_CURRENCY_REQUIRED',
        msg: 'Wallet refund reversal requires a wallet currency.',
      });
    }
    const ownerType =
      input.order.subjectType === BillingSubjectType.workspace
        ? WalletOwnerType.workspace
        : WalletOwnerType.user;
    const account = await tx.walletAccount.findUnique({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType,
          ownerId: input.order.subjectId,
          currency: walletCurrency,
          balanceKind,
        },
      },
    });
    if (!account) {
      throw new ConflictException({
        code: 'BILLING_REFUND_WALLET_ACCOUNT_MISSING',
        msg: 'The credited wallet account no longer exists.',
      });
    }
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${account.id}`})::bigint)
    `;
    const locked = await tx.walletAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    if (locked.status !== WalletAccountStatus.active) {
      throw new ConflictException({
        code: 'BILLING_REFUND_WALLET_ACCOUNT_NOT_ACTIVE',
        msg: 'The credited wallet account is not active.',
      });
    }
    if (locked.availableBalance < input.amount) {
      throw new ConflictException({
        code: 'BILLING_REFUND_WALLET_BALANCE_CONSUMED',
        msg: 'Refund is blocked because the granted credits have already been consumed.',
      });
    }
    const existing = await tx.walletTransaction.findUnique({
      where: {
        idempotencyKey: `billing_refund:${input.refund.id}:wallet_reversal`,
      },
    });
    if (existing) return existing.id;

    const nextAvailable = locked.availableBalance - input.amount;
    const transaction = await tx.walletTransaction.create({
      data: {
        status: WalletTransactionStatus.posted,
        sourceType: 'billing_refund',
        sourceId: input.refund.id,
        idempotencyKey: `billing_refund:${input.refund.id}:wallet_reversal`,
        actorUserId: input.order.userId,
        workspaceId: input.order.workspaceId,
        description: `${walletCurrency} reversal for refund ${input.refund.refundNo}`,
        metadata: {
          orderNo: input.order.orderNo,
          refundNo: input.refund.refundNo,
        },
      },
    });
    await tx.walletLedgerEntry.create({
      data: {
        transactionId: transaction.id,
        accountId: locked.id,
        entryType: WalletLedgerEntryType.refund,
        currency: locked.currency,
        balanceKind: locked.balanceKind,
        amount: input.amount,
        availableDelta: -input.amount,
        heldDelta: 0n,
        availableBalanceAfter: nextAvailable,
        heldBalanceAfter: locked.heldBalance,
        reason: `billing_${walletCurrency}_refund_reversal`,
      },
    });
    await tx.walletAccount.update({
      where: { id: locked.id },
      data: {
        availableBalance: nextAvailable,
        version: { increment: 1 },
      },
    });
    return transaction.id;
  }

  private async applyProviderRefundSubmissionTx(
    tx: Prisma.TransactionClient,
    refundId: string,
    result: CreateProviderRefundResult,
  ): Promise<AdminRefundWithRelations> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`billing:refund:${refundId}`})::bigint)
    `;
    const refund = await tx.billingRefund.findUniqueOrThrow({
      where: { id: refundId },
    });
    const providerStatus = result.providerStatus ?? refund.providerStatus;
    await tx.billingRefund.update({
      where: { id: refund.id },
      data: {
        providerRefundId: result.providerRefundId,
        providerPaymentIntentId:
          result.providerPaymentIntentId ?? refund.providerPaymentIntentId,
        providerStatus,
        providerPayload: result.raw as Prisma.InputJsonValue,
        submittedAt: refund.submittedAt ?? new Date(),
        status: providerRefundSucceeded(providerStatus)
          ? refund.status
          : BillingRefundStatus.provider_pending,
      },
    });

    if (providerRefundSucceeded(providerStatus)) {
      return this.finalizeRefundSucceededTx(tx, refund.id, {
        providerStatus,
        payload: result.raw,
      });
    }

    await this.recordRefundEventTx(tx, {
      refundId: refund.id,
      eventType: 'provider.refund.submitted',
      fromStatus: refund.status,
      toStatus: BillingRefundStatus.provider_pending,
      providerStatus,
      payload: result.raw,
    });
    return this.getAdminRefundForTx(tx, refund.id);
  }

  private async markRefundFailedAfterProviderError(
    refundId: string,
    code: string,
    message: string,
  ): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.failRefundTx(tx, refundId, {
        failureCode: code,
        failureMessage: message,
        eventType: 'provider.refund.failed',
      }),
    );
  }

  private async failRefundTx(
    tx: Prisma.TransactionClient,
    refundId: string,
    input: {
      failureCode: string;
      failureMessage: string;
      eventType: string;
      providerEventId?: string | null;
      providerStatus?: string | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<AdminRefundWithRelations> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`billing:refund:${refundId}`})::bigint)
    `;
    const refund = await tx.billingRefund.findUniqueOrThrow({
      where: { id: refundId },
    });
    if (refund.status === BillingRefundStatus.failed) {
      return this.getAdminRefundForTx(tx, refund.id);
    }
    if (refund.status === BillingRefundStatus.succeeded) {
      return this.getAdminRefundForTx(tx, refund.id);
    }

    await this.restoreRefundBenefitsTx(tx, refund);
    const failed = await tx.billingRefund.update({
      where: { id: refund.id },
      data: {
        status: BillingRefundStatus.failed,
        providerStatus: input.providerStatus ?? refund.providerStatus,
        ...(input.payload
          ? { providerPayload: input.payload as Prisma.InputJsonValue }
          : {}),
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
        failedAt: new Date(),
      },
    });
    await this.recordRefundEventTx(tx, {
      refundId: refund.id,
      eventType: input.eventType,
      fromStatus: refund.status,
      toStatus: BillingRefundStatus.failed,
      providerStatus: input.providerStatus,
      providerEventId: input.providerEventId,
      payload: input.payload ?? {
        failureCode: input.failureCode,
        failureMessage: input.failureMessage,
      },
    });
    return this.getAdminRefundForTx(tx, failed.id);
  }

  private async restoreRefundBenefitsTx(
    tx: Prisma.TransactionClient,
    refund: BillingRefund,
  ): Promise<void> {
    if (refund.walletReversalAmount && refund.walletReversalCurrency) {
      await this.restoreWalletRefundReversalTx(tx, refund);
    }
    if (refund.entitlementGrantId) {
      await tx.entitlementGrant.updateMany({
        where: {
          id: refund.entitlementGrantId,
          status: EntitlementGrantStatus.revoked,
        },
        data: {
          status: EntitlementGrantStatus.active,
          revokedAt: null,
        },
      });
    }
  }

  private async restoreWalletRefundReversalTx(
    tx: Prisma.TransactionClient,
    refund: BillingRefund,
  ): Promise<void> {
    if (!refund.walletReversalAmount || !refund.walletReversalCurrency) return;
    const existing = await tx.walletTransaction.findUnique({
      where: {
        idempotencyKey: `billing_refund:${refund.id}:wallet_restore`,
      },
    });
    if (existing) return;

    const order = await tx.billingOrder.findUniqueOrThrow({
      where: { id: refund.orderId },
    });
    const ownerType =
      order.subjectType === BillingSubjectType.workspace
        ? WalletOwnerType.workspace
        : WalletOwnerType.user;
    const account = await tx.walletAccount.findUniqueOrThrow({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType,
          ownerId: order.subjectId,
          currency: refund.walletReversalCurrency,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
    });
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${account.id}`})::bigint)
    `;
    const locked = await tx.walletAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    const nextAvailable = locked.availableBalance + refund.walletReversalAmount;
    const transaction = await tx.walletTransaction.create({
      data: {
        status: WalletTransactionStatus.posted,
        sourceType: 'billing_refund',
        sourceId: refund.id,
        idempotencyKey: `billing_refund:${refund.id}:wallet_restore`,
        actorUserId: order.userId,
        workspaceId: order.workspaceId,
        description: `${refund.walletReversalCurrency} restore after failed refund ${refund.refundNo}`,
        metadata: {
          orderNo: order.orderNo,
          refundNo: refund.refundNo,
        },
      },
    });
    await tx.walletLedgerEntry.create({
      data: {
        transactionId: transaction.id,
        accountId: locked.id,
        entryType: WalletLedgerEntryType.adjustment,
        currency: locked.currency,
        balanceKind: locked.balanceKind,
        amount: refund.walletReversalAmount,
        availableDelta: refund.walletReversalAmount,
        heldDelta: 0n,
        availableBalanceAfter: nextAvailable,
        heldBalanceAfter: locked.heldBalance,
        reason: `billing_${refund.walletReversalCurrency}_refund_restore`,
      },
    });
    await tx.walletAccount.update({
      where: { id: locked.id },
      data: {
        availableBalance: nextAvailable,
        version: { increment: 1 },
      },
    });
  }

  private async finalizeRefundSucceededTx(
    tx: Prisma.TransactionClient,
    refundId: string,
    input: {
      providerEventId?: string | null;
      providerStatus?: string | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<AdminRefundWithRelations> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`billing:refund:${refundId}`})::bigint)
    `;
    const refund = await tx.billingRefund.findUniqueOrThrow({
      where: { id: refundId },
    });
    if (refund.status === BillingRefundStatus.succeeded) {
      return this.getAdminRefundForTx(tx, refund.id);
    }
    if (refund.status === BillingRefundStatus.failed) {
      return this.getAdminRefundForTx(tx, refund.id);
    }

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`billing:order:${refund.orderId}`})::bigint)
    `;
    const order = await tx.billingOrder.findUniqueOrThrow({
      where: { id: refund.orderId },
      include: {
        price: {
          include: {
            ledgerAllocations: {
              where: { archivedAt: null },
              orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
            },
          },
        },
      },
    });
    const nextRefundedAmount = order.refundedAmountMinor + refund.amountMinor;
    if (nextRefundedAmount > order.amountMinor) {
      throw new ConflictException({
        code: 'BILLING_REFUND_AMOUNT_EXCEEDS_ORDER',
        msg: 'Refund amount exceeds the order amount.',
      });
    }
    const paymentIntent = refund.paymentIntentId
      ? await tx.billingPaymentIntent.findUnique({
          where: { id: refund.paymentIntentId },
        })
      : null;

    await this.ledger.postRefundTx(tx, {
      refund,
      order,
      paymentIntent,
      providerEventId: input.providerEventId,
      payload: input.payload,
      postedAt: new Date(),
    });

    const fullRefund = nextRefundedAmount === order.amountMinor;
    await tx.billingOrder.update({
      where: { id: order.id },
      data: {
        refundedAmountMinor: nextRefundedAmount,
        status: fullRefund
          ? BillingOrderStatus.refunded
          : BillingOrderStatus.partially_refunded,
        version: { increment: 1 },
      },
    });
    if (fullRefund) {
      await tx.billingPromotionRedemption.updateMany({
        where: {
          orderId: order.id,
          status: BillingPromotionRedemptionStatus.applied,
        },
        data: { status: BillingPromotionRedemptionStatus.refunded },
      });
    }

    await tx.billingRefund.update({
      where: { id: refund.id },
      data: {
        status: BillingRefundStatus.succeeded,
        providerStatus: input.providerStatus ?? refund.providerStatus,
        ...(input.payload
          ? { providerPayload: input.payload as Prisma.InputJsonValue }
          : {}),
        succeededAt: new Date(),
      },
    });
    await this.recordRefundEventTx(tx, {
      refundId: refund.id,
      eventType: 'provider.refund.succeeded',
      fromStatus: refund.status,
      toStatus: BillingRefundStatus.succeeded,
      providerStatus: input.providerStatus,
      providerEventId: input.providerEventId,
      payload: input.payload ?? {},
    });
    return this.getAdminRefundForTx(tx, refund.id);
  }

  private async recordRefundEventTx(
    tx: Prisma.TransactionClient,
    input: {
      refundId: string;
      eventType: string;
      fromStatus?: BillingRefundStatus | null;
      toStatus?: BillingRefundStatus | null;
      providerStatus?: string | null;
      providerEventId?: string | null;
      actorAdminId?: string | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<void> {
    await tx.billingRefundEvent.create({
      data: {
        refundId: input.refundId,
        eventType: input.eventType,
        fromStatus: input.fromStatus ?? null,
        toStatus: input.toStatus ?? null,
        providerStatus: input.providerStatus ?? null,
        providerEventId: input.providerEventId ?? null,
        actorAdminId: input.actorAdminId ?? null,
        payload: (input.payload ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  private async getAdminRefundForTx(
    tx: Prisma.TransactionClient,
    refundId: string,
  ): Promise<AdminRefundWithRelations> {
    return tx.billingRefund.findUniqueOrThrow({
      where: { id: refundId },
      include: {
        order: { include: { item: true } },
        paymentIntent: true,
      },
    });
  }

  private async reserveCheckoutPromotionTx(
    tx: Prisma.TransactionClient,
    input: {
      userId: string;
      provider: PaymentProvider;
      code: string;
      price: PriceWithProviderBindings;
      subtotalAmountMinor: bigint;
      now: Date;
    },
  ): Promise<CheckoutPromotionReservation> {
    const code = input.code.trim().toUpperCase();
    const promotion = await tx.billingPromotion.findUnique({
      where: { code },
      include: {
        providerBindings: {
          where: {
            provider: input.provider,
            status: BillingProviderBindingStatus.active,
            archivedAt: null,
          },
          take: 1,
        },
      },
    });
    if (!promotion) {
      throw new BadRequestException({
        code: 'BILLING_PROMOTION_NOT_FOUND',
        msg: 'Promotion code is invalid.',
      });
    }

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`billing:promotion:${promotion.id}`})::bigint)
    `;

    if (
      promotion.status !== BillingPromotionStatus.active ||
      promotion.archivedAt ||
      (promotion.startsAt && promotion.startsAt > input.now) ||
      (promotion.endsAt && promotion.endsAt <= input.now)
    ) {
      throw new BadRequestException({
        code: 'BILLING_PROMOTION_NOT_ACTIVE',
        msg: 'Promotion code is not active.',
      });
    }
    if (
      promotion.appliesPriceId &&
      promotion.appliesPriceId !== input.price.id
    ) {
      throw new BadRequestException({
        code: 'BILLING_PROMOTION_PRICE_MISMATCH',
        msg: 'Promotion code is not valid for this price.',
      });
    }
    if (
      promotion.appliesItemId &&
      promotion.appliesItemId !== input.price.itemId
    ) {
      throw new BadRequestException({
        code: 'BILLING_PROMOTION_ITEM_MISMATCH',
        msg: 'Promotion code is not valid for this product.',
      });
    }
    if (
      promotion.appliesProductType &&
      promotion.appliesProductType !== input.price.item.productType
    ) {
      throw new BadRequestException({
        code: 'BILLING_PROMOTION_PRODUCT_TYPE_MISMATCH',
        msg: 'Promotion code is not valid for this product type.',
      });
    }
    if (
      promotion.maxRedemptions !== null &&
      promotion.redemptionCount >= promotion.maxRedemptions
    ) {
      throw new ConflictException({
        code: 'BILLING_PROMOTION_REDEMPTION_LIMIT_REACHED',
        msg: 'Promotion redemption limit has been reached.',
      });
    }
    if (promotion.maxRedemptionsPerUser !== null) {
      const userRedemptions = await tx.billingPromotionRedemption.count({
        where: {
          promotionId: promotion.id,
          userId: input.userId,
          status: {
            in: [
              BillingPromotionRedemptionStatus.reserved,
              BillingPromotionRedemptionStatus.applied,
            ],
          },
        },
      });
      if (userRedemptions >= promotion.maxRedemptionsPerUser) {
        throw new ConflictException({
          code: 'BILLING_PROMOTION_USER_LIMIT_REACHED',
          msg: 'Promotion redemption limit for this user has been reached.',
        });
      }
    }

    const discountAmountMinor = calculatePromotionDiscount(
      promotion,
      input.subtotalAmountMinor,
    );
    if (discountAmountMinor <= 0n) {
      throw new BadRequestException({
        code: 'BILLING_PROMOTION_DISCOUNT_INVALID',
        msg: 'Promotion code does not produce a valid discount.',
      });
    }

    const requiresExternalCoupon =
      input.subtotalAmountMinor - discountAmountMinor > 0n;
    const providerCouponId =
      promotion.providerBindings[0]?.providerCouponId ?? null;
    if (requiresExternalCoupon && !providerCouponId) {
      throw new ConflictException({
        code: 'BILLING_PROMOTION_PROVIDER_BINDING_MISSING',
        msg: `Promotion code is not synced to "${input.provider}".`,
      });
    }

    return {
      promotion,
      discountAmountMinor,
      providerCouponId,
    };
  }

  private async voidReservedPromotionsForOrderTx(
    tx: Prisma.TransactionClient,
    orderId: string,
  ): Promise<void> {
    const redemptions = await tx.billingPromotionRedemption.findMany({
      where: {
        orderId,
        status: BillingPromotionRedemptionStatus.reserved,
      },
      select: { id: true, promotionId: true },
    });
    if (redemptions.length === 0) return;
    await tx.billingPromotionRedemption.updateMany({
      where: { id: { in: redemptions.map((redemption) => redemption.id) } },
      data: {
        status: BillingPromotionRedemptionStatus.voided,
        voidedAt: new Date(),
      },
    });
    for (const redemption of redemptions) {
      await tx.billingPromotion.update({
        where: { id: redemption.promotionId },
        data: { redemptionCount: { decrement: 1 } },
      });
    }
  }

  private async markOrderPaidAndFulfill(
    tx: Prisma.TransactionClient,
    order: OrderWithPrice,
    now: Date,
    paymentIntent?: BillingPaymentIntent | null,
    providerEventId?: string | null,
    payload?: Record<string, unknown>,
  ): Promise<void> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`billing:order:${order.id}`})::bigint)
    `;

    const current: OrderWithLedgerPrice =
      await tx.billingOrder.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          price: {
            include: {
              ledgerAllocations: {
                where: { archivedAt: null },
                orderBy: [{ priority: 'asc' }, { createdAt: 'asc' }],
              },
            },
          },
        },
      });
    if (current.status === BillingOrderStatus.fulfilled) return;

    await tx.billingOrder.update({
      where: { id: current.id },
      data: {
        status: BillingOrderStatus.paid,
        paidAt: current.paidAt ?? now,
        version: { increment: 1 },
      },
    });

    if (current.amountMinor > 0n) {
      await this.ledger.postPaymentCaptureTx(tx, {
        order: current,
        paymentIntent,
        providerEventId,
        payload,
        postedAt: now,
      });
    }

    let walletTransactionId: string | null = null;
    if (current.grantsWalletAmount ?? current.price.grantsWalletAmount) {
      walletTransactionId = await this.creditWalletGrantForOrderTx(tx, current);
    }
    let entitlementGrantId: string | null = null;
    if (current.price.grantsPlanKey) {
      const grant = await tx.entitlementGrant.upsert({
        where: {
          sourceType_sourceId: {
            sourceType: 'billing_order',
            sourceId: current.id,
          },
        },
        create: {
          subjectType: current.subjectType,
          subjectId: current.subjectId,
          planKey: current.price.grantsPlanKey,
          status: EntitlementGrantStatus.active,
          sourceType: 'billing_order',
          sourceId: current.id,
          startsAt: now,
          endsAt: grantEndsAt(now, current.price.grantDurationDays),
          metadata: {
            orderNo: current.orderNo,
            priceId: current.priceId,
          },
        },
        update: {
          status: EntitlementGrantStatus.active,
          startsAt: now,
          endsAt: grantEndsAt(now, current.price.grantDurationDays),
        },
      });
      entitlementGrantId = grant.id;
    }

    if (current.amountMinor > 0n) {
      await this.ledger.postFulfillmentAllocationTx(tx, {
        order: current,
        walletTransactionId,
        entitlementGrantId,
        postedAt: now,
      });
    }

    await tx.billingOrder.update({
      where: { id: current.id },
      data: {
        status: BillingOrderStatus.fulfilled,
        fulfilledAt: now,
        version: { increment: 1 },
      },
    });
    await tx.billingPromotionRedemption.updateMany({
      where: {
        orderId: current.id,
        status: BillingPromotionRedemptionStatus.reserved,
      },
      data: {
        status: BillingPromotionRedemptionStatus.applied,
        appliedAt: now,
      },
    });
  }

  private async upsertSubscriptionFromProviderEvent(
    tx: Prisma.TransactionClient,
    order: OrderWithPrice,
    providerSubscriptionId: string,
    payload: Record<string, unknown>,
    now: Date,
  ): Promise<void> {
    const currentPeriodStart =
      dateAt(payload, ['data', 'current_period_start']) ??
      dateAt(payload, ['data', 'period_start']);
    const currentPeriodEnd =
      dateAt(payload, ['data', 'current_period_end']) ??
      dateAt(payload, ['data', 'period_end']);
    const existing = await tx.billingSubscription.findFirst({
      where: {
        provider: order.provider,
        providerSubscriptionId,
      },
    });
    const data = {
      userId: order.userId,
      workspaceId: order.workspaceId,
      subjectType: order.subjectType,
      subjectId: order.subjectId,
      provider: order.provider,
      providerSubscriptionId,
      status: BillingSubscriptionStatus.active,
      priceId: order.priceId,
      planKey: order.price.grantsPlanKey,
      currentPeriodStart: currentPeriodStart ?? now,
      currentPeriodEnd,
      metadata: {
        initialOrderId: order.id,
        initialOrderNo: order.orderNo,
      },
    };
    if (existing) {
      await tx.billingSubscription.update({
        where: { id: existing.id },
        data,
      });
      return;
    }
    await tx.billingSubscription.create({ data });
  }

  private async creditWalletGrantForOrderTx(
    tx: Prisma.TransactionClient,
    order: OrderWithPrice,
  ): Promise<string | null> {
    // Prefer the per-order snapshot (set at checkout); fall back to the live price
    // for legacy orders created before the snapshot existed. The snapshot is what
    // makes the grant immune to price drift and lets custom amounts carry their own
    // grant. Total credited = per-unit grant * quantity (quantity = 1 for custom).
    const grantCurrency =
      order.grantsWalletCurrency ?? order.price.grantsWalletCurrency;
    const grantPerUnit =
      order.grantsWalletAmount ?? order.price.grantsWalletAmount;
    const grantBalanceKind =
      order.grantsWalletBalanceKind ??
      order.price.grantsWalletBalanceKind ??
      WalletBalanceKind.consumable;
    if (!grantCurrency || !grantPerUnit) {
      return null;
    }
    const ownerType =
      order.subjectType === BillingSubjectType.workspace
        ? WalletOwnerType.workspace
        : WalletOwnerType.user;

    const account = await tx.walletAccount.upsert({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType,
          ownerId: order.subjectId,
          currency: grantCurrency,
          balanceKind: grantBalanceKind,
        },
      },
      create: {
        ownerType,
        ownerId: order.subjectId,
        currency: grantCurrency,
        balanceKind: grantBalanceKind,
        status: WalletAccountStatus.active,
      },
      update: {},
    });

    const idempotencyKey = `billing_order:${order.id}:wallet_grant:${grantCurrency}`;
    const existing = await tx.walletTransaction.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing.id;

    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${account.id}`})::bigint)
    `;

    const lockedAccount = await tx.walletAccount.findUniqueOrThrow({
      where: { id: account.id },
    });
    if (lockedAccount.status !== WalletAccountStatus.active) {
      throw new ConflictException({
        code: 'WALLET_ACCOUNT_NOT_ACTIVE',
        msg: 'Wallet account is not active.',
      });
    }

    const amount = grantPerUnit * BigInt(order.quantity);
    const nextAvailable = lockedAccount.availableBalance + amount;
    const transaction = await tx.walletTransaction.create({
      data: {
        status: WalletTransactionStatus.posted,
        sourceType: 'billing_order',
        sourceId: order.id,
        idempotencyKey,
        actorUserId: order.userId,
        workspaceId: order.workspaceId,
        description: `${grantCurrency} top-up from order ${order.orderNo}`,
        metadata: {
          orderNo: order.orderNo,
          priceId: order.priceId,
        },
      },
    });

    await tx.walletLedgerEntry.create({
      data: {
        transactionId: transaction.id,
        accountId: lockedAccount.id,
        entryType: WalletLedgerEntryType.credit,
        currency: lockedAccount.currency,
        balanceKind: lockedAccount.balanceKind,
        amount,
        availableDelta: amount,
        heldDelta: 0n,
        availableBalanceAfter: nextAvailable,
        heldBalanceAfter: lockedAccount.heldBalance,
        reason: `billing_${grantCurrency}_topup`,
      },
    });

    await tx.walletAccount.update({
      where: { id: lockedAccount.id },
      data: {
        availableBalance: nextAvailable,
        version: { increment: 1 },
      },
    });
    return transaction.id;
  }

  private async matchPaymentIntent(
    tx: Prisma.TransactionClient,
    payload: Record<string, unknown>,
  ): Promise<BillingPaymentIntent | null> {
    const providerCheckoutId =
      stringAt(payload, ['data', 'billing_checkout_id']) ??
      stringAt(payload, ['data', 'checkout_id']) ??
      (eventTypeFromPayload(payload).startsWith('billing_checkout.')
        ? stringAt(payload, ['data', 'id'])
        : null);
    const providerPaymentIntentId =
      stringAt(payload, ['data', 'payment_intent_id']) ??
      (eventTypeFromPayload(payload).startsWith('payment_intent.')
        ? stringAt(payload, ['data', 'id'])
        : null);
    const providerInvoiceId =
      stringAt(payload, ['data', 'invoice_id']) ??
      (eventTypeFromPayload(payload).startsWith('invoice.')
        ? stringAt(payload, ['data', 'id'])
        : null);
    const orderId = stringAt(payload, [
      'data',
      'metadata',
      'fizzdragon_order_id',
    ]);

    const or: Prisma.BillingPaymentIntentWhereInput[] = [];
    if (orderId) or.push({ orderId });
    if (providerCheckoutId) or.push({ providerCheckoutId });
    if (providerPaymentIntentId) or.push({ providerPaymentIntentId });
    if (providerInvoiceId) or.push({ providerInvoiceId });

    if (or.length === 0) return null;

    return tx.billingPaymentIntent.findFirst({
      where: {
        provider: PaymentProvider.airwallex,
        OR: or,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async matchRefund(
    tx: Prisma.TransactionClient,
    payload: Record<string, unknown>,
  ): Promise<BillingRefund | null> {
    const eventType = eventTypeFromPayload(payload);
    const providerRefundId =
      stringAt(payload, ['data', 'refund_id']) ??
      (eventType.startsWith('refund.')
        ? stringAt(payload, ['data', 'id'])
        : null);
    const requestId = stringAt(payload, ['data', 'request_id']);
    const providerPaymentIntentId = stringAt(payload, [
      'data',
      'payment_intent_id',
    ]);

    const or: Prisma.BillingRefundWhereInput[] = [];
    if (providerRefundId) or.push({ providerRefundId });
    if (requestId) or.push({ requestId });
    if (providerPaymentIntentId) {
      or.push({ providerPaymentIntentId });
    }
    if (or.length === 0) return null;

    return tx.billingRefund.findFirst({
      where: {
        provider: PaymentProvider.airwallex,
        OR: or,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async resolveCheckoutSubject(
    user: AuthUser,
    price: PriceWithItem,
    input: CreateBillingCheckoutInput,
  ): Promise<{
    subjectType: BillingSubjectType;
    subjectId: string;
    workspaceId: string | null;
  }> {
    if (price.subjectType === BillingSubjectType.workspace) {
      if (!input.workspaceId) {
        throw new BadRequestException({
          code: 'WORKSPACE_REQUIRED_FOR_TEAM_PRICE',
          msg: 'A workspace id is required for this billing price.',
        });
      }
      await this.permissions.requireWorkspaceRole(
        user.userId,
        input.workspaceId,
        WorkspaceMemberRole.billing,
      );
      return {
        subjectType: BillingSubjectType.workspace,
        subjectId: input.workspaceId,
        workspaceId: input.workspaceId,
      };
    }

    return {
      subjectType: BillingSubjectType.user,
      subjectId: user.userId,
      workspaceId: null,
    };
  }

  private assertReturnUrlAllowed(rawUrl: string): void {
    const url = new URL(rawUrl);
    const allowed = allowedReturnOrigins();
    if (!allowed.has(url.origin)) {
      throw new BadRequestException({
        code: 'BILLING_RETURN_URL_NOT_ALLOWED',
        msg: 'Billing return URL origin is not allowed.',
      });
    }
  }

  private priceDto(
    price: PriceWithProviderBindings,
    provider: PaymentProvider,
  ) {
    return {
      id: price.id,
      itemId: price.itemId,
      productType: price.item.productType,
      code: price.item.code,
      name: price.item.name,
      description: price.item.description,
      provider,
      availableProviders: price.providerBindings.map((binding) => ({
        provider: binding.provider,
        status: binding.status,
        providerMode: binding.providerMode,
      })),
      currency: price.currency,
      amountMinor: price.amountMinor.toString(),
      interval: price.interval,
      subjectType: price.subjectType,
      grantsWalletCurrency: price.grantsWalletCurrency,
      grantsWalletBalanceKind: price.grantsWalletBalanceKind,
      grantsWalletAmount: price.grantsWalletAmount?.toString() ?? null,
      grantsPlanKey: price.grantsPlanKey,
      grantDurationDays: price.grantDurationDays,
      isActive: price.isActive && price.item.isActive,
      metadata: price.metadata,
    };
  }

  private async getAdminPrice(priceId: string) {
    const price = await this.prisma.billingPrice.findUniqueOrThrow({
      where: { id: priceId },
      include: {
        item: true,
        providerBindings: {
          where: { archivedAt: null },
          orderBy: [{ provider: 'asc' }, { createdAt: 'desc' }],
        },
        _count: { select: { orders: true, subscriptions: true } },
      },
    });
    return this.adminPriceDto(price);
  }

  private async getAdminProviderEvent(eventId: string) {
    const event = await this.prisma.billingPaymentProviderEvent.findUnique({
      where: { id: eventId },
      include: {
        paymentIntent: { include: { order: true } },
        refund: { include: { order: true } },
        ledgerJournals: {
          select: {
            id: true,
            journalNo: true,
            journalType: true,
            status: true,
          },
          orderBy: { postedAt: 'desc' },
          take: 3,
        },
      },
    });
    if (!event) {
      throw new NotFoundException({
        code: 'BILLING_PROVIDER_EVENT_NOT_FOUND',
        msg: 'Billing provider event not found.',
      });
    }
    return this.adminProviderEventDto(event);
  }

  private adminPriceDto(
    price: BillingPrice & {
      item: BillingCatalogItem;
      providerBindings: BillingProviderPriceBinding[];
      _count: { orders: number; subscriptions: number };
    },
  ) {
    return {
      id: price.id,
      itemId: price.itemId,
      code: price.item.code,
      name: price.item.name,
      productType: price.item.productType,
      description: price.item.description,
      currency: price.currency,
      amountMinor: price.amountMinor.toString(),
      interval: price.interval,
      subjectType: price.subjectType,
      grantsWalletCurrency: price.grantsWalletCurrency,
      grantsWalletBalanceKind: price.grantsWalletBalanceKind,
      grantsWalletAmount: price.grantsWalletAmount?.toString() ?? null,
      grantsPlanKey: price.grantsPlanKey,
      grantDurationDays: price.grantDurationDays,
      isActive: price.isActive && price.item.isActive,
      archivedAt: price.archivedAt?.toISOString() ?? null,
      providerBindings: price.providerBindings.map((binding) => ({
        id: binding.id,
        provider: binding.provider,
        status: binding.status,
        providerProductId: binding.providerProductId,
        providerPriceId: binding.providerPriceId,
        providerMode: binding.providerMode,
        syncError: binding.syncError,
        lastSyncedAt: binding.lastSyncedAt?.toISOString() ?? null,
        archivedAt: binding.archivedAt?.toISOString() ?? null,
      })),
      counts: {
        orders: price._count.orders,
        subscriptions: price._count.subscriptions,
      },
      updatedAt: price.updatedAt.toISOString(),
    };
  }

  private adminPromotionDto(promotion: PromotionWithBindings) {
    return {
      id: promotion.id,
      code: promotion.code,
      name: promotion.name,
      description: promotion.description,
      status: promotion.status,
      percentOffBps: promotion.percentOffBps,
      durationType: promotion.durationType,
      durationCount: promotion.durationCount,
      durationUnit: promotion.durationUnit,
      appliesProductType: promotion.appliesProductType,
      appliesItem: promotion.appliesItem
        ? {
            id: promotion.appliesItem.id,
            code: promotion.appliesItem.code,
            name: promotion.appliesItem.name,
            productType: promotion.appliesItem.productType,
          }
        : null,
      appliesPrice: promotion.appliesPrice
        ? {
            id: promotion.appliesPrice.id,
            code: promotion.appliesPrice.item.code,
            name: promotion.appliesPrice.item.name,
            currency: promotion.appliesPrice.currency,
            amountMinor: promotion.appliesPrice.amountMinor.toString(),
          }
        : null,
      startsAt: promotion.startsAt?.toISOString() ?? null,
      endsAt: promotion.endsAt?.toISOString() ?? null,
      maxRedemptions: promotion.maxRedemptions,
      maxRedemptionsPerUser: promotion.maxRedemptionsPerUser,
      redemptionCount: promotion.redemptionCount,
      archivedAt: promotion.archivedAt?.toISOString() ?? null,
      providerBindings: promotion.providerBindings.map((binding) => ({
        id: binding.id,
        provider: binding.provider,
        status: binding.status,
        providerCouponId: binding.providerCouponId,
        syncError: binding.syncError,
        lastSyncedAt: binding.lastSyncedAt?.toISOString() ?? null,
        archivedAt: binding.archivedAt?.toISOString() ?? null,
      })),
      counts: { redemptions: promotion._count.redemptions },
      updatedAt: promotion.updatedAt.toISOString(),
    };
  }

  private orderDto(order: BillingOrder) {
    return {
      id: order.id,
      orderNo: order.orderNo,
      idempotencyKey: order.idempotencyKey,
      status: order.status,
      orderType: order.orderType,
      userId: order.userId,
      workspaceId: order.workspaceId,
      subjectType: order.subjectType,
      subjectId: order.subjectId,
      providerBindingId: order.providerBindingId,
      provider: order.provider,
      currency: order.currency,
      subtotalAmountMinor: order.subtotalAmountMinor.toString(),
      discountAmountMinor: order.discountAmountMinor.toString(),
      amountMinor: order.amountMinor.toString(),
      refundedAmountMinor: order.refundedAmountMinor.toString(),
      refundableAmountMinor: (
        order.amountMinor - order.refundedAmountMinor
      ).toString(),
      quantity: order.quantity,
      grantsWalletAmount: order.grantsWalletAmount?.toString() ?? null,
      grantsWalletCurrency: order.grantsWalletCurrency,
      grantsWalletBalanceKind: order.grantsWalletBalanceKind,
      description: order.description,
      paidAt: order.paidAt?.toISOString() ?? null,
      fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
      expiresAt: order.expiresAt?.toISOString() ?? null,
      createdAt: order.createdAt.toISOString(),
      updatedAt: order.updatedAt.toISOString(),
    };
  }

  private paymentIntentDto(intent: BillingPaymentIntent) {
    return {
      id: intent.id,
      orderId: intent.orderId,
      provider: intent.provider,
      kind: intent.kind,
      status: intent.status,
      checkoutUrl: intent.checkoutUrl,
      clientSecret: intent.clientSecret,
      providerPaymentIntentId: intent.providerPaymentIntentId,
      providerStatus: intent.providerStatus,
      expiresAt: intent.expiresAt?.toISOString() ?? null,
      completedAt: intent.completedAt?.toISOString() ?? null,
      createdAt: intent.createdAt.toISOString(),
      updatedAt: intent.updatedAt.toISOString(),
    };
  }

  private adminOrderDto(order: AdminOrderWithRelations) {
    const latestIntent = order.paymentIntents[0] ?? null;
    return {
      ...this.orderDto(order),
      item: {
        id: order.item.id,
        code: order.item.code,
        name: order.item.name,
        productType: order.item.productType,
      },
      price: {
        id: order.price.id,
        interval: order.price.interval,
        grantsWalletCurrency: order.price.grantsWalletCurrency,
        grantsWalletBalanceKind: order.price.grantsWalletBalanceKind,
        grantsWalletAmount: order.price.grantsWalletAmount?.toString() ?? null,
        grantsPlanKey: order.price.grantsPlanKey,
        grantDurationDays: order.price.grantDurationDays,
      },
      paymentIntent: latestIntent ? this.paymentIntentDto(latestIntent) : null,
      refunds: order.refunds.map((refund) => ({
        id: refund.id,
        refundNo: refund.refundNo,
        status: refund.status,
        amountMinor: refund.amountMinor.toString(),
        reasonCode: refund.reasonCode,
        providerStatus: refund.providerStatus,
        createdAt: refund.createdAt.toISOString(),
      })),
    };
  }

  private refundQuoteOrderDto(order: RefundPolicyOrder): RefundQuoteOrderDto {
    return {
      id: order.id,
      orderNo: order.orderNo,
      status: order.status,
      orderType: order.orderType,
      provider: order.provider,
      currency: order.currency,
      amountMinor: order.amountMinor.toString(),
      refundedAmountMinor: order.refundedAmountMinor.toString(),
      userId: order.userId,
      subjectType: order.subjectType,
      subjectId: order.subjectId,
      paidAt: order.paidAt?.toISOString() ?? null,
      fulfilledAt: order.fulfilledAt?.toISOString() ?? null,
      item: {
        id: order.item.id,
        code: order.item.code,
        name: order.item.name,
        productType: order.item.productType,
      },
      price: {
        id: order.price.id,
        grantsWalletCurrency: order.price.grantsWalletCurrency,
        grantsWalletAmount: order.price.grantsWalletAmount?.toString() ?? null,
        grantsPlanKey: order.price.grantsPlanKey,
        grantDurationDays: order.price.grantDurationDays,
      },
    };
  }

  private adminRefundDto(refund: AdminRefundWithRelations) {
    return {
      id: refund.id,
      refundNo: refund.refundNo,
      orderId: refund.orderId,
      orderNo: refund.order.orderNo,
      paymentIntentId: refund.paymentIntentId,
      provider: refund.provider,
      status: refund.status,
      idempotencyKey: refund.idempotencyKey,
      requestId: refund.requestId,
      providerRefundId: refund.providerRefundId,
      providerPaymentIntentId: refund.providerPaymentIntentId,
      providerStatus: refund.providerStatus,
      currency: refund.currency,
      amountMinor: refund.amountMinor.toString(),
      reasonCode: refund.reasonCode,
      operatorNote: refund.operatorNote,
      walletReversalCurrency: refund.walletReversalCurrency,
      walletReversalAmount: refund.walletReversalAmount?.toString() ?? null,
      walletTransactionId: refund.walletTransactionId,
      entitlementGrantId: refund.entitlementGrantId,
      failureCode: refund.failureCode,
      failureMessage: refund.failureMessage,
      requestedById: refund.requestedById,
      submittedAt: refund.submittedAt?.toISOString() ?? null,
      succeededAt: refund.succeededAt?.toISOString() ?? null,
      failedAt: refund.failedAt?.toISOString() ?? null,
      createdAt: refund.createdAt.toISOString(),
      updatedAt: refund.updatedAt.toISOString(),
      order: {
        id: refund.order.id,
        orderNo: refund.order.orderNo,
        userId: refund.order.userId,
        subjectType: refund.order.subjectType,
        subjectId: refund.order.subjectId,
        status: refund.order.status,
        currency: refund.order.currency,
        amountMinor: refund.order.amountMinor.toString(),
        refundedAmountMinor: refund.order.refundedAmountMinor.toString(),
        item: {
          id: refund.order.item.id,
          code: refund.order.item.code,
          name: refund.order.item.name,
          productType: refund.order.item.productType,
        },
      },
      paymentIntent: refund.paymentIntent
        ? this.paymentIntentDto(refund.paymentIntent)
        : null,
    };
  }

  private adminProviderEventDto(event: AdminProviderEventWithRelations) {
    const payload = providerPayloadRecordOrNull(event.payload);
    const order = event.paymentIntent?.order ?? event.refund?.order ?? null;
    return {
      id: event.id,
      provider: event.provider,
      providerEventId: event.providerEventId,
      eventType: event.eventType,
      status: event.status,
      orderId: event.orderId,
      paymentIntentId: event.paymentIntentId,
      refundId: event.refundId,
      error: event.error,
      receivedAt: event.receivedAt.toISOString(),
      processedAt: event.processedAt?.toISOString() ?? null,
      order: order
        ? {
            id: order.id,
            orderNo: order.orderNo,
            status: order.status,
            userId: order.userId,
            currency: order.currency,
            amountMinor: order.amountMinor.toString(),
          }
        : null,
      paymentIntent: event.paymentIntent
        ? {
            id: event.paymentIntent.id,
            status: event.paymentIntent.status,
            providerStatus: event.paymentIntent.providerStatus,
            providerCheckoutId: event.paymentIntent.providerCheckoutId,
            providerPaymentIntentId:
              event.paymentIntent.providerPaymentIntentId,
            completedAt: event.paymentIntent.completedAt?.toISOString() ?? null,
          }
        : null,
      refund: event.refund
        ? {
            id: event.refund.id,
            refundNo: event.refund.refundNo,
            status: event.refund.status,
            providerRefundId: event.refund.providerRefundId,
            providerStatus: event.refund.providerStatus,
            currency: event.refund.currency,
            amountMinor: event.refund.amountMinor.toString(),
          }
        : null,
      payloadSummary: payload ? providerEventPayloadSummary(payload) : null,
      ledgerJournals: event.ledgerJournals.map((journal) => ({
        id: journal.id,
        journalNo: journal.journalNo,
        journalType: journal.journalType,
        status: journal.status,
      })),
    };
  }
}

function calculatePromotionDiscount(
  promotion: BillingPromotion,
  subtotalAmountMinor: bigint,
): bigint {
  const percentOffBps = BigInt(promotion.percentOffBps);
  const discountAmountMinor = (subtotalAmountMinor * percentOffBps) / 10000n;
  if (discountAmountMinor > subtotalAmountMinor) {
    return subtotalAmountMinor;
  }
  return discountAmountMinor;
}

function activeRefundStatuses(): BillingRefundStatus[] {
  return [
    BillingRefundStatus.requested,
    BillingRefundStatus.provider_pending,
    BillingRefundStatus.succeeded,
  ];
}

function resolveRequestedRefundAmount(
  refundableAmount: bigint,
  input: { amountMinor?: bigint; percentBps?: number },
): bigint {
  if (input.amountMinor !== undefined) return input.amountMinor;
  if (input.percentBps !== undefined) {
    if (refundableAmount <= 0n) return 0n;
    return (refundableAmount * BigInt(input.percentBps)) / 10_000n;
  }
  return 0n;
}

function positiveOrZero(value: bigint): bigint {
  return value > 0n ? value : 0n;
}

function minBigInt(left: bigint, right: bigint): bigint {
  return left < right ? left : right;
}

function calculateUnusedPeriodBps(
  startsAt: Date,
  endsAt: Date,
  now: Date,
): number {
  const total = endsAt.getTime() - startsAt.getTime();
  if (total <= 0) return 0;
  const remaining = endsAt.getTime() - now.getTime();
  if (remaining <= 0) return 0;
  if (remaining >= total) return 10_000;
  return Math.floor((remaining * 10_000) / total);
}

function dedupePolicyIssues(issues: RefundPolicyIssue[]): RefundPolicyIssue[] {
  const seen = new Set<string>();
  return issues.filter((issue) => {
    const key = `${issue.code}:${issue.msg}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function calculateWalletRefundReversalAmount(input: {
  order: OrderWithPrice;
  refundAmountMinor: bigint;
  activeRefundAmountAfter: bigint;
  activeRefunds: BillingRefund[];
}): bigint {
  const grantAmount =
    input.order.grantsWalletAmount ?? input.order.price.grantsWalletAmount;
  if (!grantAmount || input.order.amountMinor <= 0n) return 0n;
  const totalGrant = grantAmount * BigInt(input.order.quantity);
  const alreadyReversed = input.activeRefunds.reduce(
    (sum, refund) => sum + (refund.walletReversalAmount ?? 0n),
    0n,
  );
  const remainingGrant = totalGrant - alreadyReversed;
  if (remainingGrant <= 0n) return 0n;
  if (input.activeRefundAmountAfter >= input.order.amountMinor) {
    return remainingGrant;
  }
  const prorated =
    (totalGrant * input.refundAmountMinor + input.order.amountMinor - 1n) /
    input.order.amountMinor;
  return prorated > remainingGrant ? remainingGrant : prorated;
}

function providerPaymentIntentIdForRefund(
  intent: BillingPaymentIntent,
): string | null {
  if (intent.providerPaymentIntentId) return intent.providerPaymentIntentId;
  const payload = isRecord(intent.providerPayload)
    ? intent.providerPayload
    : null;
  if (!payload) return null;
  return (
    stringAt(payload, ['data', 'payment_intent_id']) ??
    (eventTypeFromPayload(payload).startsWith('payment_intent.')
      ? stringAt(payload, ['data', 'id'])
      : null)
  );
}

function refundReasonForProvider(refund: BillingRefund): string {
  return refund.reasonCode;
}

function providerRefundSucceeded(
  status?: string | null,
  eventType?: string,
): boolean {
  const normalized = status?.toUpperCase();
  return (
    eventType === 'refund.accepted' ||
    eventType === 'refund.settled' ||
    normalized === 'ACCEPTED' ||
    normalized === 'SETTLED' ||
    normalized === 'SUCCEEDED' ||
    normalized === 'SUCCESS' ||
    normalized === 'COMPLETED'
  );
}

function providerRefundFailed(
  eventType: string,
  status?: string | null,
): boolean {
  const normalized = status?.toUpperCase();
  return (
    eventType.endsWith('.failed') ||
    normalized === 'FAILED' ||
    normalized === 'DECLINED' ||
    normalized === 'CANCELED' ||
    normalized === 'CANCELLED'
  );
}

function isRefundEvent(eventType: string): boolean {
  return eventType.startsWith('refund.');
}

function orderTypeForPrice(price: PriceWithItem): BillingOrderType {
  if (price.item.productType === BillingProductType.compute_point_pack) {
    return BillingOrderType.compute_point_topup;
  }
  if (price.item.productType === BillingProductType.community_point_pack) {
    return BillingOrderType.community_point_topup;
  }
  if (price.interval === BillingPriceInterval.one_time) {
    return BillingOrderType.membership_purchase;
  }
  return BillingOrderType.subscription_checkout;
}

function assertProviderBindingReady(
  binding: BillingProviderPriceBinding,
): void {
  if (
    binding.provider === PaymentProvider.airwallex &&
    !binding.providerPriceId
  ) {
    throw new ServiceUnavailableException({
      code: 'AIRWALLEX_PRICE_BINDING_INCOMPLETE',
      msg: 'Airwallex price binding is missing provider_price_id.',
    });
  }
}

function providerEventKey(payload: Record<string, unknown>, rawBody: Buffer) {
  const id = stringAt(payload, ['id']);
  if (id) return id;
  return createHash('sha256').update(rawBody).digest('hex');
}

function eventTypeFromPayload(payload: Record<string, unknown>) {
  return (
    stringAt(payload, ['name']) ??
    stringAt(payload, ['type']) ??
    stringAt(payload, ['event_type']) ??
    'unknown'
  );
}

function providerPayloadRecord(
  value: Prisma.JsonValue,
): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new BadRequestException({
      code: 'BILLING_PROVIDER_EVENT_PAYLOAD_INVALID',
      msg: 'Billing provider event payload is invalid.',
    });
  }
  return value;
}

function providerPayloadRecordOrNull(
  value: Prisma.JsonValue,
): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function providerEventPayloadSummary(payload: Record<string, unknown>) {
  return {
    id: stringAt(payload, ['id']),
    eventType: eventTypeFromPayload(payload),
    dataId: stringAt(payload, ['data', 'id']),
    dataStatus: stringAt(payload, ['data', 'status']),
    requestId: stringAt(payload, ['data', 'request_id']),
    billingCheckoutId:
      stringAt(payload, ['data', 'billing_checkout_id']) ??
      stringAt(payload, ['data', 'checkout_id']),
    paymentIntentId: stringAt(payload, ['data', 'payment_intent_id']),
    invoiceId: stringAt(payload, ['data', 'invoice_id']),
    subscriptionId: stringAt(payload, ['data', 'subscription_id']),
    refundId:
      stringAt(payload, ['data', 'refund_id']) ??
      (eventTypeFromPayload(payload).startsWith('refund.')
        ? stringAt(payload, ['data', 'id'])
        : null),
  };
}

function providerEventErrorMessage(err: unknown): string {
  if (err instanceof Error && err.message) return err.message;
  return 'Provider event processing failed.';
}

function isProviderEventAlreadyProcessedError(err: unknown): boolean {
  if (!isRecord(err) || typeof err.getResponse !== 'function') return false;
  const response = err.getResponse() as unknown;
  return (
    isRecord(response) &&
    response.code === 'BILLING_PROVIDER_EVENT_ALREADY_PROCESSED'
  );
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function isPaymentSucceededEvent(
  eventType: string,
  providerStatus?: string | null,
): boolean {
  const normalizedStatus = providerStatus?.toUpperCase();
  return (
    eventType === 'invoice.payment.paid' ||
    eventType === 'payment_intent.succeeded' ||
    eventType === 'billing_checkout.completed' ||
    normalizedStatus === 'SUCCEEDED' ||
    normalizedStatus === 'COMPLETED' ||
    normalizedStatus === 'PAID'
  );
}

function isPaymentFailedEvent(
  eventType: string,
  providerStatus?: string | null,
): boolean {
  const normalizedStatus = providerStatus?.toUpperCase();
  return (
    eventType.endsWith('.failed') ||
    eventType.endsWith('.cancelled') ||
    eventType.endsWith('.canceled') ||
    normalizedStatus === 'FAILED' ||
    normalizedStatus === 'CANCELLED' ||
    normalizedStatus === 'CANCELED' ||
    normalizedStatus === 'EXPIRED'
  );
}

function grantEndsAt(now: Date, days: number | null): Date | null {
  if (!days) return null;
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

function buildBillingItemCode(input: CreateAdminBillingPriceInput): string {
  const prefixes: Record<string, string> = {
    community_point_pack: 'COMMUNITY_POINT',
    compute_point_pack: 'COMPUTE_POINT',
    membership_plan: 'MEMBERSHIP',
    team_membership_plan: 'TEAM_MEMBERSHIP',
  };
  const prefix = prefixes[input.productType] ?? 'BILLING';
  const benefit = sanitizeCodeToken(
    input.grantsWalletAmount?.toString() ?? input.grantsPlanKey ?? 'PACKAGE',
  );
  const fiatCurrency = sanitizeCodeToken(input.currency || 'CUR');
  const fiatAmount = sanitizeCodeToken(
    input.amountMinor.toString() || 'AMOUNT',
  );
  return [prefix, benefit, fiatCurrency, fiatAmount]
    .join('_')
    .replace(/_+/g, '_')
    .slice(0, 96)
    .replace(/_+$/g, '');
}

function sanitizeCodeToken(value: string): string {
  const token = value
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return token || 'AUTO';
}

// Catalog code of the hidden anchor SKU backing arbitrary-amount custom recharge.
// Seeded by the billing_order_grant_snapshot migration; has no provider binding so
// it never surfaces in the public price listing.
const CUSTOM_RECHARGE_ITEM_CODE = 'COMMUNITY_POINT_CUSTOM_RECHARGE';

// The browser Airwallex SDK env must match the server's API base (demo <-> demo,
// prod <-> prod) or the client_secret won't validate at redirect. Derive it from
// the same env var the provider uses so the two can never diverge.
function airwallexSdkEnv(): 'demo' | 'prod' {
  const base = process.env.AIRWALLEX_API_BASE_URL ?? '';
  return base.includes('//api.airwallex.com') ? 'prod' : 'demo';
}

function createOrderNo(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  return `FD${stamp}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

function createRefundNo(): string {
  const stamp = new Date()
    .toISOString()
    .replace(/[-:TZ.]/g, '')
    .slice(0, 14);
  return `RF${stamp}${randomUUID().replace(/-/g, '').slice(0, 10).toUpperCase()}`;
}

function stringAt(
  value: Record<string, unknown>,
  path: string[],
): string | null {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return null;
    current = current[key];
  }
  return typeof current === 'string' && current.trim() ? current : null;
}

function dateAt(value: Record<string, unknown>, path: string[]): Date | null {
  const raw = stringAt(value, path);
  if (!raw) return null;
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp) : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function allowedReturnOrigins(): Set<string> {
  const configured = process.env.BILLING_ALLOWED_RETURN_ORIGINS?.split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  const origins = new Set(configured ?? []);
  for (const value of [
    process.env.WEB_BASE_URL,
    process.env.PUBLIC_WEB_URL,
    process.env.NEXT_PUBLIC_WEB_BASE_URL,
  ]) {
    if (!value) continue;
    try {
      origins.add(new URL(value).origin);
    } catch {
      // Ignore invalid env values; explicit request URL validation still fails.
    }
  }
  origins.add('https://fizzdragon.com');
  origins.add('https://studio.fizzdragon.com');
  origins.add('https://fizzdragon.fizzspace.cn');
  if (process.env.NODE_ENV !== 'production') {
    origins.add('http://localhost:9527');
    origins.add('http://127.0.0.1:9527');
    origins.add('http://localhost:3000');
    origins.add('http://127.0.0.1:3000');
  }
  return origins;
}
