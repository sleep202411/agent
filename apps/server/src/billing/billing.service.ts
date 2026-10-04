import { ensureWalletAccount } from '../workspaces/wallet-account-admission';
import { expireLapsedGrantsTx } from '../workspaces/wallet-ledger.service';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AiControlPlaneStatus,
  BillingProviderBindingStatus,
  BillingRefundStatus,
  BillingOrderStatus,
  BillingOrderType,
  BillingMembershipPlanStatus,
  BillingPriceInterval,
  BillingPromotionApplyMode,
  BillingPromotionDurationType,
  BillingPromotionRedemptionStatus,
  BillingPromotionStatus,
  BillingProductType,
  BillingSubjectType,
  BillingSubscriptionCycleStatus,
  BillingSubscriptionStatus,
  EntitlementGrantStatus,
  PaymentIntentKind,
  PaymentIntentStatus,
  PaymentProvider,
  PaymentProviderEventStatus,
  Prisma,
  WalletAccountStatus,
  WalletBalanceKind,
  WalletCreditGrantStatus,
  WalletCreditGrantType,
  WalletCurrencyType,
  WalletLedgerEntryType,
  WalletOwnerType,
  WalletTransactionStatus,
  WorkspaceStatus,
  WorkspaceMemberRole,
  type BillingOrder,
  type BillingMembershipPlan,
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
  type BillingSubscription,
  type WalletAccount,
} from '@prisma/client';
import {
  COMPUTE_POINT_EXPLICIT_ADMIN_PRICING,
  COMPUTE_POINT_FIAT_CURRENCY,
  COMPUTE_POINTS_PER_USD_CENT,
  decodeUserId,
  encodeUserId,
} from '@repo/shared';
import { createHash, randomUUID } from 'crypto';
import type { AuthUser } from '../auth';
import { CURRENT_CELL } from '../common/region';
import { PrismaService } from '../infra/db/db.module';
import {
  COMMUNITY_MEMBERSHIP_PLAN_KEY,
  EntitlementService,
} from '../entitlements/entitlement.service';
import {
  MembershipBenefitsSchema,
  type MembershipBenefits,
} from '../entitlements/membership-benefits';
import { ReferralsService } from '../referrals/referrals.service';
import { WalletLedgerService, isGrantBackedCurrencyKind } from '../workspaces';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import { enqueueEntitlementChanged } from './entitlement-realtime';
import type {
  BillingAttributionInput,
  CreateBillingCheckoutInput,
  CreateComputePointTopupInput,
  CreateCustomRechargeInput,
  CreateAdminBillingPriceInput,
  CreateAdminMembershipPlanInput,
  CreateAdminBillingPromotionInput,
  CreateAdminBillingRefundInput,
  CreateAdminWorkspaceWalletCreditInput,
  GetAdminWorkspaceWalletCreditQueryInput,
  ListAdminWorkspacesQueryInput,
  ListAdminComputeMemberUsageQuery,
  CreateAdminWalletAdjustmentInput,
  ListAdminBillingOrdersQuery,
  ListAdminBillingProviderEventsQuery,
  ListAdminBillingPricesQuery,
  ListAdminMembershipPlansQuery,
  ListAdminBillingPromotionsQuery,
  ListAdminBillingRefundsQuery,
  ListMembershipPlansQuery,
  ListBillingPricesQuery,
  ListWalletLedgerQuery,
  WalletDailyUsageQuery,
  WalletMemberUsageQuery,
  QuoteAdminBillingRefundInput,
  UpdateAdminMembershipPlanInput,
  UpdateAdminBillingPriceInput,
  UpdateAdminBillingPromotionInput,
  UpsertAdminBillingProviderBindingInput,
  UpsertAdminBillingPromotionProviderBindingInput,
} from './dto';
import { PaymentProviderRegistry } from './payment-provider-registry.service';
import {
  initialPriceProviderBindingStatus,
  isWechatAmountBasedPriceProvider,
} from './price-provider-binding-policy';
import {
  WechatPayProvider,
  WechatRefundUnconfirmedException,
  type WechatRefundNotification,
  type WechatTransaction,
} from './providers/wechat-pay.provider';
import type {
  CreatePaymentIntentResult,
  CreateProviderRefundResult,
  HostedCheckoutResult,
} from './providers/payment-provider';
import {
  MEMBERSHIP_GENERATION_ESTIMATE_MODEL_SLUGS,
  membershipGenerationEstimates,
} from './membership-generation-estimates';
import { BillingLedgerService } from './billing-ledger.service';
import { AppLovinConversionService } from './applovin-conversion.service';
import { LegacyPointsService } from '../legacy-points/legacy-points.service';

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
/**
 * The automatic sale (促销活动价) currently in effect for a price, shaped for
 * display. `amountMinor` on the price stays the list price; surfaces strike it
 * through and show `effectiveAmountMinor`. Null when no automatic sale applies.
 */
type PriceActiveDiscountDto = {
  promotionId: string;
  name: string;
  discountAmountMinor: string;
  effectiveAmountMinor: string;
  endsAt: string | null;
  /** once = first cycle only · repeating(N) · forever (subscription cadence). */
  recurring: BillingPromotionDurationType;
};
type AdminWalletLedgerEntryWithRelations = Prisma.WalletLedgerEntryGetPayload<{
  include: {
    account: true;
    transaction: true;
    creditAllocations: {
      include: {
        grant: {
          select: {
            id: true;
            grantType: true;
            status: true;
            validFrom: true;
            expiresAt: true;
            sourceType: true;
            sourceId: true;
          };
        };
      };
    };
  };
}>;
type MembershipPlanPriceRow = BillingPrice & {
  item: BillingCatalogItem;
  providerBindings: BillingProviderPriceBinding[];
};
type AdminMembershipPlanPriceRow = MembershipPlanPriceRow & {
  _count: { orders: number; subscriptions: number };
};
type SubscriptionRenewalMatch = {
  orderId: string;
  paymentIntentId: string;
};
type SubscriptionLifecycleMatch = {
  subscriptionId: string;
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly providerRegistry: PaymentProviderRegistry,
    private readonly permissions: WorkspacePermissionService,
    private readonly walletLedger: WalletLedgerService,
    private readonly ledger: BillingLedgerService,
    private readonly entitlements: EntitlementService,
    private readonly referrals: ReferralsService,
    private readonly appLovinConversion: AppLovinConversionService,
    private readonly wechatPay: WechatPayProvider,
    private readonly legacyPoints: LegacyPointsService,
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

  async listComputePointTopupPackages() {
    const policy = computePointTopupPolicy();
    const provider = policy.defaultProvider;
    const prices = await this.prisma.billingPrice.findMany({
      where: {
        isActive: true,
        archivedAt: null,
        currency: policy.currency,
        grantsWalletCurrency: WalletCurrencyType.compute_point,
        grantsWalletBalanceKind: WalletBalanceKind.consumable,
        providerBindings: {
          some: {
            provider,
            status: BillingProviderBindingStatus.active,
            archivedAt: null,
            // Catalog providers (Airwallex) need a synced providerPriceId; amount-
            // based providers (WeChat/Alipay) charge the amount directly, so their
            // binding has none — don't require it for them.
            ...(providerRequiresPriceId(provider)
              ? { providerPriceId: { not: null } }
              : {}),
          },
        },
        item: {
          isActive: true,
          archivedAt: null,
          productType: BillingProductType.compute_point_pack,
        },
      },
      include: {
        item: true,
        providerBindings: {
          where: { provider, archivedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ amountMinor: 'asc' }, { createdAt: 'asc' }],
    });

    for (const price of prices) {
      assertComputePointTopupPrice(price, policy);
    }

    return {
      provider,
      providers: policy.providers,
      currency: policy.currency,
      cell: policy.cell,
      exchangeRate:
        policy.currency === COMPUTE_POINT_FIAT_CURRENCY
          ? {
              computePointsPerUsdCent: COMPUTE_POINTS_PER_USD_CENT,
              usdCentsPerComputePoint: 1,
            }
          : null,
      rateMode: policy.rateMode,
      prices: prices.map((price) => this.priceDto(price, provider)),
    };
  }

  /** Balance-only read: project collaborators may see the team's shared pot.
   * Ledger details and recharge retain their existing role checks. */
  async getComputeBalance(user: AuthUser, workspaceId?: string | null) {
    let scope: { ownerType: WalletOwnerType; ownerId: string };
    if (workspaceId) {
      // Project invitations already maintain an active workspace roster entry.
      // Presence accepts project_only without granting workspace-wide access.
      await this.permissions.requireWorkspacePresence(user.userId, workspaceId);
      scope = { ownerType: WalletOwnerType.workspace, ownerId: workspaceId };
    } else {
      scope = await this.walletLedgerScope(
        user,
        WalletCurrencyType.compute_point,
      );
    }
    const accounts = await this.readWalletAccounts({
      ...scope,
      currency: WalletCurrencyType.compute_point,
      balanceKind: WalletBalanceKind.consumable,
      status: WalletAccountStatus.active,
    });
    const available = accounts.reduce(
      (sum, account) => sum + account.availableBalance,
      0n,
    );
    const held = accounts.reduce(
      (sum, account) => sum + account.heldBalance,
      0n,
    );
    return {
      available: available.toString(),
      held: held.toString(),
      total: (available + held).toString(),
      nextExpiry: await this.nextWalletExpiry(accounts),
    };
  }

  private async readWalletAccounts(where: Prisma.WalletAccountWhereInput) {
    let accounts = await this.prisma.walletAccount.findMany({
      where,
      orderBy: [{ createdAt: 'asc' }],
    });
    let swept = false;
    for (const account of accounts) {
      const { expired } = await this.walletLedger.expireLapsedGrants(
        account.id,
      );
      if (expired > 0n) swept = true;
    }
    if (swept) {
      accounts = await this.prisma.walletAccount.findMany({
        where,
        orderBy: [{ createdAt: 'asc' }],
      });
    }
    return accounts;
  }

  private async nextWalletExpiry(accounts: WalletAccount[]) {
    if (accounts.length === 0) return null;
    const grant = await this.prisma.walletCreditGrant.findFirst({
      where: {
        accountId: { in: accounts.map((account) => account.id) },
        status: WalletCreditGrantStatus.active,
        availableAmount: { gt: 0n },
        expiresAt: { not: null },
      },
      orderBy: { expiresAt: 'asc' },
      select: { availableAmount: true, expiresAt: true },
    });
    return grant
      ? {
          amount: grant.availableAmount.toString(),
          expiresAt: grant.expiresAt!.toISOString(),
        }
      : null;
  }

  async listWalletLedger(
    user: AuthUser,
    query: ListWalletLedgerQuery,
    workspaceId?: string | null,
  ) {
    const scope = await this.walletLedgerScope(
      user,
      query.currency as WalletCurrencyType,
      workspaceId,
    );
    const accountWhere = {
      ownerType: scope.ownerType,
      ownerId: scope.ownerId,
      currency: query.currency as WalletCurrencyType,
      balanceKind: query.balanceKind as WalletBalanceKind,
    };
    const accounts = await this.readWalletAccounts(accountWhere);
    if (accounts.length === 0) {
      if (query.cursor)
        throw new BadRequestException({
          code: 'INVALID_LEDGER_CURSOR',
          msg: 'Ledger cursor is outside the selected scope.',
        });
      return {
        accounts: [],
        entries: [],
        nextCursor: null,
      };
    }

    const where = {
      accountId: { in: accounts.map((account) => account.id) },
      ...(query.projectId
        ? { transaction: { projectId: query.projectId } }
        : {}),
    };
    if (
      query.cursor &&
      !(await this.prisma.walletLedgerEntry.findFirst({
        where: { ...where, id: query.cursor },
        select: { id: true },
      }))
    ) {
      throw new BadRequestException({
        code: 'INVALID_LEDGER_CURSOR',
        msg: 'Ledger cursor is outside the selected scope.',
      });
    }
    const entries = await this.prisma.walletLedgerEntry.findMany({
      where,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      include: {
        transaction: true,
        creditAllocations: {
          include: {
            grant: {
              select: {
                id: true,
                grantType: true,
                status: true,
                validFrom: true,
                expiresAt: true,
                sourceType: true,
                sourceId: true,
              },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });

    return {
      nextCursor:
        entries.length > query.limit ? entries[query.limit - 1].id : null,
      nextExpiry: await this.nextWalletExpiry(accounts),
      accounts: accounts.map((account) => ({
        id: account.id,
        ownerType: account.ownerType,
        ownerId: account.ownerId,
        currency: account.currency,
        balanceKind: account.balanceKind,
        status: account.status,
        availableBalance: account.availableBalance.toString(),
        heldBalance: account.heldBalance.toString(),
        updatedAt: account.updatedAt.toISOString(),
      })),
      entries: entries.slice(0, query.limit).map((entry) => {
        const metadata = isRecord(entry.transaction.metadata)
          ? entry.transaction.metadata
          : {};
        return {
          id: entry.id,
          transactionId: entry.transactionId,
          accountId: entry.accountId,
          entryType: entry.entryType,
          currency: entry.currency,
          balanceKind: entry.balanceKind,
          amount: entry.amount.toString(),
          availableDelta: entry.availableDelta.toString(),
          heldDelta: entry.heldDelta.toString(),
          availableBalanceAfter: entry.availableBalanceAfter.toString(),
          heldBalanceAfter: entry.heldBalanceAfter.toString(),
          reason: entry.reason,
          projectId: entry.transaction.projectId,
          workspaceId: entry.transaction.workspaceId,
          actorUserId: entry.transaction.actorUserId,
          transactionStatus: entry.transaction.status,
          postedAt: entry.transaction.postedAt?.toISOString() ?? null,
          sourceType: entry.transaction.sourceType,
          sourceId: entry.transaction.sourceId,
          orderNo: stringAt(metadata, ['orderNo']),
          description: entry.transaction.description,
          metadata,
          creditAllocations: entry.creditAllocations.map((allocation) => ({
            id: allocation.id,
            grantId: allocation.grantId,
            grantType: allocation.grant.grantType,
            grantStatus: allocation.grant.status,
            amount: allocation.amount.toString(),
            availableDelta: allocation.availableDelta.toString(),
            heldDelta: allocation.heldDelta.toString(),
            consumedDelta: allocation.consumedDelta.toString(),
            expiredDelta: allocation.expiredDelta.toString(),
            reversedDelta: allocation.reversedDelta.toString(),
            validFrom: allocation.grant.validFrom.toISOString(),
            expiresAt: allocation.grant.expiresAt?.toISOString() ?? null,
            sourceType: allocation.grant.sourceType,
            sourceId: allocation.grant.sourceId,
          })),
          createdAt: entry.createdAt.toISOString(),
        };
      }),
    };
  }

  /**
   * Daily compute-credit consumption (settle/debit magnitudes) for the
   * workspace's wallet accounts, optionally scoped to a single project. Drives
   * the studio analytics usage bar chart.
   */
  async walletDailyUsage(
    user: AuthUser,
    query: WalletDailyUsageQuery,
    workspaceId?: string | null,
  ) {
    const scope = await this.walletLedgerScope(
      user,
      query.currency as WalletCurrencyType,
      workspaceId,
    );
    const accounts = await this.prisma.walletAccount.findMany({
      where: {
        ownerType: scope.ownerType,
        ownerId: scope.ownerId,
        currency: query.currency as WalletCurrencyType,
        balanceKind: query.balanceKind as WalletBalanceKind,
      },
    });
    if (accounts.length === 0) {
      return { days: [] };
    }

    const accountIds = accounts.map((a) => a.id);
    const from = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);
    const projectFilter = query.projectId
      ? Prisma.sql`AND t.project_id = ${query.projectId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{ day: Date; credits: string }>
    >(Prisma.sql`
      SELECT (e.created_at AT TIME ZONE 'UTC')::date AS day, SUM(e.amount)::text AS credits
      FROM wallet_ledger_entries e
      JOIN wallet_transactions t ON t.id = e.transaction_id
      WHERE e.account_id IN (${Prisma.join(accountIds)})
        AND t.status = 'posted'
        AND e.entry_type::text IN ('settle','debit')
        AND e.created_at >= ${from}
        ${projectFilter}
      GROUP BY day
      ORDER BY day ASC
    `);
    return {
      days: rows.map((r) => ({
        date:
          r.day instanceof Date
            ? r.day.toISOString().slice(0, 10)
            : String(r.day).slice(0, 10),
        credits: r.credits.toString(),
      })),
    };
  }

  /**
   * Per-member compute usage for a team workspace — how much each member spent,
   * broken down by project. Powers the team admin's usage view. Admin-only
   * (surfaces teammates' consumption). Reads the settled charges (settle/debit)
   * on the workspace's compute pot, grouped by the submitting member + project.
   * Members are keyed by userId; the client joins its team-members list for
   * display names. Project names are resolved here (cheap PG join).
   */
  async walletMemberUsage(
    user: AuthUser,
    query: WalletMemberUsageQuery,
    workspaceId?: string | null,
  ) {
    if (!workspaceId) {
      throw new BadRequestException({
        code: 'WORKSPACE_REQUIRED',
        msg: 'Choose a workspace to view member usage.',
      });
    }
    // Per-member consumption is sensitive — restrict to workspace admins/owners.
    await this.permissions.requireWorkspaceRole(
      user.userId,
      workspaceId,
      WorkspaceMemberRole.admin,
    );

    const accounts = await this.prisma.walletAccount.findMany({
      where: {
        ownerType: WalletOwnerType.workspace,
        ownerId: workspaceId,
        currency: WalletCurrencyType.compute_point,
        balanceKind: WalletBalanceKind.consumable,
      },
      select: { id: true },
    });
    if (accounts.length === 0) {
      return {
        rangeDays: query.days,
        projectId: query.projectId ?? null,
        members: [],
      };
    }

    const accountIds = accounts.map((account) => account.id);
    const from = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);
    const projectFilter = query.projectId
      ? Prisma.sql`AND t.project_id = ${query.projectId}::uuid`
      : Prisma.empty;
    const rows = await this.prisma.$queryRaw<
      Array<{
        actorUserId: string | null;
        projectId: string | null;
        credits: string;
        jobs: bigint;
      }>
    >(Prisma.sql`
      SELECT t.actor_user_id AS "actorUserId",
             t.project_id AS "projectId",
             SUM(e.amount)::text AS credits,
             COUNT(*)::bigint AS jobs
      FROM wallet_ledger_entries e
      JOIN wallet_transactions t ON t.id = e.transaction_id
      WHERE e.account_id IN (${Prisma.join(accountIds)})
        AND t.status = 'posted'
        AND e.entry_type::text IN ('settle','debit')
        AND e.created_at >= ${from}
        ${projectFilter}
      GROUP BY t.actor_user_id, t.project_id
    `);

    const projectIds = [
      ...new Set(
        rows
          .map((row) => row.projectId)
          .filter((id): id is string => id != null),
      ),
    ];
    const projects = projectIds.length
      ? await this.prisma.platformProject.findMany({
          where: { id: { in: projectIds }, workspaceId, deletedAt: null },
          select: { id: true, name: true },
        })
      : [];
    const projectNameById = new Map(projects.map((p) => [p.id, p.name]));

    type MemberProject = {
      projectId: string | null;
      projectName: string | null;
      credits: bigint;
      jobs: number;
    };
    type MemberAgg = {
      userId: string;
      totalCredits: bigint;
      totalJobs: number;
      projects: MemberProject[];
    };
    const byMember = new Map<string, MemberAgg>();
    for (const row of rows) {
      const userId = row.actorUserId ?? 'unknown';
      let member = byMember.get(userId);
      if (!member) {
        member = { userId, totalCredits: 0n, totalJobs: 0, projects: [] };
        byMember.set(userId, member);
      }
      const jobs = Number(row.jobs);
      member.totalCredits += BigInt(row.credits);
      member.totalJobs += jobs;
      member.projects.push({
        projectId: row.projectId,
        projectName: row.projectId
          ? (projectNameById.get(row.projectId) ?? null)
          : null,
        credits: BigInt(row.credits),
        jobs,
      });
    }

    const members = [...byMember.values()]
      .sort((a, b) =>
        a.totalCredits === b.totalCredits
          ? a.userId.localeCompare(b.userId)
          : b.totalCredits > a.totalCredits
            ? 1
            : -1,
      )
      .map((member) => ({
        userId: member.userId,
        totalCredits: member.totalCredits.toString(),
        totalJobs: member.totalJobs,
        projects: member.projects
          .sort((a, b) =>
            a.credits === b.credits
              ? (a.projectId ?? '').localeCompare(b.projectId ?? '')
              : b.credits > a.credits
                ? 1
                : -1,
          )
          .map((project) => ({
            projectId: project.projectId,
            projectName: project.projectName,
            credits: project.credits.toString(),
            jobs: project.jobs,
          })),
      }));

    return {
      rangeDays: query.days,
      projectId: query.projectId ?? null,
      members,
    };
  }

  /**
   * Admin cross-workspace compute usage: person × workspace pot consumption
   * over the last N days. Joins workspace + legacy user identity for display.
   */
  async listAdminComputeMemberUsage(query: ListAdminComputeMemberUsageQuery) {
    let rawActorUserId: string | null = null;
    if (query.userId?.trim()) {
      rawActorUserId = decodeUserId(query.userId.trim());
    } else if (query.userQuery?.trim()) {
      try {
        const matched = await this.legacyPoints.findUser(
          query.userQuery.trim(),
        );
        if (!matched) {
          return {
            rangeDays: query.days,
            workspaceKind: query.workspaceKind,
            workspaceId: query.workspaceId ?? null,
            totalCredits: '0',
            memberCount: 0,
            workspaceCount: 0,
            members: [],
          };
        }
        // Contact lookup already returns the raw Java ID, not a displayed ID.
        rawActorUserId = matched.userId;
      } catch (err) {
        // Legacy MySQL is optional locally; without it phone/email lookup is
        // unavailable — fail the filter loudly so ops know why it's empty.
        this.logger.warn(
          `legacy user lookup unavailable: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        throw new BadRequestException({
          code: 'LEGACY_MYSQL_UNAVAILABLE',
          msg: 'Phone/email user lookup needs LEGACY_MYSQL_ENABLED and credentials. Use userId instead, or configure the MySQL bridge.',
        });
      }
    }

    const from = new Date(Date.now() - query.days * 24 * 60 * 60 * 1000);
    const workspaceIdFilter = query.workspaceId
      ? Prisma.sql`AND a.owner_id = ${query.workspaceId}`
      : Prisma.empty;
    const actorFilter = rawActorUserId
      ? Prisma.sql`AND t.actor_user_id = ${rawActorUserId}`
      : Prisma.empty;
    const kindFilter =
      query.workspaceKind === 'personal'
        ? Prisma.sql`AND w.default_for_user_id IS NOT NULL`
        : query.workspaceKind === 'shared'
          ? Prisma.sql`AND w.default_for_user_id IS NULL`
          : Prisma.empty;
    const workspaceNeedle = query.workspaceQuery?.trim();
    const workspaceNameFilter = workspaceNeedle
      ? Prisma.sql`AND w.name ILIKE ${likeContainsPattern(workspaceNeedle)} ESCAPE '\\'`
      : Prisma.empty;
    // Aggregate before limiting display rows. Member ranking and headline
    // totals must include every matching ledger entry, not just the top pairs.
    const rows = await this.prisma.$queryRaw<
      Array<{
        actorUserId: string;
        workspaceId: string;
        credits: string;
        jobs: string;
        imageJobs: string;
        videoJobs: string;
        memberImageJobs: string;
        memberVideoJobs: string;
        memberCredits: string;
        memberJobs: string;
        memberWorkspaces: string;
        totalCredits: string;
        memberCount: string;
        workspaceCount: string;
      }>
    >(Prisma.sql`
      WITH pairs AS (
        SELECT COALESCE(t.actor_user_id, 'unknown') AS actor,
               a.owner_id AS workspace, SUM(e.amount) AS credits, COUNT(*) AS jobs,
               COUNT(*) FILTER (WHERE j.type::text = 'image') AS image_jobs,
               COUNT(*) FILTER (WHERE j.type::text = 'video') AS video_jobs
        FROM wallet_ledger_entries e
        JOIN wallet_transactions t ON t.id = e.transaction_id
        JOIN wallet_accounts a ON a.id = e.account_id
        JOIN workspaces w ON w.id::text = a.owner_id AND w.deleted_at IS NULL
        LEFT JOIN ai_jobs j ON t.source_type = 'ai_job' AND j.id::text = t.source_id
        WHERE a.owner_type::text = 'workspace'
          AND a.currency::text = 'compute_point'
          AND a.balance_kind::text = 'consumable'
          AND t.status = 'posted'
          AND e.entry_type::text IN ('settle', 'debit')
          AND e.created_at >= ${from}
          ${workspaceIdFilter} ${actorFilter} ${kindFilter} ${workspaceNameFilter}
        GROUP BY COALESCE(t.actor_user_id, 'unknown'), a.owner_id
      ), totals AS (
        SELECT SUM(credits)::text AS credits,
               COUNT(DISTINCT actor)::text AS members,
               COUNT(DISTINCT workspace)::text AS workspaces FROM pairs
      ), selected AS (
        SELECT actor, SUM(credits) AS credits, SUM(jobs) AS jobs, SUM(image_jobs) AS image_jobs, SUM(video_jobs) AS video_jobs, COUNT(*) AS workspaces
        FROM pairs GROUP BY actor ORDER BY credits DESC, actor ASC LIMIT ${query.limit}
      ), details AS (
        SELECT p.*, s.credits AS member_credits, s.jobs AS member_jobs,
               s.image_jobs AS member_image_jobs, s.video_jobs AS member_video_jobs,
               s.workspaces AS member_workspaces,
               ROW_NUMBER() OVER (PARTITION BY p.actor ORDER BY p.credits DESC, p.workspace ASC) AS ordinal
        FROM pairs p JOIN selected s ON s.actor = p.actor
      )
      SELECT d.actor AS "actorUserId", d.workspace AS "workspaceId",
             d.credits::text AS credits, d.jobs::text AS jobs,
             d.image_jobs::text AS "imageJobs", d.video_jobs::text AS "videoJobs",
             d.member_image_jobs::text AS "memberImageJobs", d.member_video_jobs::text AS "memberVideoJobs",
             d.member_credits::text AS "memberCredits", d.member_jobs::text AS "memberJobs",
             d.member_workspaces::text AS "memberWorkspaces",
             t.credits AS "totalCredits", t.members AS "memberCount", t.workspaces AS "workspaceCount"
      FROM details d CROSS JOIN totals t WHERE d.ordinal <= 20
      ORDER BY d.member_credits DESC, d.actor ASC, d.credits DESC, d.workspace ASC
    `);

    if (rows.length === 0) {
      return {
        rangeDays: query.days,
        workspaceKind: query.workspaceKind,
        workspaceId: query.workspaceId ?? null,
        totalCredits: '0',
        memberCount: 0,
        workspaceCount: 0,
        members: [],
      };
    }

    const workspaceIdPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const workspaceIds = [
      ...new Set(
        rows
          .map((row) => row.workspaceId)
          .filter((id) => workspaceIdPattern.test(id)),
      ),
    ];
    const workspaces =
      workspaceIds.length === 0
        ? []
        : await this.prisma.workspace.findMany({
            where: { id: { in: workspaceIds } },
            select: {
              id: true,
              name: true,
              defaultForUserId: true,
              status: true,
            },
          });
    const workspaceById = new Map(workspaces.map((ws) => [ws.id, ws]));

    const rawUserIds = [
      ...new Set(
        rows
          .map((row) => row.actorUserId)
          .filter((id): id is string => Boolean(id && id !== 'unknown')),
      ),
    ];
    let legacyByRawId = new Map<
      string,
      Awaited<ReturnType<LegacyPointsService['findUsersByIds']>>[number]
    >();
    try {
      const legacyUsers = await this.legacyPoints.findUsersByIds(
        rawUserIds.map((id) => encodeUserId(id)),
      );
      legacyByRawId = new Map(
        legacyUsers.map((user) => [decodeUserId(user.userId), user]),
      );
    } catch (err) {
      this.logger.warn(
        `legacy user identity resolve skipped: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }

    type WorkspaceAgg = {
      workspaceId: string;
      credits: bigint;
      jobs: number;
      imageJobs: number;
      videoJobs: number;
    };
    type MemberAgg = {
      rawUserId: string;
      totalCredits: bigint;
      totalJobs: number;
      workspaceCount: number;
      totalImageJobs: number;
      totalVideoJobs: number;
      workspaces: WorkspaceAgg[];
    };
    const byMember = new Map<string, MemberAgg>();
    for (const row of rows) {
      const rawUserId = row.actorUserId ?? 'unknown';
      let member = byMember.get(rawUserId);
      if (!member) {
        member = {
          rawUserId,
          totalCredits: BigInt(row.memberCredits),
          totalJobs: Number(row.memberJobs),
          workspaceCount: Number(row.memberWorkspaces),
          totalImageJobs: Number(row.memberImageJobs),
          totalVideoJobs: Number(row.memberVideoJobs),
          workspaces: [],
        };
        byMember.set(rawUserId, member);
      }
      const jobs = Number(row.jobs);
      const imageJobs = Number(row.imageJobs);
      const videoJobs = Number(row.videoJobs);
      member.workspaces.push({
        workspaceId: row.workspaceId,
        credits: BigInt(row.credits),
        jobs,
        imageJobs,
        videoJobs,
      });
    }

    const members = [...byMember.values()]
      .sort((a, b) =>
        a.totalCredits === b.totalCredits
          ? a.rawUserId.localeCompare(b.rawUserId)
          : b.totalCredits > a.totalCredits
            ? 1
            : -1,
      )
      .slice(0, query.limit)
      .map((member) => {
        const legacy =
          member.rawUserId === 'unknown'
            ? null
            : (legacyByRawId.get(member.rawUserId) ?? null);
        return {
          userId:
            member.rawUserId === 'unknown'
              ? 'unknown'
              : encodeUserId(member.rawUserId),
          nickName: legacy?.nickName ?? null,
          phone: legacy?.phone ?? null,
          email: legacy?.email ?? null,
          totalCredits: member.totalCredits.toString(),
          totalJobs: member.totalJobs,
          totalImageJobs: member.totalImageJobs,
          totalVideoJobs: member.totalVideoJobs,
          workspaces: member.workspaces
            .sort((a, b) =>
              a.credits === b.credits
                ? a.workspaceId.localeCompare(b.workspaceId)
                : b.credits > a.credits
                  ? 1
                  : -1,
            )
            .map((ws) => {
              const meta = workspaceById.get(ws.workspaceId);
              return {
                workspaceId: ws.workspaceId,
                workspaceName: meta?.name ?? ws.workspaceId,
                workspaceStatus: meta?.status ?? null,
                isPersonal: Boolean(meta?.defaultForUserId),
                credits: ws.credits.toString(),
                jobs: ws.jobs,
                imageJobs: ws.imageJobs,
                videoJobs: ws.videoJobs,
              };
            }),
        };
      });

    return {
      rangeDays: query.days,
      workspaceKind: query.workspaceKind,
      workspaceId: query.workspaceId ?? null,
      totalCredits: rows[0].totalCredits,
      memberCount: Number(rows[0].memberCount),
      workspaceCount: Number(rows[0].workspaceCount),
      members,
    };
  }

  private async walletLedgerScope(
    user: AuthUser,
    currency: WalletCurrencyType,
    workspaceId?: string | null,
  ): Promise<{ ownerType: WalletOwnerType; ownerId: string }> {
    // community_point is the creator economy — always owned by the user, never a
    // workspace, regardless of the active workspace header.
    if (currency !== WalletCurrencyType.compute_point) {
      return { ownerType: WalletOwnerType.user, ownerId: user.userId };
    }

    // compute_point is uniformly workspace-owned: every member may READ a
    // workspace's balance (viewer); with no workspace in context, fall back to the
    // caller's default-workspace pot. Recharge stays billing-role gated at its own
    // call site (resolveTopupSubject).
    if (workspaceId) {
      const membership = await this.permissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.viewer,
      );
      return {
        ownerType: WalletOwnerType.workspace,
        ownerId: membership.workspaceId,
      };
    }

    const defaultWorkspace = await this.prisma.workspace.findFirst({
      where: {
        defaultForUserId: user.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (defaultWorkspace) {
      return {
        ownerType: WalletOwnerType.workspace,
        ownerId: defaultWorkspace.id,
      };
    }
    throw new ConflictException({
      code: 'DEFAULT_WORKSPACE_REQUIRED',
      msg: 'Open the studio to initialize your default workspace.',
    });
  }

  async listMembershipPlans(query: ListMembershipPlansQuery) {
    const provider =
      (query.provider as PaymentProvider | undefined) ??
      this.providerRegistry.defaultProviderForRuntime();
    const requireProviderBinding = shouldRequireProviderBoundCatalog();
    const providerBindingWhere: Prisma.BillingProviderPriceBindingWhereInput = {
      provider,
      status: BillingProviderBindingStatus.active,
      archivedAt: null,
    };
    const [plans, estimateModels] = await Promise.all([
      this.prisma.billingMembershipPlan.findMany({
        where: {
          productType: query.productType as BillingProductType | undefined,
          subjectType: query.subjectType as BillingSubjectType | undefined,
          status: BillingMembershipPlanStatus.active,
          archivedAt: null,
        },
        orderBy: [
          { subjectType: 'asc' },
          { rank: 'asc' },
          { createdAt: 'asc' },
        ],
      }),
      this.prisma.aiCanonicalModel.findMany({
        where: {
          slug: { in: [...MEMBERSHIP_GENERATION_ESTIMATE_MODEL_SLUGS] },
          status: AiControlPlaneStatus.active,
          archivedAt: null,
        },
        select: {
          slug: true,
          displayName: true,
          billingPolicy: true,
        },
      }),
    ]);
    const planKeys = plans.map((plan) => plan.planKey);
    const prices =
      planKeys.length === 0
        ? []
        : await this.prisma.billingPrice.findMany({
            where: {
              grantsPlanKey: { in: planKeys },
              currency: query.currency,
              isActive: true,
              archivedAt: null,
              item: {
                isActive: true,
                archivedAt: null,
                productType: query.productType as
                  | BillingProductType
                  | undefined,
              },
              ...(requireProviderBinding
                ? { providerBindings: { some: providerBindingWhere } }
                : {}),
            },
            include: {
              item: true,
              providerBindings: {
                where: requireProviderBinding
                  ? providerBindingWhere
                  : { archivedAt: null },
                orderBy: { createdAt: 'asc' },
              },
            },
            orderBy: [
              { interval: 'asc' },
              { amountMinor: 'asc' },
              { createdAt: 'asc' },
            ],
          });

    const pricesByPlan = groupPricesByPlanKey(prices);

    // Resolve the automatic sale (促销活动价) in effect per price, in parallel,
    // so the catalog returns struck list price + effective price uniformly.
    const now = new Date();
    const discountEntries = await Promise.all(
      prices.map(async (price) => {
        const priceProvider =
          price.providerBindings[0]?.provider ??
          this.providerRegistry.defaultProviderForRuntime();
        return [
          price.id,
          await this.previewActiveDiscount(price, priceProvider, now),
        ] as const;
      }),
    );
    const discountByPriceId = new Map(
      discountEntries.filter(
        (entry): entry is readonly [string, PriceActiveDiscountDto] =>
          entry[1] !== null,
      ),
    );

    return {
      provider,
      plans: plans.map((plan) =>
        this.membershipPlanDto(
          plan,
          pricesByPlan.get(plan.planKey) ?? [],
          discountByPriceId,
          membershipGenerationEstimates(
            plan.includedComputeCredits,
            estimateModels,
          ),
        ),
      ),
    };
  }

  async listAdminMembershipPlans(query: ListAdminMembershipPlansQuery) {
    const plans = await this.prisma.billingMembershipPlan.findMany({
      where: {
        productType: query.productType as BillingProductType | undefined,
        subjectType: query.subjectType as BillingSubjectType | undefined,
        status: query.status as BillingMembershipPlanStatus | undefined,
        archivedAt: query.includeArchived ? undefined : null,
      },
      orderBy: [{ subjectType: 'asc' }, { rank: 'asc' }, { createdAt: 'asc' }],
      take: 200,
    });
    const planKeys = plans.map((plan) => plan.planKey);
    const prices =
      planKeys.length === 0
        ? []
        : await this.prisma.billingPrice.findMany({
            where: { grantsPlanKey: { in: planKeys } },
            include: {
              item: true,
              providerBindings: {
                where: query.includeArchived ? undefined : { archivedAt: null },
                orderBy: [{ provider: 'asc' }, { createdAt: 'desc' }],
              },
              _count: { select: { orders: true, subscriptions: true } },
            },
            orderBy: [
              { currency: 'asc' },
              { interval: 'asc' },
              { amountMinor: 'asc' },
            ],
          });
    const pricesByPlan = groupPricesByPlanKey(prices);
    return {
      items: plans.map((plan) =>
        this.adminMembershipPlanDto(
          plan,
          pricesByPlan.get(plan.planKey) as
            | AdminMembershipPlanPriceRow[]
            | undefined,
        ),
      ),
    };
  }

  async createAdminMembershipPlan(
    adminId: string,
    input: CreateAdminMembershipPlanInput,
  ) {
    const plan = await this.prisma.billingMembershipPlan.create({
      data: {
        planKey: input.planKey,
        productType: input.productType as BillingProductType,
        subjectType: input.subjectType as BillingSubjectType,
        status: input.status as BillingMembershipPlanStatus,
        rank: input.rank,
        name: input.name,
        description: input.description ?? null,
        includedComputeCredits: input.includedComputeCredits,
        includedSeats: input.includedSeats,
        maxSeats: input.maxSeats ?? null,
        seatOverageAllowed: input.seatOverageAllowed,
        billingIntervalDefault:
          (input.billingIntervalDefault as BillingPriceInterval | undefined) ??
          null,
        benefits: input.benefits as Prisma.InputJsonValue,
        marketing: (input.marketing ?? {}) as Prisma.InputJsonValue,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
        createdById: adminId,
      },
    });
    this.entitlements.invalidatePlanCache();
    return this.adminMembershipPlanDto(plan, []);
  }

  async getAdminMembershipPlanBenefits(planId: string) {
    const plan = await this.prisma.billingMembershipPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) {
      throw new NotFoundException({
        code: 'BILLING_MEMBERSHIP_PLAN_NOT_FOUND',
        msg: 'Membership plan not found.',
      });
    }
    // Return the STORED benefits plus validation issues (if any) so the
    // admin can repair an invalid row instead of being locked out of it.
    const parsed = MembershipBenefitsSchema.safeParse(plan.benefits);
    return {
      id: plan.id,
      planKey: plan.planKey,
      name: plan.name,
      status: plan.status,
      benefits: plan.benefits,
      issues: parsed.success
        ? null
        : parsed.error.issues.map(
            (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
          ),
    };
  }

  async updateAdminMembershipPlanBenefits(
    planId: string,
    adminId: string,
    benefits: MembershipBenefits,
  ) {
    const existing = await this.prisma.billingMembershipPlan.findUnique({
      where: { id: planId },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'BILLING_MEMBERSHIP_PLAN_NOT_FOUND',
        msg: 'Membership plan not found.',
      });
    }
    const plan = await this.prisma.billingMembershipPlan.update({
      where: { id: planId },
      data: {
        benefits: benefits as Prisma.InputJsonValue,
        updatedById: adminId,
      },
    });
    // Bust the entitlement plan cache so this pod serves the new numbers
    // immediately (other pods converge within the 20s cache TTL).
    this.entitlements.invalidatePlanCache();
    return {
      id: plan.id,
      planKey: plan.planKey,
      name: plan.name,
      status: plan.status,
      benefits: plan.benefits,
      updatedAt: plan.updatedAt.toISOString(),
    };
  }

  async updateAdminMembershipPlan(
    planId: string,
    adminId: string,
    input: UpdateAdminMembershipPlanInput,
  ) {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_membership_plans WHERE id=${planId}::uuid FOR UPDATE`;
      const existing = await tx.billingMembershipPlan.findUnique({
        where: { id: planId },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'BILLING_MEMBERSHIP_PLAN_NOT_FOUND',
          msg: 'Membership plan not found.',
        });
      }
      const nextProductType =
        (input.productType as BillingProductType | undefined) ??
        existing.productType;
      const nextSubjectType =
        (input.subjectType as BillingSubjectType | undefined) ??
        existing.subjectType;
      assertMembershipPlanShape(nextProductType, nextSubjectType);
      const nextIncludedSeats = input.includedSeats ?? existing.includedSeats;
      const nextMaxSeats =
        input.maxSeats === undefined ? existing.maxSeats : input.maxSeats;
      if (nextMaxSeats != null && nextMaxSeats < nextIncludedSeats) {
        throw new BadRequestException({
          code: 'BILLING_MEMBERSHIP_PLAN_SEATS_INVALID',
          msg: 'Maximum seats cannot be below included seats.',
        });
      }
      const archivedAt =
        input.status === undefined
          ? undefined
          : input.status === 'archived'
            ? new Date()
            : null;

      const plan = await tx.billingMembershipPlan.update({
        where: { id: planId },
        data: {
          productType: input.productType as BillingProductType | undefined,
          subjectType: input.subjectType as BillingSubjectType | undefined,
          status: input.status as BillingMembershipPlanStatus | undefined,
          rank: input.rank,
          name: input.name,
          description:
            input.description === undefined ? undefined : input.description,
          includedComputeCredits: input.includedComputeCredits,
          includedSeats: input.includedSeats,
          maxSeats: input.maxSeats === undefined ? undefined : input.maxSeats,
          seatOverageAllowed: input.seatOverageAllowed,
          billingIntervalDefault:
            input.billingIntervalDefault === undefined
              ? undefined
              : (input.billingIntervalDefault as BillingPriceInterval),
          marketing: input.marketing
            ? (input.marketing as Prisma.InputJsonValue)
            : undefined,
          metadata: input.metadata
            ? (input.metadata as Prisma.InputJsonValue)
            : undefined,
          archivedAt,
          updatedById: adminId,
        },
      });
      const prices = await tx.billingPrice.findMany({
        where: { grantsPlanKey: plan.planKey },
        include: {
          item: true,
          providerBindings: {
            where: { archivedAt: null },
            orderBy: [{ provider: 'asc' }, { createdAt: 'desc' }],
          },
          _count: { select: { orders: true, subscriptions: true } },
        },
      });
      // Status/rank edits change entitlement resolution + upgrade ordering.
      return this.adminMembershipPlanDto(plan, prices);
    });
    this.entitlements.invalidatePlanCache();
    return result;
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
          creditAllocations: {
            include: {
              grant: {
                select: {
                  id: true,
                  grantType: true,
                  status: true,
                  validFrom: true,
                  expiresAt: true,
                  sourceType: true,
                  sourceId: true,
                },
              },
            },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          },
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
      walletAccounts: walletAccounts.map((account) =>
        this.adminWalletAccountDto(account),
      ),
      walletLedgerEntries: walletLedgerEntries.map((entry) =>
        this.adminWalletLedgerEntryDto(entry),
      ),
      recentOrders: recentOrders.map((order) => this.adminOrderDto(order)),
    };
  }

  async getAdminWalletAccountDetail(
    accountId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const account = await db.walletAccount.findUnique({
      where: { id: accountId },
      include: {
        _count: { select: { ledgerEntries: true } },
      },
    });
    const entries = await db.walletLedgerEntry.findMany({
      where: { accountId },
      include: {
        account: true,
        transaction: true,
        creditAllocations: {
          include: {
            grant: {
              select: {
                id: true,
                grantType: true,
                status: true,
                validFrom: true,
                expiresAt: true,
                sourceType: true,
                sourceId: true,
              },
            },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 100,
    });
    const grants = await db.walletCreditGrant.findMany({
      where: { accountId },
      orderBy: [
        { status: 'asc' },
        { expiresAt: { sort: 'asc', nulls: 'last' } },
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: 100,
    });

    if (!account) {
      throw new NotFoundException({
        code: 'WALLET_ACCOUNT_NOT_FOUND',
        msg: 'Wallet account not found.',
      });
    }

    return {
      account: this.adminWalletAccountDto(account),
      entries: entries.map((entry) => this.adminWalletLedgerEntryDto(entry)),
      grants: grants.map((grant) => ({
        id: grant.id,
        accountId: grant.accountId,
        transactionId: grant.transactionId,
        grantType: grant.grantType,
        status: grant.status,
        totalAmount: grant.totalAmount.toString(),
        availableAmount: grant.availableAmount.toString(),
        heldAmount: grant.heldAmount.toString(),
        consumedAmount: grant.consumedAmount.toString(),
        expiredAmount: grant.expiredAmount.toString(),
        reversedAmount: grant.reversedAmount.toString(),
        priority: grant.priority,
        validFrom: grant.validFrom.toISOString(),
        expiresAt: grant.expiresAt?.toISOString() ?? null,
        sourceType: grant.sourceType,
        sourceId: grant.sourceId,
        metadata: grant.metadata,
        createdAt: grant.createdAt.toISOString(),
        updatedAt: grant.updatedAt.toISOString(),
      })),
    };
  }

  async createAdminWalletAdjustment(
    adminId: string,
    accountId: string,
    input: CreateAdminWalletAdjustmentInput,
  ) {
    return this.prisma.$transaction((tx) =>
      this.postAdminWalletAdjustmentTx(tx, adminId, accountId, input),
    );
  }

  private async postAdminWalletAdjustmentTx(
    tx: Prisma.TransactionClient,
    adminId: string,
    accountId: string,
    input: CreateAdminWalletAdjustmentInput,
  ) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`wallet:account:${accountId}`})::bigint)`;
    await tx.$queryRaw`SELECT id FROM wallet_accounts WHERE id=${accountId}::uuid FOR UPDATE`;
    const account = await tx.walletAccount.findUnique({
      where: { id: accountId },
    });
    if (!account) {
      throw new NotFoundException({
        code: 'WALLET_ACCOUNT_NOT_FOUND',
        msg: 'Wallet account not found.',
      });
    }
    if (account.status !== WalletAccountStatus.active) {
      throw new ConflictException({
        code: 'WALLET_ACCOUNT_NOT_ACTIVE',
        msg: 'Only active wallet accounts can be adjusted.',
      });
    }
    if (
      !(
        account.currency === WalletCurrencyType.compute_point ||
        account.currency === WalletCurrencyType.community_point
      ) ||
      account.balanceKind !== WalletBalanceKind.consumable
    ) {
      throw new ConflictException({
        code: 'ADMIN_WALLET_ADJUSTMENT_UNSUPPORTED_ACCOUNT',
        msg: 'Admin credit adjustments currently support consumable compute/community point wallets only.',
      });
    }

    const amount = input.amount;
    const isPositive = amount > 0n;
    await expireLapsedGrantsTx(tx, account.id);
    await this.walletLedger.postEntryTx(tx, {
      accountId: account.id,
      entryType: WalletLedgerEntryType.adjustment,
      amount: amount > 0n ? amount : -amount,
      availableDelta: amount,
      heldDelta: 0n,
      sourceType: 'admin_wallet_adjustment',
      sourceId: adminId,
      idempotencyKey: `admin_wallet_adjustment:${account.id}:${input.idempotencyKey}`,
      actorUserId: adminId,
      workspaceId:
        account.ownerType === WalletOwnerType.workspace
          ? account.ownerId
          : null,
      description: input.reason,
      reason: isPositive
        ? `admin_${account.currency}_credit`
        : `admin_${account.currency}_debit`,
      metadata: {
        ...input.metadata,
        adminId,
        walletCurrency: account.currency,
        reason: input.reason,
        grantType: input.grantType,
        rawIdempotencyKey: input.idempotencyKey,
      },
      creditGrant: isPositive
        ? {
            grantType: input.grantType as WalletCreditGrantType,
            expiresAt: input.expiresAt ?? null,
            metadata: {
              adminId,
              reason: input.reason,
            },
          }
        : undefined,
    });

    return this.getAdminWalletAccountDetail(account.id, tx);
  }

  async createAdminWorkspaceWalletCredit(
    adminId: string,
    input: CreateAdminWorkspaceWalletCreditInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM workspaces WHERE id=${input.workspaceId}::uuid FOR SHARE`;
      const workspace = await tx.workspace.findFirst({
        where: { id: input.workspaceId, deletedAt: null },
        select: { id: true, name: true, status: true },
      });
      if (!workspace) {
        throw new NotFoundException({
          code: 'WORKSPACE_NOT_FOUND',
          msg: 'Workspace not found.',
        });
      }
      if (workspace.status !== WorkspaceStatus.active) {
        throw new ConflictException({
          code: 'WORKSPACE_NOT_ACTIVE',
          msg: 'Only active workspaces can be credited.',
        });
      }

      // Avoid taking an existing wallet row lock before the ledger advisory lock.
      await tx.walletAccount.createMany({
        data: [
          {
            id: randomUUID(),
            ownerType: WalletOwnerType.workspace,
            ownerId: workspace.id,
            currency: WalletCurrencyType.compute_point,
            balanceKind: WalletBalanceKind.consumable,
            status: WalletAccountStatus.active,
          },
        ],
        skipDuplicates: true,
      });
      const account = await tx.walletAccount.findUniqueOrThrow({
        where: {
          ownerType_ownerId_currency_balanceKind: {
            ownerType: WalletOwnerType.workspace,
            ownerId: workspace.id,
            currency: WalletCurrencyType.compute_point,
            balanceKind: WalletBalanceKind.consumable,
          },
        },
      });

      const result = await this.postAdminWalletAdjustmentTx(
        tx,
        adminId,
        account.id,
        {
          amount: input.amount,
          grantType: input.grantType,
          expiresAt: input.expiresAt,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          metadata: {
            ...input.metadata,
            subject: 'workspace',
            workspaceId: workspace.id,
            workspaceName: workspace.name,
          },
        },
      );
      return result;
    });
  }

  /**
   * Read-only compute_point balance for a workspace. Sweeps lapsed grants first so the number excludes expired credits.
   */
  async getAdminWorkspaceWalletBalance(
    input: GetAdminWorkspaceWalletCreditQueryInput,
  ) {
    const workspace = await this.prisma.workspace.findFirst({
      where: { id: input.workspaceId, deletedAt: null },
      select: {
        id: true,
        name: true,
        status: true,
        ownerUserId: true,
      },
    });
    if (!workspace) {
      throw new NotFoundException({
        code: 'WORKSPACE_NOT_FOUND',
        msg: 'Workspace not found.',
      });
    }

    let account = await this.prisma.walletAccount.findUnique({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: WalletOwnerType.workspace,
          ownerId: workspace.id,
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        },
      },
      select: { id: true, availableBalance: true, heldBalance: true },
    });
    if (
      account &&
      isGrantBackedCurrencyKind(
        WalletCurrencyType.compute_point,
        WalletBalanceKind.consumable,
      )
    ) {
      await this.walletLedger
        .expireLapsedGrants(account.id)
        .catch(() => undefined);
      account = await this.prisma.walletAccount.findUnique({
        where: { id: account.id },
        select: { id: true, availableBalance: true, heldBalance: true },
      });
    }

    return {
      workspace: {
        id: workspace.id,
        name: workspace.name,
        status: workspace.status,
        ownerUserId: workspace.ownerUserId,
      },
      accountId: account?.id ?? null,
      hasWallet: Boolean(account),
      availableBalance: account ? account.availableBalance.toString() : '0',
      heldBalance: account ? account.heldBalance.toString() : '0',
    };
  }

  /**
   * Search all workspaces for the admin wallet picker; `query` matches id / name (case-insensitive) / ownerUserId.
   * Returns each workspace's current compute_point balance so the operator can
   * pick the right pot without a second round-trip.
   */
  async listAdminWorkspaces(input: ListAdminWorkspacesQueryInput) {
    const where: Prisma.WorkspaceWhereInput = { deletedAt: null };
    const query = input.query?.trim();
    if (query) {
      // ownerUserId is stored raw; the operator may type the raw id, or paste
      // the encoded public id they see elsewhere — match on both.
      const decodedId = decodeUserId(query);
      const or: Prisma.WorkspaceWhereInput[] = [
        { name: { contains: query, mode: 'insensitive' } },
        { ownerUserId: query },
      ];
      if (/^\d+$/.test(decodedId) && decodedId !== query) {
        or.push({ ownerUserId: decodedId });
      }
      if (
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          query,
        )
      ) {
        or.push({ id: query });
      }
      where.OR = or;
    }

    // "This person's workspaces" = owned OR joined. Owning without a member row
    // is possible on older data, so both arms are needed. The UI passes the
    // encoded public id; decode to the real id the workspace table stores.
    const rawRelatedUserId = input.relatedUserId?.trim()
      ? decodeUserId(input.relatedUserId.trim())
      : undefined;
    if (rawRelatedUserId) {
      where.AND = [
        {
          OR: [
            { ownerUserId: rawRelatedUserId },
            {
              members: {
                some: { userId: rawRelatedUserId, removedAt: null },
              },
            },
          ],
        },
      ];
    }

    const workspaces = await this.prisma.workspace.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }],
      take: input.limit,
      select: {
        id: true,
        name: true,
        status: true,
        ownerUserId: true,
        createdAt: true,
        _count: {
          select: { members: { where: { status: 'active', removedAt: null } } },
        },
        // Only that user's own membership row, so each workspace can say what
        // they are in it (owner / admin / member).
        ...(rawRelatedUserId
          ? {
              members: {
                where: { userId: rawRelatedUserId, removedAt: null },
                select: { role: true, status: true },
                take: 1,
              },
            }
          : {}),
      },
    });

    const accounts = workspaces.length
      ? await this.readWalletAccounts({
          ownerType: WalletOwnerType.workspace,
          ownerId: { in: workspaces.map((workspace) => workspace.id) },
          currency: WalletCurrencyType.compute_point,
          balanceKind: WalletBalanceKind.consumable,
        })
      : [];
    const balanceByWorkspace = new Map(
      accounts.map((account) => [account.ownerId, account]),
    );

    return {
      items: workspaces.map((workspace) => {
        const account = balanceByWorkspace.get(workspace.id);
        const membership =
          'members' in workspace ? workspace.members?.[0] : undefined;
        return {
          id: workspace.id,
          name: workspace.name,
          status: workspace.status,
          // Encoded public id — the raw owner id stays server-side.
          ownerUserId: encodeUserId(workspace.ownerUserId),
          memberCount: workspace._count.members,
          createdAt: workspace.createdAt.toISOString(),
          hasWallet: Boolean(account),
          availableBalance: account ? account.availableBalance.toString() : '0',
          heldBalance: account ? account.heldBalance.toString() : '0',
          // Present only when the caller asked about a specific user.
          ...(rawRelatedUserId
            ? {
                relatedUserRole:
                  workspace.ownerUserId === rawRelatedUserId
                    ? 'owner'
                    : (membership?.role ?? null),
              }
            : {}),
        };
      }),
    };
  }

  private adminWalletAccountDto(
    account: WalletAccount & { _count?: { ledgerEntries: number } },
  ) {
    return {
      id: account.id,
      ownerType: account.ownerType,
      ownerId: account.ownerId,
      currency: account.currency,
      balanceKind: account.balanceKind,
      status: account.status,
      availableBalance: account.availableBalance.toString(),
      heldBalance: account.heldBalance.toString(),
      ledgerEntryCount: account._count?.ledgerEntries ?? 0,
      updatedAt: account.updatedAt.toISOString(),
    };
  }

  private adminWalletLedgerEntryDto(
    entry: AdminWalletLedgerEntryWithRelations,
  ) {
    return {
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
      creditAllocations: entry.creditAllocations.map((allocation) => ({
        id: allocation.id,
        grantId: allocation.grantId,
        grantType: allocation.grant.grantType,
        grantStatus: allocation.grant.status,
        amount: allocation.amount.toString(),
        availableDelta: allocation.availableDelta.toString(),
        heldDelta: allocation.heldDelta.toString(),
        consumedDelta: allocation.consumedDelta.toString(),
        expiredDelta: allocation.expiredDelta.toString(),
        reversedDelta: allocation.reversedDelta.toString(),
        validFrom: allocation.grant.validFrom.toISOString(),
        expiresAt: allocation.grant.expiresAt?.toISOString() ?? null,
        sourceType: allocation.grant.sourceType,
        sourceId: allocation.grant.sourceId,
      })),
      createdAt: entry.createdAt.toISOString(),
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
        metadata: price.metadata,
        updatedAt: price.updatedAt.toISOString(),
      })),
    };
  }

  async createAdminPrice(adminId: string, input: CreateAdminBillingPriceInput) {
    const priceMetadata = normalizeAdminPriceMetadata(input);
    const itemCode = input.itemCode ?? buildBillingItemCode(input);
    return this.prisma.$transaction(async (tx) => {
      if (
        input.productType === 'membership_plan' ||
        input.productType === 'team_membership_plan'
      ) {
        await this.requireMembershipPlanForPriceTx(tx, input);
      }
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
            ...priceMetadata,
            createdByAdminId: adminId,
          } as Prisma.InputJsonValue,
          providerBindings: {
            create: input.providerBindings.map((binding) => ({
              provider: binding.provider as PaymentProvider,
              providerProductId: binding.providerProductId ?? null,
              providerPriceId: binding.providerPriceId ?? null,
              providerMode: binding.providerMode ?? null,
              status: initialPriceProviderBindingStatus({
                provider: binding.provider as PaymentProvider,
                currency: input.currency,
                cell: CURRENT_CELL,
                requestedStatus: binding.status as BillingProviderBindingStatus,
              }),
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
    return this.prisma.$transaction(async (tx) => {
      const target = await tx.billingPrice.findUnique({
        where: { id: priceId },
        select: { itemId: true },
      });
      if (target)
        await tx.$queryRaw`SELECT id FROM billing_catalog_items WHERE id=${target.itemId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM billing_prices WHERE id=${priceId}::uuid FOR UPDATE`;
      const price = await tx.billingPrice.findUnique({
        where: { id: priceId },
      });
      if (!price)
        throw new NotFoundException({
          code: 'BILLING_PRICE_NOT_FOUND',
          msg: 'Billing price not found.',
        });
      const archivedAt =
        input.archived === undefined
          ? price.archivedAt
          : input.archived
            ? new Date()
            : null;
      await tx.billingCatalogItem.update({
        where: { id: price.itemId },
        data: {
          name: input.itemName ?? undefined,
          description:
            input.itemDescription === undefined
              ? undefined
              : input.itemDescription,
        },
      });
      await tx.billingPrice.update({
        where: { id: priceId },
        data: {
          isActive: input.isActive ?? undefined,
          archivedAt,
          metadata: input.priceMetadata
            ? (input.priceMetadata as Prisma.InputJsonValue)
            : undefined,
        },
      });
      return this.getAdminPrice(priceId, tx);
    });
  }

  async upsertAdminProviderBinding(
    priceId: string,
    input: UpsertAdminBillingProviderBindingInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_prices WHERE id=${priceId}::uuid FOR UPDATE`;
      const price = await tx.billingPrice.findUnique({
        where: { id: priceId },
      });
      if (!price) {
        throw new NotFoundException({
          code: 'BILLING_PRICE_NOT_FOUND',
          msg: 'Billing price not found.',
        });
      }
      const existing = await tx.billingProviderPriceBinding.findFirst({
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
        status: initialPriceProviderBindingStatus({
          provider: input.provider as PaymentProvider,
          currency: price.currency,
          cell: CURRENT_CELL,
          requestedStatus: input.status as BillingProviderBindingStatus,
        }),
        syncError: null,
        metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
      };
      if (existing) {
        return tx.billingProviderPriceBinding.update({
          where: { id: existing.id },
          data,
        });
      }
      return tx.billingProviderPriceBinding.create({
        data: {
          priceId,
          provider: input.provider as PaymentProvider,
          ...data,
        },
      });
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
    if (isWechatAmountBasedPriceProvider(binding.provider)) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_PROVIDER_CATALOG_SYNC_UNSUPPORTED',
        msg: `Payment provider "${binding.provider}" uses internal prices and does not support catalog sync.`,
      });
    }
    const adapter = this.providerRegistry.get(binding.provider);
    if (!adapter.syncPrice) {
      throw new ServiceUnavailableException({
        code: 'PAYMENT_PROVIDER_CATALOG_SYNC_UNSUPPORTED',
        msg: `Payment provider "${binding.provider}" does not support catalog sync.`,
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

  /**
   * Bulk-sync every pending/failed provider binding (idempotent). Run after a
   * seed/deploy to create the Airwallex product/price objects + populate
   * providerPriceId across the whole catalog in one call — no manual per-binding
   * clicks. Re-runnable: active bindings are not in the filter, so only
   * sync_pending/sync_failed are (re)attempted; one binding failing is recorded
   * and never aborts the batch.
   */
  async syncPendingProviderBindings() {
    const bindings = await this.prisma.billingProviderPriceBinding.findMany({
      where: {
        provider: { not: PaymentProvider.wechat_pay },
        status: {
          in: [
            BillingProviderBindingStatus.sync_pending,
            BillingProviderBindingStatus.sync_failed,
          ],
        },
        archivedAt: null,
      },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    const failures: Array<{ bindingId: string; error: string }> = [];
    let synced = 0;
    for (const binding of bindings) {
      try {
        await this.syncAdminProviderBinding(binding.id);
        synced += 1;
      } catch (err) {
        const error =
          err instanceof Error ? err.message : 'Provider sync failed.';
        this.logger.warn(
          `Provider binding sync failed for ${binding.id}: ${error}`,
        );
        failures.push({ bindingId: binding.id, error });
      }
    }
    return {
      total: bindings.length,
      synced,
      failed: failures.length,
      failures,
    };
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
    assertAdminPromotionProviderPolicy(input);
    const promotion = await this.prisma.billingPromotion.create({
      data: {
        applyMode: input.applyMode as BillingPromotionApplyMode,
        code: input.code ?? null,
        name: input.name,
        description: input.description ?? null,
        status: input.status as BillingPromotionStatus,
        percentOffBps: input.percentOffBps ?? null,
        amountOffMinor: input.amountOffMinor ?? null,
        amountOffCurrency: input.amountOffCurrency ?? null,
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
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_promotions WHERE id=${promotionId}::uuid FOR UPDATE`;
      const existing = await tx.billingPromotion.findUnique({
        where: { id: promotionId },
      });
      if (!existing) {
        throw new NotFoundException({
          code: 'BILLING_PROMOTION_NOT_FOUND',
          msg: 'Billing promotion not found.',
        });
      }
      const startsAt =
        input.startsAt === undefined ? existing.startsAt : input.startsAt;
      const endsAt =
        input.endsAt === undefined ? existing.endsAt : input.endsAt;
      if (startsAt && endsAt && endsAt <= startsAt)
        throw new BadRequestException({
          code: 'BILLING_PROMOTION_TIME_WINDOW_INVALID',
          msg: 'Promotion end time must be after start time.',
        });
      const promotion = await tx.billingPromotion.update({
        where: { id: promotionId },
        data: {
          name: input.name ?? undefined,
          description:
            input.description === undefined ? undefined : input.description,
          status: input.status as BillingPromotionStatus | undefined,
          startsAt: input.startsAt === undefined ? undefined : input.startsAt,
          endsAt: input.endsAt === undefined ? undefined : input.endsAt,
          maxRedemptions:
            input.maxRedemptions === undefined
              ? undefined
              : input.maxRedemptions,
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
    });
  }

  async upsertAdminPromotionProviderBinding(
    promotionId: string,
    input: UpsertAdminBillingPromotionProviderBindingInput,
  ) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_promotions WHERE id=${promotionId}::uuid FOR UPDATE`;
      const promotion = await tx.billingPromotion.findUnique({
        where: { id: promotionId },
      });
      if (!promotion) {
        throw new NotFoundException({
          code: 'BILLING_PROMOTION_NOT_FOUND',
          msg: 'Billing promotion not found.',
        });
      }
      if (
        promotion.appliesProductType === BillingProductType.compute_point_pack
      ) {
        assertComputePointPromotionProviderAllowed(
          input.provider as PaymentProvider,
        );
      }
      const existing = await tx.billingPromotionProviderBinding.findFirst({
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
        return tx.billingPromotionProviderBinding.update({
          where: { id: existing.id },
          data,
        });
      }
      return tx.billingPromotionProviderBinding.create({
        data: {
          promotionId,
          provider: input.provider as PaymentProvider,
          ...data,
        },
      });
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
        percentOffBps: binding.promotion.percentOffBps ?? undefined,
        amountOffMinor: binding.promotion.amountOffMinor,
        amountOffCurrency: binding.promotion.amountOffCurrency,
        durationType: binding.promotion.durationType,
        durationCount: binding.promotion.durationCount,
        durationUnit: binding.promotion.durationUnit,
        expiresAt: binding.promotion.endsAt,
        metadata: {
          fizzdragon_promotion_id: binding.promotion.id,
          // Automatic (no-code) promotions have no code to record.
          ...(binding.promotion.code
            ? { fizzdragon_promotion_code: binding.promotion.code }
            : {}),
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
    const id = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:provider_event:${eventId}`})::bigint)`;
      const event = await tx.billingPaymentProviderEvent.findUnique({
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
      await tx.billingPaymentProviderEvent.update({
        where: { id: event.id },
        data: {
          status: PaymentProviderEventStatus.ignored,
          processedAt: new Date(),
          error: reason,
        },
      });
      return event.id;
    });
    return this.getAdminProviderEvent(id);
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
    const admitted = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:refund_intent:${input.idempotencyKey}`})::bigint)`;
      const existing = await tx.billingRefund.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        include: { order: { include: { item: true } }, paymentIntent: true },
      });
      if (existing) {
        const metadata = isRecord(existing.metadata) ? existing.metadata : {};
        const fingerprint = metadata.requestFingerprint;
        if (
          existing.requestedById !== adminId ||
          existing.orderId !== input.orderId ||
          existing.reasonCode !== input.reasonCode ||
          existing.operatorNote !== (input.operatorNote || null) ||
          (typeof fingerprint === 'string'
            ? fingerprint !== refundIntentFingerprint(adminId, input)
            : (input.amountMinor !== undefined &&
                existing.amountMinor !== input.amountMinor) ||
              (input.percentBps !== undefined &&
                metadata.requestedPercentBps !== input.percentBps))
        ) {
          throw new ConflictException({
            code: 'BILLING_REFUND_INTENT_CONFLICT',
            msg: 'This refund intent was already used for a different request.',
          });
        }
        return { kind: 'replay' as const, existing };
      }
      const prepared = await this.prepareAdminRefundTx(tx, adminId, input);
      return { kind: 'admitted' as const, prepared };
    });
    if (admitted.kind === 'replay')
      return this.adminRefundDto(admitted.existing);
    const prepared = admitted.prepared;

    const adapter = this.providerRegistry.get(prepared.refund.provider);
    if (!adapter.capabilities.refund || !adapter.createRefund) {
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
        originalAmountMinor: prepared.originalAmountMinor,
        currency: prepared.refund.currency,
        reason: refundReasonForProvider(prepared.refund),
        metadata: {
          fizzdragon_refund_id: prepared.refund.id,
          fizzdragon_refund_no: prepared.refund.refundNo,
          fizzdragon_order_id: prepared.refund.orderId,
        },
      });
    } catch (err) {
      if (err instanceof WechatRefundUnconfirmedException) {
        // No proof of rejection: do not restore spendable benefits or admit a new refund.
        // A callback may already have settled this record while the response was lost.
        await this.prisma.billingRefund.updateMany({
          where: {
            id: prepared.refund.id,
            status: BillingRefundStatus.requested,
          },
          data: {
            status: BillingRefundStatus.provider_pending,
            failureCode: 'WECHAT_PAY_REFUND_UNCONFIRMED',
            failureMessage: err.message,
          },
        });
        throw err;
      }
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

    // Stop the recurring mandate at the provider (the refund returns the money;
    // NONE proration avoids a double refund). Best-effort: the subscription is
    // already marked canceled in our DB and renewal is guarded against canceled
    // subscriptions, so a provider hiccup here cannot re-charge silently — but
    // log it loudly for follow-up.
    if (prepared.cancelProviderSubscriptionId && adapter.cancelSubscription) {
      try {
        await adapter.cancelSubscription({
          requestId: randomUUID(),
          providerSubscriptionId: prepared.cancelProviderSubscriptionId,
          prorationBehavior: 'NONE',
        });
      } catch (err) {
        this.logger.error(
          `Refund ${prepared.refund.id}: provider subscription cancel failed for ${prepared.cancelProviderSubscriptionId}`,
          err instanceof Error ? err.stack : String(err),
        );
      }
    }

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
      // A reused key must carry the SAME billing intent — otherwise the caller
      // would silently get back an order for a different price/promotion/
      // subject. Mirrors the compute top-up guard.
      const existingMetadata = isRecord(existingOrder.metadata)
        ? existingOrder.metadata
        : {};
      const existingPromotionCode = stringAt(existingMetadata, [
        'promotion',
        'code',
      ]);
      const requestedPromotionCode = input.promotionCode
        ? input.promotionCode.trim().toUpperCase()
        : null;
      if (
        existingOrder.priceId !== input.priceId ||
        existingOrder.quantity !== input.quantity ||
        existingOrder.workspaceId !== (input.workspaceId ?? null) ||
        existingPromotionCode !== requestedPromotionCode
      ) {
        throw new ConflictException({
          code: 'BILLING_IDEMPOTENCY_KEY_REUSED',
          msg: 'Idempotency key was already used for a different billing intent.',
        });
      }
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
    // Compute-point packs have a dedicated endpoint (/compute-topup) that resolves
    // the workspace owner + per-currency exchange rate; routing them through the
    // generic checkout would bypass that, so keep them out. Community-point packs
    // are user-scoped USD SKUs whose wallet grant is frozen straight from the price
    // below (grantsWalletAmount/Kind) and fulfilled off that snapshot — they
    // checkout normally here. This is the same path the existing community-point
    // orders were created + fulfilled through before the over-broad guard.
    if (price.item.productType === BillingProductType.compute_point_pack) {
      throw new BadRequestException({
        code: 'BILLING_PRICE_NOT_CHECKOUTABLE',
        msg: 'Use the dedicated /compute-topup endpoint for compute credit packs.',
      });
    }
    if (
      isMembershipProductType(price.item.productType) &&
      input.quantity !== 1
    ) {
      throw new BadRequestException({
        code: 'BILLING_MEMBERSHIP_QUANTITY_INVALID',
        msg: 'Membership checkout quantity must be exactly 1.',
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
        await this.lockCheckoutWorkspace(tx, user, subject);
        if (isMembershipProductType(price.item.productType)) {
          const now = new Date();
          const productTypes = membershipProductAxis(price.item.productType);
          await tx.$executeRaw`
            SELECT pg_advisory_xact_lock(
              hashtext(${`billing:membership-checkout:${subject.subjectType}:${subject.subjectId}:${productTypes.join(',')}`})::bigint
            )
          `;

          const existingSubscription = await tx.billingSubscription.findFirst({
            where: {
              subjectType: subject.subjectType,
              subjectId: subject.subjectId,
              status: {
                in: [
                  BillingSubscriptionStatus.incomplete,
                  BillingSubscriptionStatus.active,
                  BillingSubscriptionStatus.past_due,
                ],
              },
              price: { item: { productType: { in: productTypes } } },
            },
            select: { id: true },
          });
          const activeGrant = await tx.entitlementGrant.findFirst({
            where: {
              subjectType: subject.subjectType,
              subjectId: subject.subjectId,
              status: EntitlementGrantStatus.active,
              startsAt: { lte: now },
              OR: [{ endsAt: null }, { endsAt: { gt: now } }],
              planKey:
                price.item.productType ===
                BillingProductType.community_membership_plan
                  ? COMMUNITY_MEMBERSHIP_PLAN_KEY
                  : { in: ['basic', 'standard', 'pro', 'team'] },
            },
            select: { id: true },
          });
          const pendingOrder = await tx.billingOrder.findFirst({
            where: {
              subjectType: subject.subjectType,
              subjectId: subject.subjectId,
              status: {
                in: [
                  BillingOrderStatus.pending_payment,
                  BillingOrderStatus.paid,
                ],
              },
              OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
              item: { productType: { in: productTypes } },
            },
            select: { id: true },
          });
          if (existingSubscription || activeGrant || pendingOrder) {
            throw new ConflictException({
              code: 'BILLING_MEMBERSHIP_ALREADY_ACTIVE',
              msg: 'This account already has an active or pending membership. Cancel it and wait for the current period to end before choosing another plan.',
            });
          }
        }

        const promotionReservation = input.promotionCode
          ? await this.reserveCheckoutPromotionTx(tx, {
              userId: user.userId,
              provider,
              code: input.promotionCode,
              price,
              subtotalAmountMinor,
              now: new Date(),
            })
          : // No code → auto-apply the best active automatic sale (or null).
            // Code takes priority; discounts never stack (v1).
            await this.resolveAutomaticPromotionTx(tx, {
              provider,
              price,
              subtotalAmountMinor,
              now: new Date(),
            });
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
              // AppLovin (Axon) ad-attribution, read back at payment success to
              // build the S2S conversion report. Omitted when no attribution was
              // supplied (no AppLovin context); purely additive — never affects
              // pricing/fulfilment.
              ...appLovinMetadataPatch(input.attribution),
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
        await this.checkCheckoutWorkspace(tx, user, subject);
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

  // Compute-point top-up is a fixed catalog product, so payable orders go
  // through provider Billing Checkout with a synced provider price and coupon.
  // This keeps provider collection, internal order amount, and wallet grant in
  // one auditable flow. Only fully-discounted redemptions bypass the provider.
  async createComputePointTopup(
    user: AuthUser,
    input: CreateComputePointTopupInput,
    shopperCountry: string,
  ) {
    this.assertReturnUrlAllowed(input.successUrl);
    this.assertReturnUrlAllowed(input.backUrl);

    const policy = computePointTopupPolicy();
    const sdkEnv = airwallexSdkEnv();
    const country = (shopperCountry || 'US').toUpperCase();
    const provider =
      (input.provider as PaymentProvider | undefined) ?? policy.defaultProvider;
    if (!policy.providers.includes(provider)) {
      throw new ServiceUnavailableException({
        code: 'BILLING_COMPUTE_TOPUP_PROVIDER_UNSUPPORTED',
        msg: `Compute point top-up in this deployment supports ${policy.providers.join(
          ', ',
        )} with ${policy.currency} only.`,
      });
    }

    // Direct the credit at the caller's wallet, or a team's shared wallet when a
    // workspaceId is supplied (billing role required). The pack price stays a
    // user-subject SKU; the fulfillment routes the grant off order.subjectType.
    const subject = await this.resolveTopupSubject(user, input.workspaceId);

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
      const existingMetadata = isRecord(existingOrder.metadata)
        ? existingOrder.metadata
        : {};
      const existingPromotionCode = stringAt(existingMetadata, [
        'promotion',
        'code',
      ]);
      const requestedPromotionCode = input.promotionCode
        ? input.promotionCode.trim().toUpperCase()
        : null;
      if (
        existingOrder.orderType !== BillingOrderType.compute_point_topup ||
        existingOrder.priceId !== input.priceId ||
        existingPromotionCode !== requestedPromotionCode ||
        (existingOrder.workspaceId ?? null) !== subject.workspaceId
      ) {
        throw new ConflictException({
          code: 'BILLING_IDEMPOTENCY_KEY_REUSED',
          msg: 'Idempotency key was already used for a different billing intent.',
        });
      }
      return {
        order: this.orderDto(existingOrder),
        paymentIntent: existingOrder.paymentIntents[0]
          ? this.paymentIntentDto(existingOrder.paymentIntents[0])
          : null,
        shopperCountry: country,
        env: sdkEnv,
      };
    }

    const adapter = this.providerRegistry.get(provider);

    const price = await this.prisma.billingPrice.findFirst({
      where: {
        id: input.priceId,
        isActive: true,
        archivedAt: null,
        currency: policy.currency,
        item: {
          productType: BillingProductType.compute_point_pack,
          isActive: true,
          archivedAt: null,
        },
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
        code: 'BILLING_COMPUTE_TOPUP_PRICE_NOT_FOUND',
        msg: 'Compute point top-up package is not available.',
      });
    }
    assertComputePointTopupPrice(price, policy);

    const requestId = randomUUID();
    const orderNo = createOrderNo();
    const subtotalAmountMinor = price.amountMinor;
    const txResult = await this.prisma
      .$transaction(async (tx) => {
        await this.lockCheckoutWorkspace(tx, user, subject);
        const promotionReservation = input.promotionCode
          ? await this.reserveCheckoutPromotionTx(tx, {
              userId: user.userId,
              provider,
              code: input.promotionCode,
              price,
              subtotalAmountMinor,
              now: new Date(),
            })
          : // No code → auto-apply the best active automatic sale (or null).
            // Code takes priority; discounts never stack (v1).
            await this.resolveAutomaticPromotionTx(tx, {
              provider,
              price,
              subtotalAmountMinor,
              now: new Date(),
            });
        const discountAmountMinor =
          promotionReservation?.discountAmountMinor ?? 0n;
        const amountMinor = subtotalAmountMinor - discountAmountMinor;
        const requiresExternalPayment = amountMinor > 0n;
        const providerBinding = requiresExternalPayment
          ? price.providerBindings[0]
          : null;
        if (requiresExternalPayment && !providerBinding) {
          throw new ConflictException({
            code: 'BILLING_COMPUTE_TOPUP_PROVIDER_BINDING_MISSING',
            msg: `Compute point top-up package is not available through "${provider}". Sync the provider price before enabling sales.`,
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
            orderType: BillingOrderType.compute_point_topup,
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
            quantity: 1,
            grantsWalletAmount: price.grantsWalletAmount,
            grantsWalletCurrency: price.grantsWalletCurrency,
            grantsWalletBalanceKind: price.grantsWalletBalanceKind,
            description: price.item.name,
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            metadata: {
              checkout: {
                successUrl: input.successUrl,
                backUrl: input.backUrl,
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
              computePointTopup: {
                cell: policy.cell,
                shopperCountry: country,
                rateMode: policy.rateMode,
                exchangeRate:
                  price.currency === COMPUTE_POINT_FIAT_CURRENCY
                    ? {
                        computePointsPerUsdCent: COMPUTE_POINTS_PER_USD_CENT,
                        usdCentsPerComputePoint: 1,
                      }
                    : null,
              },
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
              providerDiscountId: promotionReservation.providerCouponId,
              status: BillingPromotionRedemptionStatus.reserved,
              currency: price.currency,
              subtotalAmountMinor,
              discountAmountMinor,
              metadata: {
                priceId: price.id,
                itemId: price.itemId,
                productType: price.item.productType,
                providerCouponRequired: requiresExternalPayment,
              },
            },
          });
          await tx.billingPromotion.update({
            where: { id: promotionReservation.promotion.id },
            data: { redemptionCount: { increment: 1 } },
          });
        }
        await this.checkCheckoutWorkspace(tx, user, subject);
        return { order, promotionReservation };
      })
      // Lost the (userId, idempotencyKey) race with a concurrent first-time
      // request: the order now exists, so replay through the idempotency branch
      // above instead of surfacing the raw unique-constraint violation.
      .catch((error) => {
        if (isUniqueConstraintViolation(error)) return null;
        throw error;
      });
    if (txResult === null) {
      return this.replayExistingOrder(
        user.userId,
        input.idempotencyKey,
        country,
        sdkEnv,
      );
    }
    const { order, promotionReservation } = txResult;

    if (order.amountMinor === 0n) {
      await this.prisma.$transaction((tx) =>
        this.markOrderPaidAndFulfill(tx, order, new Date(), null, null, {
          internalPromotionCheckout: true,
          promotionCode: promotionReservation?.promotion.code ?? null,
          devSkipPayment: order.amountMinor > 0n,
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
        shopperCountry: country,
        env: sdkEnv,
      };
    }

    const providerBinding = price.providerBindings[0];
    assertProviderBindingReady(providerBinding);
    let checkout: HostedCheckoutResult;
    try {
      checkout = await adapter.createHostedCheckout({
        requestId,
        mode: 'PAYMENT',
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
            quantity: 1,
            providerCouponId:
              promotionReservation?.providerCouponId ?? undefined,
          },
        ],
        metadata: {
          fizzdragon_order_id: order.id,
          fizzdragon_order_no: order.orderNo,
          fizzdragon_user_id: user.userId,
          fizzdragon_product_type: BillingProductType.compute_point_pack,
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
      shopperCountry: country,
      env: sdkEnv,
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

    // The arbitrary-amount recharge funds either the community wallet (default,
    // user-only) or the compute wallet (which may target a team workspace). Each
    // currency has its own hidden anchor SKU + order type; the workspace is only
    // honored for compute (community recharge stays user-owned).
    const isCompute = input.currency === WalletCurrencyType.compute_point;
    const anchorCode = isCompute
      ? COMPUTE_RECHARGE_ITEM_CODE
      : CUSTOM_RECHARGE_ITEM_CODE;
    const orderType = isCompute
      ? BillingOrderType.compute_point_topup
      : BillingOrderType.community_point_topup;
    const subject = isCompute
      ? await this.resolveTopupSubject(user, input.workspaceId)
      : {
          subjectType: BillingSubjectType.user,
          subjectId: user.userId,
          workspaceId: null as string | null,
        };

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
      if (
        existingOrder.orderType !== orderType ||
        (existingOrder.workspaceId ?? null) !== subject.workspaceId
      ) {
        throw new ConflictException({
          code: 'BILLING_IDEMPOTENCY_KEY_REUSED',
          msg: 'Idempotency key was already used for a different billing intent.',
        });
      }
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
    // Custom-amount recharge routes to the provider's one-off surface: Airwallex
    // via a Payment Intent (client_secret + browser SDK); WeChat/Alipay via a
    // hosted checkout 下单 (weixin:// code_url, scanned as a QR). Need at least one.
    // Test declared CAPABILITIES, not method presence: UnsupportedPaymentProvider
    // (e.g. alipay on a deployment without it) DEFINES createPaymentIntent but only
    // to reject — capabilities.* is the source of truth, so we fail cleanly here
    // instead of minting an order that then dies at the provider call.
    if (
      !adapter.capabilities.paymentIntent &&
      !adapter.capabilities.hostedCheckout
    ) {
      throw new ServiceUnavailableException({
        code: 'BILLING_PROVIDER_NO_CUSTOM_RECHARGE',
        msg: `"${provider}" does not support custom-amount recharge.`,
      });
    }

    // Compute recharge derives its point grant from the per-cell anchor's own
    // ratio (its price ↔ its grant), so every cell/currency works — including
    // explicit-admin-priced cells (CN/CNY): the CN anchor is ¥7 = 100 points.
    // Constrain the provider to the cell's allow-list (community recharge keeps
    // its prior, provider-agnostic behavior).
    if (isCompute) {
      const policy = computePointTopupPolicy();
      if (!policy.providers.includes(provider)) {
        throw new ServiceUnavailableException({
          code: 'BILLING_COMPUTE_TOPUP_PROVIDER_UNSUPPORTED',
          msg: `Compute point recharge in this deployment supports ${policy.providers.join(', ')} only.`,
        });
      }
    }

    // The hidden anchor SKU carries only the points-per-$1 ratio + wallet currency
    // for ledger routing. It has no provider binding, so it never appears in the
    // public listing and is reached only here.
    // MUST scope by the cell's billing currency: the shared migration
    // 20260615160000 seeds a USD anchor price on this item on EVERY cell (not
    // cell-gated), so on CN both a USD and a CNY row can be active. Without this
    // filter findFirst picks arbitrarily — the USD row would 7×-over-grant AND set
    // order.currency=USD, which WeChat can't settle (下单 rejects).
    const anchorCurrency = CURRENT_CELL === 'cn' ? 'CNY' : 'USD';
    const anchor = await this.prisma.billingPrice.findFirst({
      where: {
        isActive: true,
        archivedAt: null,
        currency: anchorCurrency,
        item: {
          code: anchorCode,
          isActive: true,
          archivedAt: null,
        },
      },
      include: { item: true },
    });
    if (
      !anchor ||
      !anchor.grantsWalletCurrency ||
      !anchor.grantsWalletAmount ||
      anchor.amountMinor <= 0n
    ) {
      throw new ServiceUnavailableException({
        code: 'BILLING_CUSTOM_RECHARGE_UNAVAILABLE',
        msg: 'Custom recharge is not configured.',
      });
    }

    const amountMajor = BigInt(input.amountDollars);
    const amountMinor = amountMajor * 100n;
    // Point grant from the anchor's own ratio (its price ↔ its grant), so any
    // cell/currency works: points = amountMinor × anchorGrant / anchorPrice.
    // .com anchor ($1 = 100 pts): amountMinor × 100/100 = amountMinor (1 pt/cent).
    // .cn  anchor (¥7 = 100 pts): amountMinor × 100/700 = amountMinor/7 (1 pt/7 分).
    const grantSnapshot =
      (amountMinor * anchor.grantsWalletAmount) / anchor.amountMinor;
    const requestId = randomUUID();
    const orderNo = createOrderNo();

    const order = await this.prisma
      .$transaction(async (tx) => {
        await this.lockCheckoutWorkspace(tx, user, subject);
        const created = await tx.billingOrder.create({
          data: {
            orderNo,
            idempotencyKey: input.idempotencyKey,
            userId: user.userId,
            workspaceId: subject.workspaceId,
            subjectType: subject.subjectType,
            subjectId: subject.subjectId,
            orderType,
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
                currency: input.currency,
                shopperCountry: country,
              },
              // AppLovin (Axon) ad-attribution, read back at payment success to
              // build the S2S conversion report. Omitted when no attribution was
              // supplied; purely additive — never affects pricing/fulfilment.
              ...appLovinMetadataPatch(input.attribution),
            },
          },
          include: { price: true },
        });
        await this.checkCheckoutWorkspace(tx, user, subject);
        return created;
      })
      // Lost the (userId, idempotencyKey) race with a concurrent first-time
      // request: the order now exists, so replay through the idempotency branch
      // above instead of surfacing the raw unique-constraint violation.
      .catch((error) => {
        if (isUniqueConstraintViolation(error)) return null;
        throw error;
      });
    if (order === null) {
      return this.replayExistingOrder(
        user.userId,
        input.idempotencyKey,
        country,
        sdkEnv,
      );
    }

    const failOrder = async (err: unknown, fallback: string) => {
      await this.prisma.billingOrder.update({
        where: { id: order.id },
        data: {
          status: BillingOrderStatus.failed,
          metadata: {
            ...(order.metadata as Record<string, unknown>),
            providerError: err instanceof Error ? err.message : fallback,
          },
        },
      });
    };

    // Route to the provider's one-off surface. Airwallex → Payment Intent
    // (client_secret + browser SDK). WeChat/Alipay → hosted checkout 下单, whose
    // checkoutUrl is a weixin:// code_url the client renders as a QR to scan.
    // Gate on the capability (not method presence) so Unsupported adapters that
    // stub createPaymentIntent fall through to the hosted-checkout branch/guard.
    if (adapter.capabilities.paymentIntent && adapter.createPaymentIntent) {
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
        await failOrder(err, 'Provider payment intent failed.');
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

    // Amount-based provider (WeChat/Alipay): hosted checkout with NO catalog
    // binding — providerPriceId is null, the anchor-derived amount is charged
    // directly. Mirrors the fixed-pack checkout, minus the price binding.
    let checkout: HostedCheckoutResult;
    try {
      checkout = await adapter.createHostedCheckout({
        requestId,
        mode: 'PAYMENT',
        successUrl: input.successUrl,
        backUrl: input.backUrl,
        lineItems: [
          {
            providerPriceId: null,
            internalPriceId: anchor.id,
            name: anchor.item.name,
            currency: order.currency,
            amountMinor,
            quantity: 1,
          },
        ],
        metadata: {
          fizzdragon_order_id: order.id,
          fizzdragon_order_no: order.orderNo,
          fizzdragon_user_id: user.userId,
          fizzdragon_product_type: BillingProductType.compute_point_pack,
        },
      });
    } catch (err) {
      await failOrder(err, 'Provider checkout failed.');
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
      shopperCountry: country,
      env: sdkEnv,
    };
  }

  /**
   * Cancel a recurring subscription. Stops the provider's renewal mandate (no
   * refund — the member keeps the period already paid for, which their
   * EntitlementGrant.endsAt already covers) and marks the subscription canceled.
   * Idempotent: a subscription already canceled/expired returns its current
   * state. The membership entitlement is NOT revoked here — access lapses
   * naturally at endsAt. Use the refund path to revoke + reclaim immediately.
   */
  async cancelSubscription(user: AuthUser, subscriptionId: string) {
    const subscription = await this.prisma.billingSubscription.findUnique({
      where: { id: subscriptionId },
      include: { price: { include: { item: true } } },
    });
    if (!subscription) {
      throw new NotFoundException({
        code: 'BILLING_SUBSCRIPTION_NOT_FOUND',
        msg: 'Subscription not found.',
      });
    }

    // Authz: workspace subscriptions need the workspace billing role (same as
    // buying); user subscriptions are cancelable only by their owner.
    if (subscription.subjectType === BillingSubjectType.workspace) {
      if (!subscription.workspaceId) {
        throw new ConflictException({
          code: 'BILLING_SUBSCRIPTION_WORKSPACE_MISSING',
          msg: 'Workspace subscription has no workspace.',
        });
      }
      await this.permissions.requireWorkspaceRole(
        user.userId,
        subscription.workspaceId,
        WorkspaceMemberRole.billing,
      );
    } else if (subscription.userId !== user.userId) {
      throw new ForbiddenException({
        code: 'BILLING_SUBSCRIPTION_FORBIDDEN',
        msg: 'You cannot cancel this subscription.',
      });
    }

    if (
      subscription.status === BillingSubscriptionStatus.canceled ||
      subscription.status === BillingSubscriptionStatus.expired
    ) {
      return this.subscriptionDto(subscription);
    }

    // Stop the recurring mandate at the provider. NONE = no refund; the paid
    // period stays valid. Skipped only if no provider subscription is on file.
    if (subscription.providerSubscriptionId) {
      const adapter = this.providerRegistry.get(subscription.provider);
      if (!adapter.cancelSubscription) {
        throw new ServiceUnavailableException({
          code: 'BILLING_SUBSCRIPTION_CANCEL_UNSUPPORTED',
          msg: `Provider "${subscription.provider}" cannot cancel subscriptions in this deployment.`,
        });
      }
      await adapter.cancelSubscription({
        requestId: subscription.id,
        providerSubscriptionId: subscription.providerSubscriptionId,
        prorationBehavior: 'NONE',
      });
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM billing_subscriptions WHERE id=${subscription.id}::uuid FOR UPDATE`;
      const current = await tx.billingSubscription.findUnique({
        where: { id: subscription.id },
        include: { price: { include: { item: true } } },
      });
      if (!current) {
        throw new NotFoundException({
          code: 'BILLING_SUBSCRIPTION_NOT_FOUND',
          msg: 'Subscription not found.',
        });
      }
      if (
        current.provider !== subscription.provider ||
        current.providerSubscriptionId !==
          subscription.providerSubscriptionId ||
        current.subjectType !== subscription.subjectType ||
        current.subjectId !== subscription.subjectId
      ) {
        throw new ConflictException({
          code: 'BILLING_SUBSCRIPTION_CHANGED',
          msg: 'Subscription changed during cancellation. Refresh and try again.',
        });
      }
      // Preserve a webhook or another cancellation completed during the provider
      // wait. For an active subscription, retain the latest paid period.
      if (
        current.status === BillingSubscriptionStatus.canceled ||
        current.status === BillingSubscriptionStatus.expired
      )
        return current;
      const now = new Date();
      return tx.billingSubscription.update({
        where: { id: current.id },
        data: {
          status: BillingSubscriptionStatus.canceled,
          cancelAtPeriodEnd: true,
          canceledAt: now,
          endedAt: current.currentPeriodEnd ?? now,
          version: { increment: 1 },
        },
        include: { price: { include: { item: true } } },
      });
    });
    return this.subscriptionDto(updated);
  }

  /** The resolved compute plan plus the exact subscription that backs it. */
  async getMyEntitlement(user: AuthUser, workspaceId?: string | null) {
    const workspaceMembership = workspaceId
      ? await this.permissions.requireWorkspacePresence(
          user.userId,
          workspaceId,
        )
      : null;
    const entitlement = await this.entitlements.resolveForUser(user, {
      workspaceId: workspaceId ?? null,
    });

    const canReadSubscription =
      entitlement.subject.type === 'user' ||
      workspaceMembership?.role === WorkspaceMemberRole.owner ||
      workspaceMembership?.role === WorkspaceMemberRole.admin ||
      workspaceMembership?.role === WorkspaceMemberRole.billing;
    const subscription = canReadSubscription
      ? await this.prisma.billingSubscription.findFirst({
          where: {
            subjectType:
              entitlement.subject.type === 'workspace'
                ? BillingSubjectType.workspace
                : BillingSubjectType.user,
            subjectId: entitlement.subject.id,
            planKey: entitlement.planKey,
            status: {
              in: [
                BillingSubscriptionStatus.active,
                BillingSubscriptionStatus.past_due,
              ],
            },
            price: {
              item: {
                productType: {
                  in: [
                    BillingProductType.membership_plan,
                    BillingProductType.team_membership_plan,
                  ],
                },
              },
            },
          },
          orderBy: { updatedAt: 'desc' },
          include: { price: { include: { item: true } } },
        })
      : null;

    return {
      entitlement,
      subscription: subscription ? this.subscriptionDto(subscription) : null,
    };
  }

  private subscriptionDto(
    subscription: BillingSubscription & {
      price: BillingPrice & { item: BillingCatalogItem };
    },
  ) {
    return {
      id: subscription.id,
      status: subscription.status,
      planKey: subscription.planKey,
      productType: subscription.price.item.productType,
      subjectType: subscription.subjectType,
      currency: subscription.price.currency,
      amountMinor: subscription.price.amountMinor.toString(),
      interval: subscription.price.interval,
      currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
      cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      canceledAt: subscription.canceledAt?.toISOString() ?? null,
      endedAt: subscription.endedAt?.toISOString() ?? null,
    };
  }

  async getOrder(user: AuthUser, orderId: string) {
    const orderInclude = {
      paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 },
      price: true,
    } satisfies Prisma.BillingOrderInclude;
    let order = await this.prisma.billingOrder.findFirst({
      where: { id: orderId },
      include: orderInclude,
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

    // Poll-driven WeChat reconcile: the client polls this endpoint after returning
    // from the WeChat SDK; 查单 + fulfil so the order flips to paid without waiting
    // on the async callback. Only for still-pending WeChat orders; best-effort.
    if (
      order.provider === PaymentProvider.wechat_pay &&
      order.status === BillingOrderStatus.pending_payment &&
      order.price
    ) {
      await this.reconcileWechatOrder(order);
      order =
        (await this.prisma.billingOrder.findFirst({
          where: { id: orderId },
          include: orderInclude,
        })) ?? order;
    }

    return {
      order: this.orderDto(order),
      paymentIntent: order.paymentIntents[0]
        ? this.paymentIntentDto(order.paymentIntents[0])
        : null,
    };
  }

  /**
   * WeChat Pay APP支付 payment notification (支付通知). Verifies + AES-GCM-decrypts
   * the resource (WechatPayProvider), then — ONLY on a confirmed SUCCESS whose
   * paid amount matches the order — marks the order paid and fulfils it, which
   * (post-commit) accrues referral commission. Idempotent: markOrderPaidAndFulfill
   * short-circuits on an already-fulfilled order (advisory lock + upserts). The
   * route MUST return the exact {"code":"SUCCESS","message":"OK"} body.
   */
  async handleWechatWebhook(input: {
    rawBody: Buffer;
    serial?: string;
    signature?: string;
    timestamp?: string;
    nonce?: string;
    signatureType?: string;
  }): Promise<{ received: boolean; deduped?: boolean }> {
    const tx = this.wechatPay.verifyAndDecryptNotification(input);
    if ('refund_status' in tx) return this.handleWechatRefundNotification(tx);
    if (tx.trade_state !== 'SUCCESS') {
      this.logger.log(
        `WeChat notify ${tx.out_trade_no}: trade_state=${tx.trade_state} — no fulfilment`,
      );
      return { received: true };
    }
    const order = await this.prisma.billingOrder.findUnique({
      where: { orderNo: tx.out_trade_no },
      include: { price: true },
    });
    if (!order?.price) {
      // Ack to stop WeChat's ~24h retry storm; surface for investigation.
      this.logger.error(`WeChat notify for unknown order ${tx.out_trade_no}`);
      return { received: true };
    }
    const fulfilled = await this.fulfillPaidWechatOrder(order, tx);
    return fulfilled ? { received: true } : { received: true, deduped: true };
  }

  private async handleWechatRefundNotification(
    notification: WechatRefundNotification,
  ): Promise<{ received: boolean }> {
    await this.prisma.$transaction(async (tx) => {
      const refund = await tx.billingRefund.findFirst({
        where: {
          provider: PaymentProvider.wechat_pay,
          OR: [
            { refundNo: notification.out_refund_no },
            { providerRefundId: notification.refund_id },
          ],
        },
        include: { order: true },
      });
      if (
        !refund ||
        refund.order.orderNo !== notification.out_trade_no ||
        refund.amountMinor !== BigInt(notification.amount.refund) ||
        refund.order.amountMinor !== BigInt(notification.amount.total) ||
        refund.currency !== 'CNY' ||
        (refund.providerRefundId &&
          refund.providerRefundId !== notification.refund_id)
      ) {
        throw new BadRequestException({
          code: 'WECHAT_PAY_REFUND_MISMATCH',
          msg: 'WeChat refund notification does not match a recorded refund.',
        });
      }
      await this.applyProviderRefundSubmissionTx(tx, refund.id, {
        providerRefundId: notification.refund_id,
        providerStatus: notification.refund_status,
        providerPaymentIntentId: notification.out_trade_no,
        raw: { ...notification },
      });
    });
    return { received: true };
  }

  /**
   * Fulfil a WeChat order from a VERIFIED SUCCESS transaction (async callback OR
   * 查单 reconcile). Idempotent — markOrderPaidAndFulfill advisory-locks and
   * short-circuits an already-fulfilled order. Refuses on an amount mismatch
   * (anti-tamper). Fires referral commission post-commit, best-effort. Returns
   * true when it fulfilled, false when it was already fulfilled or refused.
   */
  private async fulfillPaidWechatOrder(
    order: OrderWithPrice,
    tx: WechatTransaction,
  ): Promise<boolean> {
    if (order.status === BillingOrderStatus.fulfilled) return false;
    // Verify-before-fulfil: the amount WeChat actually charged must match the
    // order, or we refuse to fulfil it (anti-tamper).
    const paidTotal = tx.amount?.total;
    if (paidTotal != null && BigInt(paidTotal) !== order.amountMinor) {
      this.logger.error(
        `WeChat amount mismatch ${tx.out_trade_no}: paid ${paidTotal} vs order ${order.amountMinor}`,
      );
      return false;
    }
    const now = new Date();
    await this.prisma.$transaction((prismaTx) =>
      this.markOrderPaidAndFulfill(
        prismaTx,
        order,
        now,
        null,
        tx.transaction_id ?? null,
        tx as unknown as Record<string, unknown>,
      ),
    );
    // Referral commission — own transaction, post-commit, best-effort (a referral
    // failure can never roll back a paid order). CNY orders accrue once the
    // USD-only guard is lifted in referrals.service.
    await this.referrals
      .accrueForOrder(order.id)
      .catch((e) =>
        this.logger.warn(
          `referral accrual failed (wechat order ${order.id}): ${e instanceof Error ? e.message : String(e)}`,
        ),
      );
    return true;
  }

  /**
   * Poll-driven reconcile: for a still-pending WeChat order, 查单 at WeChat and
   * fulfil if it is paid. Best-effort — a query failure must never break the order
   * read. This is the backstop that keeps fulfilment working even when the async
   * callback is missed or (before the APIv3 key is set) cannot be decrypted; the
   * 查单 response is plaintext and needs no APIv3 key.
   */
  private async reconcileWechatOrder(order: OrderWithPrice): Promise<void> {
    try {
      const tx = await this.wechatPay.queryOrder(order.orderNo);
      if (tx?.trade_state === 'SUCCESS') {
        await this.fulfillPaidWechatOrder(order, tx);
      }
    } catch (e) {
      this.logger.warn(
        `WeChat reconcile failed (order ${order.id}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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

      let existing = await tx.billingPaymentProviderEvent.findUnique({
        where: {
          provider_providerEventId: {
            provider: input.provider,
            providerEventId: input.providerEventId,
          },
        },
      });
      if (existing) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:provider_event:${existing.id}`})::bigint)`;
        existing = await tx.billingPaymentProviderEvent.findUniqueOrThrow({
          where: { id: existing.id },
        });
      }
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
    let failureRevision: string | null = null;
    let accrueOrderId: string | null = null;
    let reverseOrderId: string | null = null;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`billing:provider_event:${eventId}`})::bigint)
        `;
        // A later ingestion or decision must survive delayed failure recovery.
        const [revision] = await tx.$queryRaw<
          { revision: string }[]
        >`SELECT xmin::text AS revision FROM billing_payment_provider_events WHERE id=${eventId}::uuid FOR UPDATE`;
        failureRevision = revision?.revision ?? null;
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
          ? await this.matchRefund(tx, providerEvent.provider, payload)
          : null;
        const match = refundMatch
          ? null
          : await this.matchPaymentIntent(tx, providerEvent.provider, payload);
        const renewalMatch =
          !match && !refundMatch
            ? await this.tryApplySubscriptionRenewalEvent(
                tx,
                providerEvent,
                eventType,
                payload,
              )
            : null;
        const lifecycleMatch =
          !match && !refundMatch && !renewalMatch
            ? await this.tryApplySubscriptionLifecycleEvent(
                tx,
                providerEvent,
                eventType,
                payload,
              )
            : null;

        if (!match && !refundMatch && !renewalMatch && !lifecycleMatch) {
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
            orderId:
              refundMatch?.orderId ??
              match?.orderId ??
              renewalMatch?.orderId ??
              null,
            paymentIntentId:
              refundMatch?.paymentIntentId ??
              match?.id ??
              renewalMatch?.paymentIntentId ??
              null,
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
          // Captured for post-commit referral reversal (see below).
          reverseOrderId = refundMatch.orderId;
        } else if (match) {
          await this.applyProviderEvent(
            tx,
            match,
            eventType,
            payload,
            providerEvent.id,
          );
          // Captured for post-commit referral accrual (see below).
          accrueOrderId = match.orderId;
        } else if (renewalMatch?.orderId) {
          // Subscription renewals are real provider-charged money too — the
          // referral hook (per-order 消费返佣 commission) and the AppLovin S2S
          // report fire for them as well. Idempotent per order downstream.
          accrueOrderId = renewalMatch.orderId;
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
      // Best-effort referral accrual AFTER the billing tx commits — runs in its
      // own transaction, so a referral failure can never roll back a paid order.
      if (accrueOrderId) {
        await this.referrals
          .accrueForOrder(accrueOrderId)
          .catch((e: unknown) =>
            this.logger.error(
              `referral accrual failed (order ${accrueOrderId}): ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
      }
      if (reverseOrderId) {
        await this.referrals
          .reverseForOrder(reverseOrderId)
          .catch((e: unknown) =>
            this.logger.error(
              `referral reversal failed (order ${reverseOrderId}): ${e instanceof Error ? e.message : String(e)}`,
            ),
          );
      }
      // Best-effort AppLovin (Axon) S2S purchase report — same post-commit
      // placement + error-swallowing as referral accrual, firing on the exact
      // same genuine-payment-success condition (a matched payment intent). The
      // call never throws and runs outside the billing tx, so a tracking failure
      // can never roll back a paid order. No-op unless the S2S token is set (the
      // .com cell) and the order is a community purchase (filtered inside).
      if (accrueOrderId) {
        await this.reportAppLovinPurchase(accrueOrderId);
      }
      return result;
    } catch (err) {
      if (!isProviderEventAlreadyProcessedError(err)) {
        await this.markProviderEventFailed(eventId, err, failureRevision);
      }
      throw err;
    }
  }

  private async markProviderEventFailed(
    eventId: string,
    err: unknown,
    revision: string | null,
  ): Promise<void> {
    if (!revision) return;
    await this.prisma
      .$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`billing:provider_event:${eventId}`})::bigint)`;
        await tx.$executeRaw`UPDATE billing_payment_provider_events SET status='failed', processed_at=clock_timestamp(), error=${providerEventErrorMessage(err)} WHERE id=${eventId}::uuid AND xmin::text=${revision} AND status <> 'processed'`;
      })
      .catch(() => undefined);
  }

  /**
   * Best-effort AppLovin (Axon) server-to-server purchase report for a just-paid
   * order. Runs post-commit, NEVER throws, and no-ops unless the S2S credentials
   * are configured (the .com cell) AND the order is one of the community purchase
   * flows this integration covers: community membership
   * (`subscription_checkout` / `membership_purchase`) or a community-point
   * recharge (`community_point_topup`). The order id is sent as both
   * `transaction_id` and `dedupe_id` so AppLovin merges this with the browser
   * pixel's purchase event carrying the same id (5-minute window). Attribution
   * (aleid / ip / ua / country) is read back from the order's metadata, captured
   * at checkout; its absence weakens matching but never blocks the report.
   */
  private async reportAppLovinPurchase(orderId: string): Promise<void> {
    if (!this.appLovinConversion.isConfigured()) return;
    try {
      const order = await this.prisma.billingOrder.findUnique({
        where: { id: orderId },
      });
      if (!order) return;
      if (
        order.orderType !== BillingOrderType.subscription_checkout &&
        order.orderType !== BillingOrderType.membership_purchase &&
        order.orderType !== BillingOrderType.community_point_topup
      ) {
        return;
      }
      const metadata = isRecord(order.metadata) ? order.metadata : {};
      const appLovin = isRecord(metadata.appLovin) ? metadata.appLovin : {};
      await this.appLovinConversion.reportWebPurchase({
        orderId: order.orderNo ?? order.id,
        currency: order.currency,
        value: Number(order.amountMinor) / 100,
        aleid: typeof appLovin.aleid === 'string' ? appLovin.aleid : undefined,
        clientUserAgent:
          typeof appLovin.userAgent === 'string'
            ? appLovin.userAgent
            : undefined,
        clientIpAddress:
          typeof appLovin.ip === 'string' ? appLovin.ip : undefined,
        countryCode:
          typeof appLovin.country === 'string' ? appLovin.country : undefined,
        eventSourceUrl:
          stringAt(metadata, ['checkout', 'successUrl']) ?? undefined,
      });
    } catch (e: unknown) {
      this.logger.error(
        `AppLovin S2S purchase report failed (order ${orderId}): ${e instanceof Error ? e.message : String(e)}`,
      );
    }
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
      await this.reconcileProviderPaidAmountTx(tx, order, intent, payload);
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

  private async tryApplySubscriptionRenewalEvent(
    tx: Prisma.TransactionClient,
    providerEvent: BillingPaymentProviderEvent,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<SubscriptionRenewalMatch | null> {
    const providerStatus = stringAt(payload, ['data', 'status']);
    if (!isPaymentSucceededEvent(eventType, providerStatus)) return null;

    const providerSubscriptionId =
      stringAt(payload, ['data', 'subscription_id']) ??
      stringAt(payload, ['data', 'subscription', 'id']);
    if (!providerSubscriptionId) return null;

    const subscription = await tx.billingSubscription.findFirst({
      where: {
        provider: providerEvent.provider,
        providerSubscriptionId,
      },
      include: {
        price: {
          include: { item: true },
        },
      },
    });
    if (!subscription) return null;
    // A canceled/expired subscription must never re-grant on a stray renewal
    // webhook (e.g. a refund that stopped the mandate, or a provider race).
    if (
      subscription.status === BillingSubscriptionStatus.canceled ||
      subscription.status === BillingSubscriptionStatus.expired
    ) {
      return null;
    }
    if (!subscription.price.grantsPlanKey) return null;
    if (subscription.price.interval === BillingPriceInterval.one_time) {
      return null;
    }

    const providerInvoiceId =
      providerInvoiceIdFromPayload(payload, eventType) ??
      providerEvent.providerEventId;
    const providerPaymentIntentId = providerPaymentIntentIdFromPayload(
      payload,
      eventType,
    );
    const paidAmount = providerPaidAmountMinorFromPayload(payload);
    if (paidAmount !== null && paidAmount > subscription.price.amountMinor) {
      throw new ConflictException({
        code: 'BILLING_PROVIDER_AMOUNT_EXCEEDS_SUBSCRIPTION_PRICE',
        msg: 'Provider renewal amount exceeds the subscription price.',
      });
    }
    const providerCurrency = providerCurrencyFromPayload(payload);
    if (providerCurrency && providerCurrency !== subscription.price.currency) {
      throw new ConflictException({
        code: 'BILLING_PROVIDER_CURRENCY_MISMATCH',
        msg: 'Provider renewal currency does not match the subscription price currency.',
      });
    }

    const amountMinor = paidAmount ?? subscription.price.amountMinor;
    const idempotencyKey = subscriptionRenewalIdempotencyKey({
      provider: providerEvent.provider,
      providerSubscriptionId,
      providerInvoiceId,
    });
    const now = new Date();
    let order = await tx.billingOrder.findUnique({
      where: {
        userId_idempotencyKey: {
          userId: subscription.userId,
          idempotencyKey,
        },
      },
      include: {
        price: true,
        paymentIntents: {
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });

    if (!order) {
      const subtotalAmountMinor = subscription.price.amountMinor;
      order = await tx.billingOrder.create({
        data: {
          orderNo: createOrderNo(),
          idempotencyKey,
          userId: subscription.userId,
          workspaceId: subscription.workspaceId,
          subjectType: subscription.subjectType,
          subjectId: subscription.subjectId,
          orderType: BillingOrderType.subscription_checkout,
          status: BillingOrderStatus.pending_payment,
          itemId: subscription.price.itemId,
          priceId: subscription.priceId,
          providerBindingId: null,
          provider: providerEvent.provider,
          currency: subscription.price.currency,
          subtotalAmountMinor,
          discountAmountMinor: subtotalAmountMinor - amountMinor,
          amountMinor,
          quantity: 1,
          grantsWalletAmount: subscription.price.grantsWalletAmount,
          grantsWalletCurrency: subscription.price.grantsWalletCurrency,
          grantsWalletBalanceKind: subscription.price.grantsWalletBalanceKind,
          description: subscription.price.item.name,
          metadata: {
            subscriptionRenewal: {
              providerEventId: providerEvent.id,
              providerNativeEventId: providerEvent.providerEventId,
              providerSubscriptionId,
              providerInvoiceId,
              previousSubscriptionId: subscription.id,
            },
          },
        },
        include: {
          price: true,
          paymentIntents: {
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    }

    let intent = order.paymentIntents[0] ?? null;
    if (intent) {
      intent = await tx.billingPaymentIntent.update({
        where: { id: intent.id },
        data: {
          status: PaymentIntentStatus.succeeded,
          providerStatus: providerStatus ?? eventType,
          providerPayload: payload as Prisma.InputJsonValue,
          providerPaymentIntentId:
            providerPaymentIntentId ?? intent.providerPaymentIntentId,
          providerCustomerId:
            stringAt(payload, ['data', 'billing_customer_id']) ??
            stringAt(payload, ['data', 'customer_id']) ??
            intent.providerCustomerId,
          providerSubscriptionId,
          providerInvoiceId,
          amountMinor: order.amountMinor,
          completedAt: intent.completedAt ?? now,
        },
      });
    } else {
      intent = await tx.billingPaymentIntent.create({
        data: {
          orderId: order.id,
          provider: providerEvent.provider,
          kind: PaymentIntentKind.external_redirect,
          status: PaymentIntentStatus.succeeded,
          requestId: randomUUID(),
          providerPaymentIntentId,
          providerCustomerId:
            stringAt(payload, ['data', 'billing_customer_id']) ??
            stringAt(payload, ['data', 'customer_id']) ??
            subscription.providerCustomerId,
          providerSubscriptionId,
          providerInvoiceId,
          currency: order.currency,
          amountMinor: order.amountMinor,
          providerStatus: providerStatus ?? eventType,
          providerPayload: payload as Prisma.InputJsonValue,
          completedAt: now,
        },
      });
    }

    await this.reconcileProviderPaidAmountTx(tx, order, intent, payload);
    await this.upsertSubscriptionFromProviderEvent(
      tx,
      order,
      providerSubscriptionId,
      payload,
      now,
    );
    await this.markOrderPaidAndFulfill(
      tx,
      order,
      now,
      intent,
      providerEvent.id,
      payload,
    );
    return { orderId: order.id, paymentIntentId: intent.id };
  }

  /**
   * Apply a terminal subscription-lifecycle event (subscription.cancelled /
   * .expired / .deactivated). These carry no payment intent, so without this
   * they fall through to 'ignored' and the BillingSubscription is stuck active
   * forever — poisoning the renewal/grace paths and admin reporting. The
   * membership EntitlementGrant is intentionally left alone (access lapses at
   * endsAt); this only corrects the subscription's own state. Idempotent.
   */
  private async tryApplySubscriptionLifecycleEvent(
    tx: Prisma.TransactionClient,
    providerEvent: BillingPaymentProviderEvent,
    eventType: string,
    payload: Record<string, unknown>,
  ): Promise<SubscriptionLifecycleMatch | null> {
    const targetStatus = subscriptionLifecycleStatus(eventType);
    if (!targetStatus) return null;

    const providerSubscriptionId =
      stringAt(payload, ['data', 'subscription_id']) ??
      stringAt(payload, ['data', 'subscription', 'id']) ??
      // For a subscription.* event the resource (data.id) IS the subscription.
      stringAt(payload, ['data', 'id']);
    if (!providerSubscriptionId) return null;

    const subscription = await tx.billingSubscription.findFirst({
      where: { provider: providerEvent.provider, providerSubscriptionId },
    });
    if (!subscription) return null;

    // Already terminal → idempotent; still a MATCH so the event is not 'ignored'.
    if (
      subscription.status === BillingSubscriptionStatus.canceled ||
      subscription.status === BillingSubscriptionStatus.expired
    ) {
      return { subscriptionId: subscription.id };
    }

    const now = new Date();
    await tx.billingSubscription.update({
      where: { id: subscription.id },
      data: {
        status: targetStatus,
        cancelAtPeriodEnd: true,
        canceledAt:
          targetStatus === BillingSubscriptionStatus.canceled
            ? (subscription.canceledAt ?? now)
            : subscription.canceledAt,
        endedAt: subscription.currentPeriodEnd ?? now,
        version: { increment: 1 },
      },
    });
    return { subscriptionId: subscription.id };
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

    // Offline/internal orders have no payment adapter or provider refund path.
    const adapter =
      order.provider === PaymentProvider.manual ||
      order.provider === PaymentProvider.internal
        ? null
        : this.providerRegistry.get(order.provider);
    const providerSupported =
      adapter?.capabilities.refund === true &&
      typeof adapter.createRefund === 'function';
    if (!providerSupported) {
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
        providerSupported,
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

  /**
   * Resolve the wallet account owner for an order's credit / refund-reversal.
   * compute_point is workspace-owned, so a user-subject order (individual
   * membership, legacy top-up, or a compute pack bought via generic checkout)
   * credits/reverses the buyer's default-workspace pot — the wallet they read
   * from and spend — never a dead user-owned account. community_point stays
   * user-owned. A workspace-subject order uses its workspace directly. Single
   * chokepoint so every fulfillment/refund path stays consistent with
   * resolvePayerTx / walletLedgerScope / resolveTopupSubject.
   */
  private async resolveOrderWalletOwnerTx(
    tx: Prisma.TransactionClient,
    order: { subjectType: BillingSubjectType; subjectId: string },
    currency: WalletCurrencyType,
  ): Promise<{ ownerType: WalletOwnerType; ownerId: string }> {
    if (order.subjectType === BillingSubjectType.workspace) {
      return { ownerType: WalletOwnerType.workspace, ownerId: order.subjectId };
    }
    if (currency === WalletCurrencyType.compute_point) {
      // user-subject order → subjectId is the buyer's userId.
      const defaultWorkspace = await tx.workspace.findFirst({
        where: {
          defaultForUserId: order.subjectId,
          deletedAt: null,
        },
        select: { id: true },
      });
      if (defaultWorkspace) {
        return {
          ownerType: WalletOwnerType.workspace,
          ownerId: defaultWorkspace.id,
        };
      }
      throw new ConflictException({
        code: 'DEFAULT_WORKSPACE_MISSING',
        msg: 'Cannot place compute credit: the order owner has no default workspace.',
      });
    }
    return { ownerType: WalletOwnerType.user, ownerId: order.subjectId };
  }

  private async findWalletAccountForOrderTx(
    tx: Prisma.TransactionClient,
    order: RefundPolicyOrder,
    walletCurrency: WalletCurrencyType,
  ): Promise<WalletAccount | null> {
    const owner = await this.resolveOrderWalletOwnerTx(
      tx,
      order,
      walletCurrency,
    );
    return tx.walletAccount.findUnique({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
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
  ): Promise<{
    refund: BillingRefund;
    originalAmountMinor: bigint;
    providerPaymentIntentId: string;
    cancelProviderSubscriptionId: string | null;
  }> {
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
          requestFingerprint: refundIntentFingerprint(adminId, input),
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

    // Refunding a membership must also STOP the recurring mandate, or Airwallex
    // keeps charging and the next renewal webhook re-grants the just-refunded
    // benefit. Mark our subscription canceled in-tx; the provider cancel call
    // happens outside the tx (returned id below). Access ends now because the
    // grant was just revoked, so this is an immediate cancel (not period-end).
    let cancelProviderSubscriptionId: string | null = null;
    if (order.price.grantsPlanKey) {
      const subscription = await tx.billingSubscription.findFirst({
        where: {
          provider: refund.provider,
          subjectType: order.subjectType,
          subjectId: order.subjectId,
          priceId: order.priceId,
          status: {
            notIn: [
              BillingSubscriptionStatus.canceled,
              BillingSubscriptionStatus.expired,
            ],
          },
        },
      });
      if (subscription) {
        const now = new Date();
        await tx.billingSubscription.update({
          where: { id: subscription.id },
          data: {
            status: BillingSubscriptionStatus.canceled,
            cancelAtPeriodEnd: false,
            canceledAt: now,
            endedAt: now,
            version: { increment: 1 },
          },
        });
        cancelProviderSubscriptionId = subscription.providerSubscriptionId;
      }
    }

    return {
      refund: preparedRefund,
      originalAmountMinor: order.amountMinor,
      providerPaymentIntentId,
      cancelProviderSubscriptionId,
    };
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
      await enqueueEntitlementChanged(tx, grant, 'revoked');
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
    const owner = await this.resolveOrderWalletOwnerTx(
      tx,
      input.order,
      walletCurrency,
    );
    const account = await tx.walletAccount.findUnique({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
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
    const entry = await tx.walletLedgerEntry.create({
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
    if (isGrantBackedCurrencyKind(locked.currency, locked.balanceKind)) {
      await reverseWalletCreditGrantForRefundTx(tx, {
        accountId: locked.id,
        order: input.order,
        refund: input.refund,
        transactionId: transaction.id,
        ledgerEntryId: entry.id,
        amount: input.amount,
      });
    }
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
    // A delayed acknowledgement cannot reopen a terminal refund.
    if (
      refund.status === BillingRefundStatus.succeeded ||
      refund.status === BillingRefundStatus.failed ||
      refund.status === BillingRefundStatus.canceled
    ) {
      return this.getAdminRefundForTx(tx, refund.id);
    }
    if (
      refund.provider === PaymentProvider.wechat_pay &&
      result.providerStatus === 'CLOSED'
    ) {
      return this.failRefundTx(tx, refund.id, {
        failureCode: 'WECHAT_PAY_REFUND_CLOSED',
        failureMessage: 'WeChat closed the refund.',
        eventType: 'provider.refund.closed',
        providerStatus: result.providerStatus,
        payload: result.raw,
      });
    }
    // ABNORMAL still needs merchant handling; retain the reservation.
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
      const restored = await tx.entitlementGrant.updateMany({
        where: {
          id: refund.entitlementGrantId,
          status: EntitlementGrantStatus.revoked,
        },
        data: {
          status: EntitlementGrantStatus.active,
          revokedAt: null,
        },
      });
      if (restored.count > 0) {
        const grant = await tx.entitlementGrant.findUnique({
          where: { id: refund.entitlementGrantId },
        });
        if (grant) await enqueueEntitlementChanged(tx, grant, 'restored');
      }
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
    const owner = await this.resolveOrderWalletOwnerTx(
      tx,
      order,
      refund.walletReversalCurrency,
    );
    const account = await tx.walletAccount.findUniqueOrThrow({
      where: {
        ownerType_ownerId_currency_balanceKind: {
          ownerType: owner.ownerType,
          ownerId: owner.ownerId,
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
    const entry = await tx.walletLedgerEntry.create({
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
    // On a grant-backed account the earlier reversal REDUCED the order's grant
    // lots; restoring only the balance would drift it above the grant total.
    // Re-add a fresh non-expiring refund_return grant for the restored amount.
    // (This fires only when a submitted provider refund later fails — rare —
    // and the restored credits back a paid order, so non-expiring is correct.)
    if (isGrantBackedCurrencyKind(locked.currency, locked.balanceKind)) {
      const grantType = WalletCreditGrantType.refund_return;
      const restoredGrant = await tx.walletCreditGrant.create({
        data: {
          accountId: locked.id,
          transactionId: transaction.id,
          grantType,
          status: WalletCreditGrantStatus.active,
          totalAmount: refund.walletReversalAmount,
          availableAmount: refund.walletReversalAmount,
          heldAmount: 0n,
          consumedAmount: 0n,
          expiredAmount: 0n,
          reversedAmount: 0n,
          priority: defaultGrantPriority(grantType, null),
          validFrom: new Date(),
          expiresAt: null,
          sourceType: 'billing_refund',
          sourceId: refund.id,
          metadata: {
            orderNo: order.orderNo,
            refundNo: refund.refundNo,
            reason: 'refund_restore',
          },
        },
      });
      await tx.walletCreditAllocation.create({
        data: {
          grantId: restoredGrant.id,
          transactionId: transaction.id,
          ledgerEntryId: entry.id,
          amount: refund.walletReversalAmount,
          availableDelta: refund.walletReversalAmount,
          heldDelta: 0n,
          consumedDelta: 0n,
          expiredDelta: 0n,
          reversedDelta: 0n,
        },
      });
    }
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
        failureCode: null,
        failureMessage: null,
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
      requiresProviderCoupon?: boolean;
    },
  ): Promise<CheckoutPromotionReservation> {
    const code = input.code.trim().toUpperCase();
    const candidate = await tx.billingPromotion.findUnique({
      where: { code },
      select: { id: true },
    });
    if (!candidate) {
      throw new BadRequestException({
        code: 'BILLING_PROMOTION_NOT_FOUND',
        msg: 'Promotion code is invalid.',
      });
    }
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`billing:promotion:${candidate.id}`})::bigint)
    `;
    // The preceding checkout may have consumed the last redemption while we
    // waited. Validate the committed promotion and binding after admission.
    const promotion = await tx.billingPromotion.findUnique({
      where: { id: candidate.id },
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
    if (!promotion || promotion.code !== code) {
      throw new BadRequestException({
        code: 'BILLING_PROMOTION_NOT_FOUND',
        msg: 'Promotion code is invalid.',
      });
    }

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
      promotion.amountOffMinor !== null &&
      promotion.amountOffCurrency &&
      promotion.amountOffCurrency !== input.price.currency
    ) {
      throw new BadRequestException({
        code: 'BILLING_PROMOTION_CURRENCY_MISMATCH',
        msg: 'Promotion code is not valid for this currency.',
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
      (input.requiresProviderCoupon ?? true) &&
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

  /**
   * Find the best-discount eligible AUTOMATIC promotion for a price WITHOUT
   * locking or reserving — the shared selection used by both the checkout
   * resolver (which then locks + reserves) and the read-only display preview
   * (which renders the struck list price + effective price). `client` may be a
   * transaction client or the base Prisma client.
   *
   * Eligibility skips (never throws): exhausted global cap, currency mismatch on
   * a fixed-amount sale, non-positive discount, and — when an external charge
   * remains — a missing provider coupon (so the displayed sale always equals the
   * one checkout can actually apply). Best discount wins, ties broken by id.
   */
  private async findBestAutomaticPromotion(
    client: Prisma.TransactionClient,
    input: {
      provider: PaymentProvider;
      price: PriceWithProviderBindings;
      subtotalAmountMinor: bigint;
      now: Date;
      requiresProviderCoupon?: boolean;
    },
  ): Promise<{
    promotion: BillingPromotion & {
      providerBindings: BillingPromotionProviderBinding[];
    };
    discountAmountMinor: bigint;
  } | null> {
    const { price, now } = input;
    const requiresProviderCoupon = input.requiresProviderCoupon ?? true;

    // Active, in-window automatic promotions scoped to this price. A scope field
    // either matches the price's value or is null (broader scope).
    const candidates = await client.billingPromotion.findMany({
      where: {
        applyMode: BillingPromotionApplyMode.automatic,
        status: BillingPromotionStatus.active,
        archivedAt: null,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          { OR: [{ appliesPriceId: null }, { appliesPriceId: price.id }] },
          { OR: [{ appliesItemId: null }, { appliesItemId: price.itemId }] },
          {
            OR: [
              { appliesProductType: null },
              { appliesProductType: price.item.productType },
            ],
          },
        ],
      },
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

    // Eligibility predicates that aren't a single SQL comparison: global cap
    // (column-vs-column), currency match for fixed-amount, positive discount,
    // and whether the discount can actually be charged through the provider.
    const eligible = candidates
      .filter(
        (p) =>
          p.maxRedemptions === null || p.redemptionCount < p.maxRedemptions,
      )
      .filter(
        (p) =>
          p.amountOffMinor === null ||
          !p.amountOffCurrency ||
          p.amountOffCurrency === price.currency,
      )
      .map((p) => ({
        promotion: p,
        discountAmountMinor: calculatePromotionDiscount(
          p,
          input.subtotalAmountMinor,
        ),
      }))
      .filter((c) => c.discountAmountMinor > 0n)
      .filter((c) => {
        if (!requiresProviderCoupon) return true;
        // A fully-free result needs no external charge → no coupon required.
        if (input.subtotalAmountMinor - c.discountAmountMinor <= 0n)
          return true;
        return (
          (c.promotion.providerBindings[0]?.providerCouponId ?? null) !== null
        );
      });

    if (eligible.length === 0) return null;

    // Best discount wins; deterministic id tie-break so concurrent checkouts
    // never disagree on which sale applied.
    eligible.sort((a, b) => {
      if (a.discountAmountMinor !== b.discountAmountMinor) {
        return a.discountAmountMinor > b.discountAmountMinor ? -1 : 1;
      }
      return a.promotion.id < b.promotion.id ? -1 : 1;
    });
    return eligible[0];
  }

  /**
   * Resolve the best AUTOMATIC (no-code) promotion for a price at checkout — the
   * 促销活动价 / sale path. Returns the SAME reservation shape as the code path
   * so every downstream concern (order snapshot, redemption row, fulfillment,
   * refund) is identical and mode-agnostic.
   *
   * Unlike the code path, ineligibility is NEVER an error here: a missing,
   * expired, exhausted, currency-mismatched or provider-unsynced automatic sale
   * simply means "no discount — charge the list price". A misconfigured sale
   * must not break checkout for everyone; the loud guard for that lives at
   * admin save time, not in the buyer's path.
   */
  private async resolveAutomaticPromotionTx(
    tx: Prisma.TransactionClient,
    input: {
      provider: PaymentProvider;
      price: PriceWithProviderBindings;
      subtotalAmountMinor: bigint;
      now: Date;
      requiresProviderCoupon?: boolean;
    },
  ): Promise<CheckoutPromotionReservation | null> {
    const { now } = input;
    const requiresProviderCoupon = input.requiresProviderCoupon ?? true;

    const best = await this.findBestAutomaticPromotion(tx, input);
    if (!best) return null;
    const chosenId = best.promotion.id;

    // Serialize against concurrent redemptions of the same sale, then re-read
    // and re-validate inside the lock. Any disqualification → no discount
    // (graceful), mirroring the buyer-friendly contract above.
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`billing:promotion:${chosenId}`})::bigint)
    `;
    const fresh = await tx.billingPromotion.findUnique({
      where: { id: chosenId },
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
    if (
      !fresh ||
      fresh.status !== BillingPromotionStatus.active ||
      fresh.archivedAt ||
      (fresh.startsAt && fresh.startsAt > now) ||
      (fresh.endsAt && fresh.endsAt <= now) ||
      (fresh.maxRedemptions !== null &&
        fresh.redemptionCount >= fresh.maxRedemptions)
    ) {
      return null;
    }

    const discountAmountMinor = calculatePromotionDiscount(
      fresh,
      input.subtotalAmountMinor,
    );
    if (discountAmountMinor <= 0n) return null;

    const providerCouponId =
      fresh.providerBindings[0]?.providerCouponId ?? null;
    if (
      requiresProviderCoupon &&
      input.subtotalAmountMinor - discountAmountMinor > 0n &&
      !providerCouponId
    ) {
      return null;
    }

    return { promotion: fresh, discountAmountMinor, providerCouponId };
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
      walletTransactionId = await this.creditWalletGrantForOrderTx(
        tx,
        current,
        now,
      );
    }
    let entitlementGrantId: string | null = null;
    let subscription: BillingSubscription | null = null;
    let membershipPlan: BillingMembershipPlan | null = null;
    let membershipPeriod: { startsAt: Date; endsAt: Date | null } | null = null;
    if (current.price.grantsPlanKey) {
      membershipPlan = await this.activeMembershipPlanForKeyTx(
        tx,
        current.price.grantsPlanKey,
      );
      membershipPeriod = await this.membershipPeriodForOrderTx(
        tx,
        current,
        now,
        paymentIntent,
      );
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
          startsAt: membershipPeriod.startsAt,
          endsAt: membershipPeriod.endsAt,
          metadata: {
            orderNo: current.orderNo,
            priceId: current.priceId,
            planId: membershipPlan.id,
            planKey: membershipPlan.planKey,
          },
        },
        update: {
          status: EntitlementGrantStatus.active,
          startsAt: membershipPeriod.startsAt,
          endsAt: membershipPeriod.endsAt,
          metadata: {
            orderNo: current.orderNo,
            priceId: current.priceId,
            planId: membershipPlan.id,
            planKey: membershipPlan.planKey,
          },
        },
      });
      entitlementGrantId = grant.id;
      await enqueueEntitlementChanged(tx, grant, 'fulfilled');
      walletTransactionId =
        (await this.creditMembershipIncludedCreditsForOrderTx(
          tx,
          current,
          membershipPlan,
          membershipPeriod,
        )) ?? walletTransactionId;
      subscription = await this.findSubscriptionForOrderTx(
        tx,
        current,
        paymentIntent,
      );
      if (subscription) {
        await this.upsertSubscriptionCycleForOrderTx(tx, {
          subscription,
          order: current,
          plan: membershipPlan,
          entitlementGrantId,
          walletTransactionId,
          period: membershipPeriod,
          now,
        });
      }
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
    const plan = order.price.grantsPlanKey
      ? await this.activeMembershipPlanForKeyTx(tx, order.price.grantsPlanKey)
      : null;
    const currentPeriodStart =
      dateAt(payload, ['data', 'current_period_start']) ??
      dateAt(payload, ['data', 'period_start']);
    const currentPeriodEnd =
      dateAt(payload, ['data', 'current_period_end']) ??
      dateAt(payload, ['data', 'period_end']);
    const periodStart = currentPeriodStart ?? order.paidAt ?? now;
    const periodEnd =
      currentPeriodEnd ??
      periodEndForPrice(
        periodStart,
        order.price.interval,
        order.price.grantDurationDays,
      );
    const existing = await tx.billingSubscription.findFirst({
      where: {
        provider: order.provider,
        providerSubscriptionId,
      },
    });
    const existingMetadata =
      existing?.metadata && isRecord(existing.metadata)
        ? existing.metadata
        : {};
    const data = {
      userId: order.userId,
      workspaceId: order.workspaceId,
      subjectType: order.subjectType,
      subjectId: order.subjectId,
      provider: order.provider,
      providerSubscriptionId,
      providerCustomerId:
        stringAt(payload, ['data', 'billing_customer_id']) ??
        stringAt(payload, ['data', 'customer_id']) ??
        null,
      status: BillingSubscriptionStatus.active,
      priceId: order.priceId,
      planKey: order.price.grantsPlanKey,
      latestOrderId: order.id,
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      startedAt: existing?.startedAt ?? periodStart,
      endedAt: null,
      planPolicySnapshot: plan
        ? (membershipPlanSnapshot(plan) as Prisma.InputJsonValue)
        : {},
      metadata: {
        ...existingMetadata,
        initialOrderId:
          stringAt(existingMetadata, ['initialOrderId']) ?? order.id,
        initialOrderNo:
          stringAt(existingMetadata, ['initialOrderNo']) ?? order.orderNo,
        latestOrderId: order.id,
        latestOrderNo: order.orderNo,
      },
    };
    if (existing) {
      await tx.billingSubscription.update({
        where: { id: existing.id },
        data: { ...data, version: { increment: 1 } },
      });
      return;
    }
    await tx.billingSubscription.create({ data });
  }

  private async activeMembershipPlanForKeyTx(
    tx: Prisma.TransactionClient,
    planKey: string,
  ): Promise<BillingMembershipPlan> {
    const plan = await tx.billingMembershipPlan.findUnique({
      where: { planKey },
    });
    if (!plan || plan.archivedAt) {
      throw new ConflictException({
        code: 'BILLING_MEMBERSHIP_PLAN_NOT_CONFIGURED',
        msg: `Membership plan "${planKey}" is not configured.`,
      });
    }
    if (plan.status !== BillingMembershipPlanStatus.active) {
      throw new ConflictException({
        code: 'BILLING_MEMBERSHIP_PLAN_NOT_ACTIVE',
        msg: `Membership plan "${planKey}" is not active.`,
      });
    }
    return plan;
  }

  private async membershipPeriodForOrderTx(
    tx: Prisma.TransactionClient,
    order: OrderWithPrice,
    now: Date,
    paymentIntent?: BillingPaymentIntent | null,
  ): Promise<{ startsAt: Date; endsAt: Date | null }> {
    const subscription = await this.findSubscriptionForOrderTx(
      tx,
      order,
      paymentIntent,
    );
    if (subscription) {
      const startsAt = subscription.currentPeriodStart ?? now;
      return {
        startsAt,
        endsAt:
          subscription.currentPeriodEnd ??
          periodEndForPrice(
            startsAt,
            order.price.interval,
            order.price.grantDurationDays,
          ),
      };
    }
    return {
      startsAt: now,
      endsAt: periodEndForPrice(
        now,
        order.price.interval,
        order.price.grantDurationDays,
      ),
    };
  }

  private async findSubscriptionForOrderTx(
    tx: Prisma.TransactionClient,
    order: OrderWithPrice,
    paymentIntent?: BillingPaymentIntent | null,
  ): Promise<BillingSubscription | null> {
    const providerSubscriptionId = paymentIntent?.providerSubscriptionId;
    if (providerSubscriptionId) {
      const subscription = await tx.billingSubscription.findFirst({
        where: { provider: order.provider, providerSubscriptionId },
      });
      if (subscription) return subscription;
    }
    return tx.billingSubscription.findFirst({
      where: {
        latestOrderId: order.id,
        subjectType: order.subjectType,
        subjectId: order.subjectId,
      },
    });
  }

  private async creditMembershipIncludedCreditsForOrderTx(
    tx: Prisma.TransactionClient,
    order: OrderWithPrice,
    plan: BillingMembershipPlan,
    period: { startsAt: Date; endsAt: Date | null },
  ): Promise<string | null> {
    if (plan.includedComputeCredits <= 0n) return null;
    // compute_point is workspace-owned: an individual (user-subject) membership's
    // included credits land in the buyer's default-workspace pot, not a dead
    // user-owned account.
    const owner = await this.resolveOrderWalletOwnerTx(
      tx,
      order,
      WalletCurrencyType.compute_point,
    );
    const account = await ensureWalletAccount(tx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      currency: WalletCurrencyType.compute_point,
      balanceKind: WalletBalanceKind.consumable,
    });
    const idempotencyKey = `billing_order:${order.id}:membership_included:compute_point`;
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

    const amount = plan.includedComputeCredits;
    const nextAvailable = lockedAccount.availableBalance + amount;
    const transaction = await tx.walletTransaction.create({
      data: {
        status: WalletTransactionStatus.posted,
        sourceType: 'billing_order',
        sourceId: order.id,
        idempotencyKey,
        actorUserId: order.userId,
        workspaceId: order.workspaceId,
        description: `Membership included compute credits from order ${order.orderNo}`,
        metadata: {
          orderNo: order.orderNo,
          priceId: order.priceId,
          planId: plan.id,
          planKey: plan.planKey,
          grantType: WalletCreditGrantType.membership_included,
          periodStart: period.startsAt.toISOString(),
          periodEnd: period.endsAt?.toISOString() ?? null,
        },
      },
    });
    const entry = await tx.walletLedgerEntry.create({
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
        reason: 'membership_compute_point_included',
      },
    });
    const creditGrant = await tx.walletCreditGrant.create({
      data: {
        accountId: lockedAccount.id,
        transactionId: transaction.id,
        grantType: WalletCreditGrantType.membership_included,
        status: WalletCreditGrantStatus.active,
        totalAmount: amount,
        availableAmount: amount,
        heldAmount: 0n,
        consumedAmount: 0n,
        expiredAmount: 0n,
        reversedAmount: 0n,
        priority: defaultGrantPriority(
          WalletCreditGrantType.membership_included,
          period.endsAt,
        ),
        validFrom: period.startsAt,
        expiresAt: period.endsAt,
        sourceType: 'billing_order',
        sourceId: order.id,
        metadata: {
          orderNo: order.orderNo,
          planId: plan.id,
          planKey: plan.planKey,
          periodStart: period.startsAt.toISOString(),
          periodEnd: period.endsAt?.toISOString() ?? null,
        },
      },
    });
    await tx.walletCreditAllocation.create({
      data: {
        grantId: creditGrant.id,
        transactionId: transaction.id,
        ledgerEntryId: entry.id,
        amount,
        availableDelta: amount,
        heldDelta: 0n,
        consumedDelta: 0n,
        expiredDelta: 0n,
        reversedDelta: 0n,
      },
    });
    await tx.walletAccount.update({
      where: { id: lockedAccount.id },
      data: {
        availableBalance: nextAvailable,
        heldBalance: lockedAccount.heldBalance,
        version: { increment: 1 },
      },
    });
    return transaction.id;
  }

  private async upsertSubscriptionCycleForOrderTx(
    tx: Prisma.TransactionClient,
    input: {
      subscription: BillingSubscription;
      order: OrderWithPrice;
      plan: BillingMembershipPlan;
      entitlementGrantId: string | null;
      walletTransactionId: string | null;
      period: { startsAt: Date; endsAt: Date | null };
      now: Date;
    },
  ): Promise<void> {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`billing:subscription:${input.subscription.id}`})::bigint)
    `;
    const idempotencyKey = `billing_subscription_cycle:${input.subscription.id}:order:${input.order.id}`;
    const existing = await tx.billingSubscriptionCycle.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return;
    const last = await tx.billingSubscriptionCycle.findFirst({
      where: { subscriptionId: input.subscription.id },
      orderBy: { cycleNo: 'desc' },
      select: { cycleNo: true },
    });
    await tx.billingSubscriptionCycle.create({
      data: {
        subscriptionId: input.subscription.id,
        orderId: input.order.id,
        entitlementGrantId: input.entitlementGrantId,
        walletTransactionId: input.walletTransactionId,
        cycleNo: (last?.cycleNo ?? 0) + 1,
        status: BillingSubscriptionCycleStatus.fulfilled,
        periodStart: input.period.startsAt,
        periodEnd: input.period.endsAt,
        includedComputeCredits: input.plan.includedComputeCredits,
        creditGrantExpiresAt: input.period.endsAt,
        idempotencyKey,
        metadata: {
          orderNo: input.order.orderNo,
          planId: input.plan.id,
          planKey: input.plan.planKey,
          planSnapshot: membershipPlanSnapshot(input.plan),
        },
        fulfilledAt: input.now,
      },
    });
  }

  private async reconcileProviderPaidAmountTx(
    tx: Prisma.TransactionClient,
    order: OrderWithPrice,
    intent: BillingPaymentIntent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    const providerPaidAmountMinor = providerPaidAmountMinorFromPayload(payload);
    if (providerPaidAmountMinor === null) {
      return;
    }
    if (providerPaidAmountMinor === order.amountMinor) {
      return;
    }
    if (providerPaidAmountMinor > order.subtotalAmountMinor) {
      throw new ConflictException({
        code: 'BILLING_PROVIDER_AMOUNT_EXCEEDS_ORDER',
        msg: 'Provider paid amount exceeds the internal order subtotal.',
      });
    }
    if (providerPaidAmountMinor > order.amountMinor) {
      throw new ConflictException({
        code: 'BILLING_PROVIDER_AMOUNT_EXCEEDS_EXPECTED',
        msg: 'Provider paid amount exceeds the expected payable order amount.',
      });
    }

    await tx.billingPaymentIntent.update({
      where: { id: intent.id },
      data: { amountMinor: providerPaidAmountMinor },
    });

    const existingMetadata = isRecord(order.metadata) ? order.metadata : {};
    await tx.billingOrder.update({
      where: { id: order.id },
      data: {
        amountMinor: providerPaidAmountMinor,
        discountAmountMinor:
          order.subtotalAmountMinor - providerPaidAmountMinor,
        metadata: {
          ...existingMetadata,
          providerAmountReconciliation: {
            provider: intent.provider,
            eventType: eventTypeFromPayload(payload),
            previousAmountMinor: order.amountMinor.toString(),
            providerPaidAmountMinor: providerPaidAmountMinor.toString(),
            reconciledAt: new Date().toISOString(),
          },
        } as Prisma.InputJsonValue,
      },
    });
  }

  private async creditWalletGrantForOrderTx(
    tx: Prisma.TransactionClient,
    order: OrderWithPrice,
    now: Date,
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
    // Route compute_point grants to the workspace pot (the buyer's default
    // workspace for a user-subject order); community_point stays user-owned.
    const owner = await this.resolveOrderWalletOwnerTx(
      tx,
      order,
      grantCurrency,
    );

    const account = await ensureWalletAccount(tx, {
      ownerType: owner.ownerType,
      ownerId: owner.ownerId,
      currency: grantCurrency,
      balanceKind: grantBalanceKind,
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
    const grantType = billingOrderGrantType(order);
    const grantExpiresAt = grantEndsAt(now, order.price.grantDurationDays);
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
          grantType,
          expiresAt: grantExpiresAt?.toISOString() ?? null,
        },
      },
    });

    const entry = await tx.walletLedgerEntry.create({
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

    if (
      isGrantBackedCurrencyKind(
        lockedAccount.currency,
        lockedAccount.balanceKind,
      )
    ) {
      const creditGrant = await tx.walletCreditGrant.create({
        data: {
          accountId: lockedAccount.id,
          transactionId: transaction.id,
          grantType,
          status: WalletCreditGrantStatus.active,
          totalAmount: amount,
          availableAmount: amount,
          heldAmount: 0n,
          consumedAmount: 0n,
          expiredAmount: 0n,
          reversedAmount: 0n,
          priority: defaultGrantPriority(grantType, grantExpiresAt),
          validFrom: now,
          expiresAt: grantExpiresAt,
          sourceType: 'billing_order',
          sourceId: order.id,
          metadata: {
            orderNo: order.orderNo,
            priceId: order.priceId,
            orderType: order.orderType,
            subjectType: order.subjectType,
            subjectId: order.subjectId,
          },
        },
      });
      await tx.walletCreditAllocation.create({
        data: {
          grantId: creditGrant.id,
          transactionId: transaction.id,
          ledgerEntryId: entry.id,
          amount,
          availableDelta: amount,
          heldDelta: 0n,
          consumedDelta: 0n,
          expiredDelta: 0n,
          reversedDelta: 0n,
        },
      });
    }

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
    provider: PaymentProvider,
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
        provider,
        OR: or,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async matchRefund(
    tx: Prisma.TransactionClient,
    provider: PaymentProvider,
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
        provider,
        OR: or,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async lockCheckoutWorkspace(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    subject: { subjectType: BillingSubjectType; subjectId: string },
  ): Promise<void> {
    if (subject.subjectType !== BillingSubjectType.workspace) return;
    await tx.$queryRaw`SELECT id FROM workspaces WHERE id = ${subject.subjectId}::uuid FOR SHARE`;
    await this.checkCheckoutWorkspace(tx, user, subject);
  }

  private async checkCheckoutWorkspace(
    tx: Prisma.TransactionClient,
    user: AuthUser,
    subject: { subjectType: BillingSubjectType; subjectId: string },
  ): Promise<void> {
    if (subject.subjectType !== BillingSubjectType.workspace) return;
    await this.permissions.requireWorkspaceRole(
      user.userId,
      subject.subjectId,
      WorkspaceMemberRole.billing,
      tx,
    );
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

  /**
   * Resolve the wallet owner for a top-up / recharge order. Unlike
   * {@link resolveCheckoutSubject} this is driven by the REQUEST (an optional
   * workspaceId), not the price subject. Compute credits fund the explicitly
   * selected workspace (billing role required), or the caller's default
   * workspace. Fulfillment uses the resulting workspace order subject.
   */
  private async resolveTopupSubject(
    user: AuthUser,
    workspaceId: string | null | undefined,
  ): Promise<{
    subjectType: BillingSubjectType;
    subjectId: string;
    workspaceId: string | null;
  }> {
    // compute_point is uniformly workspace-owned, so every top-up funds a
    // workspace pot — the one its members read from and spend against. An explicit
    // workspace requires the billing role; with none, fund the caller's own
    // default-workspace pot (they own it, so no extra gate). The fulfillment
    // routes the grant off order.subjectType === workspace.
    if (workspaceId) {
      await this.permissions.requireWorkspaceRole(
        user.userId,
        workspaceId,
        WorkspaceMemberRole.billing,
      );
      return {
        subjectType: BillingSubjectType.workspace,
        subjectId: workspaceId,
        workspaceId,
      };
    }
    const defaultWorkspace = await this.prisma.workspace.findFirst({
      where: {
        defaultForUserId: user.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!defaultWorkspace) {
      throw new ConflictException({
        code: 'DEFAULT_WORKSPACE_MISSING',
        msg: 'No default workspace to fund. Open the studio once to initialize it.',
      });
    }
    return {
      subjectType: BillingSubjectType.workspace,
      subjectId: defaultWorkspace.id,
      workspaceId: defaultWorkspace.id,
    };
  }

  /**
   * Return the existing order + latest payment intent for an idempotency key —
   * the replay shape shared by the top-up / recharge entry points when a
   * concurrent first-time request won the (userId, idempotencyKey) race. Kept
   * non-recursive so the callers' return types stay inferable.
   */
  private async replayExistingOrder(
    userId: string,
    idempotencyKey: string,
    shopperCountry: string,
    env: 'demo' | 'prod',
  ) {
    const existing = await this.prisma.billingOrder.findUniqueOrThrow({
      where: { userId_idempotencyKey: { userId, idempotencyKey } },
      include: { paymentIntents: { orderBy: { createdAt: 'desc' }, take: 1 } },
    });
    return {
      order: this.orderDto(existing),
      paymentIntent: existing.paymentIntents[0]
        ? this.paymentIntentDto(existing.paymentIntents[0])
        : null,
      shopperCountry,
      env,
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
    activeDiscount: PriceActiveDiscountDto | null = null,
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
      // List price — the struck-through original when a sale is active.
      amountMinor: price.amountMinor.toString(),
      // The automatic sale (促销活动价) currently applied, or null.
      activeDiscount,
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

  /**
   * Read-only preview of the automatic sale in effect for a price, shaped for
   * display. Uses the same selection as checkout (and the same
   * requiresProviderCoupon filter) so the struck price a buyer sees is exactly
   * the one checkout will apply.
   */
  private async previewActiveDiscount(
    price: PriceWithProviderBindings,
    provider: PaymentProvider,
    now: Date,
  ): Promise<PriceActiveDiscountDto | null> {
    const best = await this.findBestAutomaticPromotion(this.prisma, {
      provider,
      price,
      subtotalAmountMinor: price.amountMinor,
      now,
      requiresProviderCoupon: true,
    });
    if (!best) return null;
    return {
      promotionId: best.promotion.id,
      name: best.promotion.name,
      discountAmountMinor: best.discountAmountMinor.toString(),
      effectiveAmountMinor: (
        price.amountMinor - best.discountAmountMinor
      ).toString(),
      endsAt: best.promotion.endsAt
        ? best.promotion.endsAt.toISOString()
        : null,
      recurring: best.promotion.durationType,
    };
  }

  private async getAdminPrice(
    priceId: string,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const price = await db.billingPrice.findUniqueOrThrow({
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

  private membershipPlanDto(
    plan: BillingMembershipPlan,
    prices: MembershipPlanPriceRow[],
    discountByPriceId?: Map<string, PriceActiveDiscountDto>,
    generationEstimates: ReturnType<typeof membershipGenerationEstimates> = [],
  ) {
    return {
      id: plan.id,
      planKey: plan.planKey,
      productType: plan.productType,
      subjectType: plan.subjectType,
      status: plan.status,
      rank: plan.rank,
      name: plan.name,
      description: plan.description,
      includedComputeCredits: plan.includedComputeCredits.toString(),
      includedSeats: plan.includedSeats,
      maxSeats: plan.maxSeats,
      seatOverageAllowed: plan.seatOverageAllowed,
      billingIntervalDefault: plan.billingIntervalDefault,
      benefits: plan.benefits,
      generationEstimates,
      marketing: plan.marketing,
      metadata: plan.metadata,
      prices: prices.map((price) =>
        this.priceDto(
          price,
          price.providerBindings[0]?.provider ??
            this.providerRegistry.defaultProviderForRuntime(),
          discountByPriceId?.get(price.id) ?? null,
        ),
      ),
      updatedAt: plan.updatedAt.toISOString(),
    };
  }

  private adminMembershipPlanDto(
    plan: BillingMembershipPlan,
    prices: AdminMembershipPlanPriceRow[] = [],
  ) {
    return {
      id: plan.id,
      planKey: plan.planKey,
      productType: plan.productType,
      subjectType: plan.subjectType,
      status: plan.status,
      rank: plan.rank,
      name: plan.name,
      description: plan.description,
      includedComputeCredits: plan.includedComputeCredits.toString(),
      includedSeats: plan.includedSeats,
      maxSeats: plan.maxSeats,
      seatOverageAllowed: plan.seatOverageAllowed,
      billingIntervalDefault: plan.billingIntervalDefault,
      benefits: plan.benefits,
      marketing: plan.marketing,
      metadata: plan.metadata,
      createdById: plan.createdById,
      updatedById: plan.updatedById,
      archivedAt: plan.archivedAt?.toISOString() ?? null,
      prices: prices.map((price) => this.adminPriceDto(price)),
      createdAt: plan.createdAt.toISOString(),
      updatedAt: plan.updatedAt.toISOString(),
    };
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
      metadata: price.metadata,
      updatedAt: price.updatedAt.toISOString(),
    };
  }

  private async requireMembershipPlanForPriceTx(
    tx: Prisma.TransactionClient,
    input: CreateAdminBillingPriceInput,
  ): Promise<BillingMembershipPlan> {
    if (!input.grantsPlanKey) {
      throw new BadRequestException({
        code: 'BILLING_MEMBERSHIP_PRICE_PLAN_REQUIRED',
        msg: 'Membership prices must reference a membership plan key.',
      });
    }
    const plan = await tx.billingMembershipPlan.findUnique({
      where: { planKey: input.grantsPlanKey },
    });
    if (!plan || plan.archivedAt) {
      throw new BadRequestException({
        code: 'BILLING_MEMBERSHIP_PLAN_NOT_FOUND',
        msg: `Membership plan "${input.grantsPlanKey}" does not exist or is archived.`,
      });
    }
    if (plan.productType !== input.productType) {
      throw new BadRequestException({
        code: 'BILLING_MEMBERSHIP_PLAN_PRODUCT_MISMATCH',
        msg: 'Membership price product type must match the referenced plan.',
      });
    }
    if (plan.subjectType !== input.subjectType) {
      throw new BadRequestException({
        code: 'BILLING_MEMBERSHIP_PLAN_SUBJECT_MISMATCH',
        msg: 'Membership price subject type must match the referenced plan.',
      });
    }
    return plan;
  }

  private adminPromotionDto(promotion: PromotionWithBindings) {
    return {
      id: promotion.id,
      applyMode: promotion.applyMode,
      code: promotion.code,
      name: promotion.name,
      description: promotion.description,
      status: promotion.status,
      percentOffBps: promotion.percentOffBps,
      amountOffMinor: promotion.amountOffMinor,
      amountOffCurrency: promotion.amountOffCurrency,
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
      // Provider-specific payload the client SDK needs to launch payment.
      // Hosted-checkout providers (Airwallex) use checkoutUrl/clientSecret; WeChat
      // Pay APP支付 has no URL — the native OpenSDK is invoked with these signed
      // params (appId/partnerId/prepayId/package/nonceStr/timeStamp/sign). Null
      // when the provider has no extra client payload.
      providerData: wechatAppInvokePayload(intent),
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
  // Fixed-amount: capped at the subtotal (currency match is enforced upstream).
  if (promotion.amountOffMinor != null) {
    const amountOff = BigInt(promotion.amountOffMinor);
    return amountOff > subtotalAmountMinor ? subtotalAmountMinor : amountOff;
  }
  const percentOffBps = BigInt(promotion.percentOffBps ?? 0);
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

type ComputePointTopupPolicy = {
  cell: 'global' | 'cn';
  currency: string;
  defaultProvider: PaymentProvider;
  providers: PaymentProvider[];
  rateMode: 'usd_cent_anchor' | typeof COMPUTE_POINT_EXPLICIT_ADMIN_PRICING;
};

function computePointTopupPolicy(): ComputePointTopupPolicy {
  if (CURRENT_CELL === 'cn') {
    return {
      cell: 'cn',
      currency: 'CNY',
      defaultProvider: PaymentProvider.wechat_pay,
      providers: [PaymentProvider.wechat_pay, PaymentProvider.alipay],
      rateMode: COMPUTE_POINT_EXPLICIT_ADMIN_PRICING,
    };
  }
  return {
    cell: 'global',
    currency: COMPUTE_POINT_FIAT_CURRENCY,
    defaultProvider: PaymentProvider.airwallex,
    providers: [PaymentProvider.airwallex],
    rateMode: 'usd_cent_anchor',
  };
}

/**
 * Catalog providers (Airwallex) require a synced providerPriceId on their price
 * binding; amount-based providers (WeChat/Alipay) charge the amount directly and
 * have none. Gates the compute-topup binding query so a WeChat binding with a null
 * providerPriceId is still eligible.
 */
function providerRequiresPriceId(provider: PaymentProvider): boolean {
  return provider === PaymentProvider.airwallex;
}

function assertComputePointTopupPrice(
  price: PriceWithItem,
  policy: ComputePointTopupPolicy,
): void {
  if (price.item.productType !== BillingProductType.compute_point_pack) {
    throw new ConflictException({
      code: 'BILLING_COMPUTE_TOPUP_PRICE_TYPE_INVALID',
      msg: 'Billing price is not a compute-point package.',
    });
  }
  if (price.interval !== BillingPriceInterval.one_time) {
    throw new ConflictException({
      code: 'BILLING_COMPUTE_TOPUP_INTERVAL_INVALID',
      msg: 'Compute point top-up package must be a one-time price.',
    });
  }
  if (price.subjectType !== BillingSubjectType.user) {
    throw new ConflictException({
      code: 'BILLING_COMPUTE_TOPUP_SUBJECT_INVALID',
      msg: 'Compute point top-up package must grant to a user wallet.',
    });
  }
  if (price.currency !== policy.currency) {
    throw new ConflictException({
      code: 'BILLING_COMPUTE_TOPUP_CURRENCY_INVALID',
      msg: `Compute point top-up in this deployment supports ${policy.currency} only.`,
    });
  }
  if (
    price.grantsWalletCurrency !== WalletCurrencyType.compute_point ||
    price.grantsWalletBalanceKind !== WalletBalanceKind.consumable ||
    !price.grantsWalletAmount
  ) {
    throw new ConflictException({
      code: 'BILLING_COMPUTE_TOPUP_GRANT_INVALID',
      msg: 'Compute point top-up package must grant consumable compute points.',
    });
  }
  const metadata = isRecord(price.metadata) ? price.metadata : {};
  if (metadata.topupKind !== 'compute_point') {
    throw new ConflictException({
      code: 'BILLING_COMPUTE_TOPUP_METADATA_INVALID',
      msg: 'Compute point top-up package must be explicitly marked as compute_point top-up.',
    });
  }
  if (price.currency !== COMPUTE_POINT_FIAT_CURRENCY) {
    if (metadata.rateMode !== COMPUTE_POINT_EXPLICIT_ADMIN_PRICING) {
      throw new ConflictException({
        code: 'BILLING_COMPUTE_TOPUP_RATE_MODE_INVALID',
        msg: 'Non-USD compute point prices must use explicit admin pricing.',
      });
    }
    return;
  }
  const expectedGrant = price.amountMinor * BigInt(COMPUTE_POINTS_PER_USD_CENT);
  if (price.grantsWalletAmount !== expectedGrant) {
    throw new ConflictException({
      code: 'BILLING_COMPUTE_TOPUP_RATE_MISMATCH',
      msg: 'Compute point top-up package violates the USD cent exchange rate.',
    });
  }
}

function assertAdminPromotionProviderPolicy(
  input: CreateAdminBillingPromotionInput,
): void {
  if (input.appliesProductType !== BillingProductType.compute_point_pack) {
    return;
  }

  const policy = computePointTopupPolicy();
  for (const binding of input.providerBindings) {
    assertComputePointPromotionProviderAllowed(
      binding.provider as PaymentProvider,
      policy,
    );
  }

  if ((input.percentOffBps ?? 0) >= 10000) {
    return;
  }

  const hasDefaultProviderBinding = input.providerBindings.some(
    (binding) => binding.provider === policy.defaultProvider,
  );
  if (!hasDefaultProviderBinding) {
    throw new BadRequestException({
      code: 'BILLING_ADMIN_COMPUTE_PROMOTION_PROVIDER_REQUIRED',
      msg: `Paid compute point promotions must bind the current payment provider "${policy.defaultProvider}" so the provider coupon can be synced before checkout.`,
    });
  }
}

function assertComputePointPromotionProviderAllowed(
  provider: PaymentProvider,
  policy = computePointTopupPolicy(),
): void {
  if (!policy.providers.includes(provider)) {
    throw new BadRequestException({
      code: 'BILLING_ADMIN_COMPUTE_PROMOTION_PROVIDER_INVALID',
      msg: `Compute point promotions in this deployment support ${policy.providers.join(
        ', ',
      )} only.`,
    });
  }
}

function shouldRequireProviderBoundCatalog(): boolean {
  const explicit =
    process.env.BILLING_REQUIRE_PROVIDER_BOUND_CATALOG?.trim().toLowerCase();
  if (explicit === 'true' || explicit === '1' || explicit === 'yes') {
    return true;
  }
  if (explicit === 'false' || explicit === '0' || explicit === 'no') {
    return false;
  }
  return process.env.NODE_ENV === 'production';
}

function normalizeAdminPriceMetadata(
  input: CreateAdminBillingPriceInput,
): Record<string, unknown> {
  const existing = input.priceMetadata ?? {};
  if (input.productType !== BillingProductType.compute_point_pack) {
    return existing;
  }

  const policy = computePointTopupPolicy();
  if (input.currency !== policy.currency) {
    throw new BadRequestException({
      code: 'BILLING_ADMIN_COMPUTE_TOPUP_CURRENCY_INVALID',
      msg: `Compute point top-up packages in this deployment must be priced in ${policy.currency}.`,
    });
  }
  if (input.interval !== BillingPriceInterval.one_time) {
    throw new BadRequestException({
      code: 'BILLING_ADMIN_COMPUTE_TOPUP_INTERVAL_INVALID',
      msg: 'Compute point top-up packages must be one-time prices.',
    });
  }
  if (input.subjectType !== BillingSubjectType.user) {
    throw new BadRequestException({
      code: 'BILLING_ADMIN_COMPUTE_TOPUP_SUBJECT_INVALID',
      msg: 'Compute point top-up packages must grant to a user wallet.',
    });
  }
  if (
    input.grantsWalletCurrency !== WalletCurrencyType.compute_point ||
    input.grantsWalletAmount === undefined
  ) {
    throw new BadRequestException({
      code: 'BILLING_ADMIN_COMPUTE_TOPUP_GRANT_INVALID',
      msg: 'Compute point top-up packages must grant consumable compute points.',
    });
  }
  if (input.grantsPlanKey || input.grantDurationDays) {
    throw new BadRequestException({
      code: 'BILLING_ADMIN_COMPUTE_TOPUP_BENEFIT_INVALID',
      msg: 'Compute point top-up packages cannot grant memberships.',
    });
  }

  for (const binding of input.providerBindings) {
    if (!policy.providers.includes(binding.provider as PaymentProvider)) {
      throw new BadRequestException({
        code: 'BILLING_ADMIN_COMPUTE_TOPUP_PROVIDER_INVALID',
        msg: `Compute point top-up packages in this deployment support ${policy.providers.join(
          ', ',
        )} only.`,
      });
    }
  }

  if (input.currency === COMPUTE_POINT_FIAT_CURRENCY) {
    const expectedGrant =
      input.amountMinor * BigInt(COMPUTE_POINTS_PER_USD_CENT);
    if (input.grantsWalletAmount !== expectedGrant) {
      throw new BadRequestException({
        code: 'BILLING_ADMIN_COMPUTE_TOPUP_RATE_MISMATCH',
        msg: 'USD compute point packages must grant exactly one compute point per USD cent.',
      });
    }
  }

  assertMetadataMatches(existing, 'topupKind', 'compute_point');
  assertMetadataMatches(existing, 'rateMode', policy.rateMode);
  assertMetadataMatches(existing, 'cell', policy.cell);

  return {
    ...existing,
    topupKind: 'compute_point',
    rateMode: policy.rateMode,
    cell: policy.cell,
    exchangeRate:
      input.currency === COMPUTE_POINT_FIAT_CURRENCY
        ? {
            computePointsPerUsdCent: COMPUTE_POINTS_PER_USD_CENT,
            usdCentsPerComputePoint: 1,
          }
        : null,
  };
}

function groupPricesByPlanKey<T extends { grantsPlanKey: string | null }>(
  prices: T[],
): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const price of prices) {
    if (!price.grantsPlanKey) continue;
    const list = grouped.get(price.grantsPlanKey) ?? [];
    list.push(price);
    grouped.set(price.grantsPlanKey, list);
  }
  return grouped;
}

function assertMembershipPlanShape(
  productType: BillingProductType,
  subjectType: BillingSubjectType,
): void {
  if (
    productType === BillingProductType.membership_plan &&
    subjectType !== BillingSubjectType.user
  ) {
    throw new BadRequestException({
      code: 'BILLING_MEMBERSHIP_PLAN_SUBJECT_INVALID',
      msg: 'Individual membership plans must use user subject type.',
    });
  }
  if (
    productType === BillingProductType.team_membership_plan &&
    subjectType !== BillingSubjectType.workspace
  ) {
    throw new BadRequestException({
      code: 'BILLING_MEMBERSHIP_PLAN_SUBJECT_INVALID',
      msg: 'Team membership plans must use workspace subject type.',
    });
  }
}

function isMembershipProductType(productType: BillingProductType): boolean {
  return (
    productType === BillingProductType.membership_plan ||
    productType === BillingProductType.team_membership_plan ||
    productType === BillingProductType.community_membership_plan
  );
}

function membershipProductAxis(
  productType: BillingProductType,
): BillingProductType[] {
  if (productType === BillingProductType.community_membership_plan) {
    return [BillingProductType.community_membership_plan];
  }
  return [
    BillingProductType.membership_plan,
    BillingProductType.team_membership_plan,
  ];
}

function assertMetadataMatches(
  metadata: Record<string, unknown>,
  key: string,
  expected: string,
) {
  const actual = metadata[key];
  if (actual !== undefined && actual !== expected) {
    throw new BadRequestException({
      code: 'BILLING_ADMIN_METADATA_CONFLICT',
      msg: `Billing price metadata "${key}" must be "${expected}".`,
    });
  }
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

/**
 * The WeChat Pay APP支付 app-invoke params the mobile OpenSDK needs, as stored by
 * WechatPayProvider in the payment intent's `providerPayload.appInvoke`. Returns
 * null for any other provider or a malformed payload — deliberately narrow so the
 * raw provider payload is never surfaced to the client wholesale.
 */
function wechatAppInvokePayload(
  intent: BillingPaymentIntent,
): Record<string, unknown> | null {
  if (intent.provider !== PaymentProvider.wechat_pay) return null;
  const payload = intent.providerPayload;
  if (!isRecord(payload)) return null;
  const appInvoke = payload.appInvoke;
  return isRecord(appInvoke) ? appInvoke : null;
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

function providerInvoiceIdFromPayload(
  payload: Record<string, unknown>,
  eventType = eventTypeFromPayload(payload),
): string | null {
  return (
    stringAt(payload, ['data', 'invoice_id']) ??
    stringAt(payload, ['data', 'invoice', 'id']) ??
    (eventType.startsWith('invoice.')
      ? stringAt(payload, ['data', 'id'])
      : null)
  );
}

function providerPaymentIntentIdFromPayload(
  payload: Record<string, unknown>,
  eventType = eventTypeFromPayload(payload),
): string | null {
  return (
    stringAt(payload, ['data', 'payment_intent_id']) ??
    stringAt(payload, ['data', 'payment_intent', 'id']) ??
    (eventType.startsWith('payment_intent.')
      ? stringAt(payload, ['data', 'id'])
      : null)
  );
}

function providerCurrencyFromPayload(
  payload: Record<string, unknown>,
): string | null {
  const value =
    stringAt(payload, ['data', 'currency']) ??
    stringAt(payload, ['data', 'invoice', 'currency']);
  return value ? value.toUpperCase() : null;
}

function subscriptionRenewalIdempotencyKey(input: {
  provider: PaymentProvider;
  providerSubscriptionId: string;
  providerInvoiceId: string;
}): string {
  const digest = createHash('sha256')
    .update(
      [
        'subscription_renewal',
        input.provider,
        input.providerSubscriptionId,
        input.providerInvoiceId,
      ].join(':'),
    )
    .digest('hex');
  return `sub_renewal:${digest}`;
}

/**
 * Flatten Airwallex's two webhook envelopes into the one shape the ~65
 * `['data', …]` lookups below already expect.
 *
 * Airwallex ships two product families with different envelopes:
 *
 *   Payments API   `{ id, name, account_id, data: { object: { …resource… } } }`
 *   Billing API    `{ id, name, org_id,     data: { …resource fields… } }`
 *
 * Every lookup here was written against the Billing shape, so `payment_intent.*`
 * resolved `data.id` / `data.metadata.fizzdragon_order_id` to null, `matchPaymentIntent`
 * built an empty OR list and returned before issuing a query, and the event was
 * filed as "No matching payment intent or refund found." — a message that reads
 * like a failed lookup but describes one that never ran. On .com that swallowed
 * the first real customer top-up (order FD202608101707159A2589B51E, USD 10):
 * `billing_payment_intents` held a row whose `provider_payment_intent_id` was
 * exactly the payload's `data.object.id`, and nothing ever compared them.
 *
 * Sibling keys are kept and the wrapped resource wins on collision, so the
 * Billing shape — which has no `object` key — passes through untouched.
 *
 * Airwallex docs: the Payments envelope carries "the response body from the
 * Retrieve a … API" under `data.object` for PaymentIntent, PaymentAttempt,
 * Refund and PaymentConsent alike.
 */
export function unwrapProviderPayload(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  const data = payload.data;
  if (!isRecord(data) || !isRecord(data.object)) return payload;
  return { ...payload, data: { ...data, ...data.object } };
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
  return unwrapProviderPayload(value);
}

function providerPayloadRecordOrNull(
  value: Prisma.JsonValue,
): Record<string, unknown> | null {
  return isRecord(value) ? unwrapProviderPayload(value) : null;
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
  if (!hasExceptionResponse(err)) return false;
  const response = err.getResponse();
  return (
    isRecord(response) &&
    response.code === 'BILLING_PROVIDER_EVENT_ALREADY_PROCESSED'
  );
}

function hasExceptionResponse(
  err: unknown,
): err is { getResponse: () => unknown } {
  return isRecord(err) && typeof err.getResponse === 'function';
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

/**
 * Terminal subscription-lifecycle events (no payment intent attached). Maps a
 * standalone `subscription.*` event to the BillingSubscription status it should
 * land in. Returns null for non-terminal subscription events (created/updated/
 * activated) and for anything that isn't a subscription event.
 */
function subscriptionLifecycleStatus(
  eventType: string,
): BillingSubscriptionStatus | null {
  if (!eventType.startsWith('subscription.')) return null;
  if (
    eventType === 'subscription.cancelled' ||
    eventType === 'subscription.canceled' ||
    eventType === 'subscription.deactivated'
  ) {
    return BillingSubscriptionStatus.canceled;
  }
  if (eventType === 'subscription.expired') {
    return BillingSubscriptionStatus.expired;
  }
  return null;
}

function billingOrderGrantType(order: OrderWithPrice): WalletCreditGrantType {
  return order.price.grantsPlanKey
    ? WalletCreditGrantType.membership_included
    : WalletCreditGrantType.purchase_topup;
}

async function reverseWalletCreditGrantForRefundTx(
  tx: Prisma.TransactionClient,
  input: {
    accountId: string;
    order: OrderWithPrice;
    refund: BillingRefund;
    transactionId: string;
    ledgerEntryId: string;
    amount: bigint;
  },
) {
  let remaining = input.amount;
  const grants = await tx.walletCreditGrant.findMany({
    where: {
      accountId: input.accountId,
      sourceType: 'billing_order',
      sourceId: input.order.id,
      status: WalletCreditGrantStatus.active,
      availableAmount: { gt: 0n },
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
    const nextReversed = grant.reversedAmount + take;
    await tx.walletCreditGrant.update({
      where: { id: grant.id },
      data: {
        availableAmount: nextAvailable,
        reversedAmount: nextReversed,
        status: walletCreditGrantStatusAfter({
          totalAmount: grant.totalAmount,
          availableAmount: nextAvailable,
          heldAmount: grant.heldAmount,
          consumedAmount: grant.consumedAmount,
          expiredAmount: grant.expiredAmount,
          reversedAmount: nextReversed,
        }),
      },
    });
    await tx.walletCreditAllocation.create({
      data: {
        grantId: grant.id,
        transactionId: input.transactionId,
        ledgerEntryId: input.ledgerEntryId,
        amount: take,
        availableDelta: -take,
        heldDelta: 0n,
        consumedDelta: 0n,
        expiredDelta: 0n,
        reversedDelta: take,
      },
    });
    remaining -= take;
  }

  if (remaining > 0n) {
    throw new ConflictException({
      code: 'BILLING_REFUND_WALLET_GRANT_CONSUMED',
      msg: 'Refund is blocked because the granted credits from this order have already been consumed.',
      refundNo: input.refund.refundNo,
      orderNo: input.order.orderNo,
      requiredAmount: input.amount.toString(),
      unavailableAmount: remaining.toString(),
    });
  }
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

function walletCreditGrantStatusAfter(input: {
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

function membershipPlanSnapshot(plan: BillingMembershipPlan) {
  return {
    id: plan.id,
    planKey: plan.planKey,
    productType: plan.productType,
    subjectType: plan.subjectType,
    status: plan.status,
    rank: plan.rank,
    name: plan.name,
    includedComputeCredits: plan.includedComputeCredits.toString(),
    includedSeats: plan.includedSeats,
    maxSeats: plan.maxSeats,
    seatOverageAllowed: plan.seatOverageAllowed,
    billingIntervalDefault: plan.billingIntervalDefault,
    benefits: plan.benefits,
    marketing: plan.marketing,
  };
}

function periodEndForPrice(
  startsAt: Date,
  interval: BillingPriceInterval,
  grantDurationDays?: number | null,
): Date | null {
  if (grantDurationDays) {
    return new Date(
      startsAt.getTime() + grantDurationDays * 24 * 60 * 60 * 1000,
    );
  }
  if (interval === BillingPriceInterval.month) {
    const next = new Date(startsAt);
    next.setUTCMonth(next.getUTCMonth() + 1);
    return next;
  }
  if (interval === BillingPriceInterval.year) {
    const next = new Date(startsAt);
    next.setUTCFullYear(next.getUTCFullYear() + 1);
    return next;
  }
  return null;
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
const COMPUTE_RECHARGE_ITEM_CODE = 'COMPUTE_POINT_CUSTOM_RECHARGE';

/**
 * True for a Prisma unique-constraint violation (P2002) — used to turn the race
 * where two concurrent first-time requests share an idempotency key into a clean
 * replay: the loser's insert violates userId_idempotencyKey, after which the row
 * provably exists, so re-entering the method hits the idempotency replay branch.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

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

function valueAt(value: Record<string, unknown>, path: string[]): unknown {
  let current: unknown = value;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function providerPaidAmountMinorFromPayload(
  payload: Record<string, unknown>,
): bigint | null {
  const candidatePaths = [
    ['data', 'amount_paid'],
    ['data', 'paid_amount'],
    ['data', 'total_amount'],
    ['data', 'amount_due'],
    ['data', 'amount'],
    ['data', 'invoice', 'amount_paid'],
    ['data', 'invoice', 'paid_amount'],
    ['data', 'invoice', 'total_amount'],
  ];
  for (const path of candidatePaths) {
    const amount = majorAmountToMinor(valueAt(payload, path));
    if (amount !== null) return amount;
  }
  return null;
}

function majorAmountToMinor(value: unknown): bigint | null {
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || value < 0) return null;
    return BigInt(Math.round(value * 100));
  }
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(normalized);
  if (!match) return null;
  const whole = BigInt(match[1]);
  const fraction = match[2] ?? '';
  if (fraction.length > 2 && /[1-9]/.test(fraction.slice(2))) {
    return null;
  }
  const cents = BigInt(fraction.slice(0, 2).padEnd(2, '0') || '0');
  return whole * 100n + cents;
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

// Build the `appLovin` node persisted on an order's metadata from the optional
// checkout attribution. Returns a spreadable patch ({} when there's nothing to
// store) so order creation stays a pure addition. The keys mirror what
// reportAppLovinPurchase reads back (aleid / userAgent / ip / country).
function appLovinMetadataPatch(
  attribution: BillingAttributionInput | undefined,
): { appLovin?: Record<string, string> } {
  if (!attribution) return {};
  const node: Record<string, string> = {};
  if (attribution.aleid) node.aleid = attribution.aleid;
  if (attribution.clientUserAgent) node.userAgent = attribution.clientUserAgent;
  if (attribution.clientIp) node.ip = attribution.clientIp;
  if (attribution.countryCode) node.country = attribution.countryCode;
  return Object.keys(node).length > 0 ? { appLovin: node } : {};
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
  return origins;
}

function refundIntentFingerprint(
  adminId: string,
  input: CreateAdminBillingRefundInput,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        adminId,
        input.orderId,
        input.amountMinor?.toString() ?? null,
        input.percentBps ?? null,
        input.reasonCode,
        input.operatorNote || null,
      ]),
    )
    .digest('hex');
}

/** Escape `\`, `%`, `_` so user input is treated as a literal ILIKE substring. */
function likeContainsPattern(raw: string): string {
  return `%${raw.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_')}%`;
}
