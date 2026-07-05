import {
  BillingPriceInterval,
  BillingProductType,
  BillingProviderBindingStatus,
  BillingSubjectType,
  PaymentProvider,
  WalletBalanceKind,
  WalletCurrencyType,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';

/**
 * CN (.cn) fiat pricing — CNY point packs (compute + community) + one-off
 * membership passes (individual / team / community), each with a wechat_pay
 * provider binding (WeChat has no catalog, so providerPriceId is null — the
 * amount is charged directly). Runs ONLY in the CN cell (see seed.ts). Idempotent.
 *
 * VALUE parity at a fixed FX rate: .com sells 1 point = 1 US cent (BOTH compute
 * AND community points), so at CNY_PER_USD a CN point costs CNY_PER_USD 分 ≈ 7 分.
 * The point↔minor-unit ratio matches .com (1:1), but the ABSOLUTE value is FX'd —
 * keeping .com and .cn at equal real value (NOT a naive 1分=1美分, which would be
 * ~7× cheaper). The referral/withdrawal 1:1 is a SEPARATE mechanism on the
 * withdrawable balance and does not constrain this buy-price.
 *
 * Membership is a ONE-OFF 30-day pass (no auto-renew — re-purchase on expiry),
 * priced from .com monthly × CNY_PER_USD, cleaned to a CN 尾数. Plan DEFINITIONS
 * (basic/standard/pro/team/community_membership) are seeded cell-agnostically by
 * membership-plans.ts; this file only adds the CN CNY prices that grant them.
 */

export const SOURCE = 'seed.cn_prices.v1';
/** Fixed business FX rate (CNY per USD). Not real-time — a stable pricing anchor. */
const CNY_PER_USD = 7.0;
const MEMBERSHIP_PASS_DAYS = 30;
/** 分 per point: 1 point = 1 US cent of value → CNY_PER_USD 分. Compute AND community. */
const FEN_PER_POINT = BigInt(Math.round(CNY_PER_USD));

/** Point-pack sizes — identical for compute + community (same per-point value). */
const POINT_PACKS = [5000n, 10000n, 30000n];

type PointKind = {
  walletCurrency: WalletCurrencyType;
  productType: BillingProductType;
  codePrefix: string;
  label: string;
};
const COMMUNITY_POINTS: PointKind = {
  walletCurrency: WalletCurrencyType.community_point,
  productType: BillingProductType.community_point_pack,
  codePrefix: 'COMMUNITY_CN',
  label: '社区积分',
};

type MembershipPass = {
  planKey: string;
  amountMinor: bigint;
  productType: BillingProductType;
  subjectType: BillingSubjectType;
  label: string;
};
// .com monthly × CNY_PER_USD, cleaned to CN 尾数. subjectType: team is workspace-scoped.
const cnMembershipPasses: MembershipPass[] = [
  {
    planKey: 'basic',
    amountMinor: 19900n,
    productType: BillingProductType.membership_plan,
    subjectType: BillingSubjectType.user,
    label: '会员 basic',
  }, // ¥199 (.com $27)
  {
    planKey: 'standard',
    amountMinor: 39900n,
    productType: BillingProductType.membership_plan,
    subjectType: BillingSubjectType.user,
    label: '会员 standard',
  }, // ¥399 (.com $54)
  {
    planKey: 'pro',
    amountMinor: 79900n,
    productType: BillingProductType.membership_plan,
    subjectType: BillingSubjectType.user,
    label: '会员 pro',
  }, // ¥799 (.com $108)
  {
    planKey: 'team',
    amountMinor: 189900n,
    productType: BillingProductType.team_membership_plan,
    subjectType: BillingSubjectType.workspace,
    label: '团队会员',
  }, // ¥1899 (.com $270)
  {
    planKey: 'community_membership',
    amountMinor: 6900n,
    productType: BillingProductType.community_membership_plan,
    subjectType: BillingSubjectType.user,
    label: '社区会员',
  }, // ¥69 (.com $9.99)
];

/** Catalog-item codes/prefixes this seed owns (used to cull stray non-CN SKUs).
 *  Compute points have NO packs on CN — only the hidden custom-recharge anchor. */
export const CN_CODE_PREFIXES = [
  'COMMUNITY_CN_',
  'MEMBERSHIP_CN_',
  'COMPUTE_POINT_CUSTOM_RECHARGE',
];

export async function seedCnPrices(prisma: PrismaClient): Promise<void> {
  // Compute points are a CUSTOM-amount recharge on EVERY cell — there are no fixed
  // compute packs. Only the hidden ratio anchor is seeded (carries CNY→points).
  // Community points DO sell in fixed packs; memberships are one-off passes.
  await seedCnComputeCustomAnchor(prisma);
  for (const points of POINT_PACKS) {
    await seedCnPointPack(prisma, points, COMMUNITY_POINTS);
  }
  for (const pass of cnMembershipPasses) {
    await seedCnMembershipPass(prisma, pass);
  }
}

/**
 * Hidden compute-point custom-recharge anchor for the CN cell. Carries the CNY→
 * compute-point ratio (¥7 = 100 points, i.e. 7 分/point — same value parity as the
 * community packs). Read only by createCustomRecharge to size an arbitrary amount;
 * has NO provider binding, so it never appears in any public listing.
 */
async function seedCnComputeCustomAnchor(prisma: PrismaClient): Promise<void> {
  const code = 'COMPUTE_POINT_CUSTOM_RECHARGE';
  const item = await prisma.billingCatalogItem.upsert({
    where: { code },
    create: {
      code,
      productType: BillingProductType.compute_point_pack,
      name: 'Compute points (custom amount)',
      metadata: { source: SOURCE },
    },
    update: {
      productType: BillingProductType.compute_point_pack,
      isActive: true,
      archivedAt: null,
    },
  });
  // ¥7 (700 分) grants 100 compute points → the custom-recharge math derives
  // points = amountMinor × grantsWalletAmount / amountMinor-of-anchor = fen / 7.
  await upsertCnPrice(prisma, {
    itemId: item.id,
    amountMinor: 100n * FEN_PER_POINT,
    subjectType: BillingSubjectType.user,
    grantsWalletCurrency: WalletCurrencyType.compute_point,
    grantsWalletBalanceKind: WalletBalanceKind.consumable,
    grantsWalletAmount: 100n,
    grantsPlanKey: null,
    grantDurationDays: null,
    priceMetadata: {
      topupKind: 'compute_point',
      rateMode: 'explicit_admin_pricing',
      cell: 'cn',
    },
  });
  // The shared migration 20260615160000 inserts a USD anchor price on this item on
  // EVERY cell (not cell-gated); on CN it must not shadow the CNY anchor — archive
  // any non-CNY active price so exactly one active anchor price remains.
  await prisma.billingPrice.updateMany({
    where: { itemId: item.id, currency: { not: 'CNY' }, archivedAt: null },
    data: { isActive: false, archivedAt: new Date() },
  });
  // Intentionally NO wechat binding — the anchor must stay hidden from listings.
}

async function seedCnPointPack(
  prisma: PrismaClient,
  points: bigint,
  kind: PointKind,
): Promise<void> {
  const code = `${kind.codePrefix}_${points}`;
  const item = await prisma.billingCatalogItem.upsert({
    where: { code },
    create: {
      code,
      productType: kind.productType,
      name: `${Number(points).toLocaleString('en-US')} ${kind.label}`,
      metadata: { source: SOURCE },
    },
    update: { productType: kind.productType, isActive: true, archivedAt: null },
  });
  const price = await upsertCnPrice(prisma, {
    itemId: item.id,
    amountMinor: points * FEN_PER_POINT, // 1 point = 1 US 分 of value → CNY_PER_USD 分
    subjectType: BillingSubjectType.user,
    grantsWalletCurrency: kind.walletCurrency,
    grantsWalletBalanceKind: WalletBalanceKind.consumable,
    grantsWalletAmount: points,
    grantsPlanKey: null,
    grantDurationDays: null,
    // The compute-topup listing (billing.service) requires each pack's price to
    // be explicitly marked compute_point + explicit-admin-priced (CNY is non-USD,
    // so no usd_cent_anchor). Community packs list via a different endpoint.
    priceMetadata:
      kind.walletCurrency === WalletCurrencyType.compute_point
        ? {
            topupKind: 'compute_point',
            rateMode: 'explicit_admin_pricing',
            cell: 'cn',
          }
        : undefined,
  });
  await ensureWechatBinding(prisma, price.id);
}

async function seedCnMembershipPass(
  prisma: PrismaClient,
  pass: MembershipPass,
): Promise<void> {
  const code = `MEMBERSHIP_CN_${pass.planKey}`.toUpperCase();
  const item = await prisma.billingCatalogItem.upsert({
    where: { code },
    create: {
      code,
      productType: pass.productType,
      name: `${pass.label}（30天）`,
      metadata: { source: SOURCE, planKey: pass.planKey },
    },
    update: { productType: pass.productType, isActive: true, archivedAt: null },
  });
  const price = await upsertCnPrice(prisma, {
    itemId: item.id,
    amountMinor: pass.amountMinor,
    subjectType: pass.subjectType,
    grantsWalletCurrency: null,
    grantsWalletBalanceKind: null,
    grantsWalletAmount: null,
    grantsPlanKey: pass.planKey,
    grantDurationDays: MEMBERSHIP_PASS_DAYS,
  });
  await ensureWechatBinding(prisma, price.id);
}

type CnPriceInput = {
  itemId: string;
  amountMinor: bigint;
  subjectType: BillingSubjectType;
  grantsWalletCurrency: WalletCurrencyType | null;
  grantsWalletBalanceKind: WalletBalanceKind | null;
  grantsWalletAmount: bigint | null;
  grantsPlanKey: string | null;
  grantDurationDays: number | null;
  /** Extra price metadata merged onto {source}. Compute-point packs must carry
   *  topupKind/rateMode or the compute-topup listing rejects them. */
  priceMetadata?: Prisma.InputJsonObject;
};

/** Find-or-update the one active CNY one_time price on the item (idempotent). */
async function upsertCnPrice(prisma: PrismaClient, input: CnPriceInput) {
  const existing = await prisma.billingPrice.findFirst({
    where: {
      itemId: input.itemId,
      currency: 'CNY',
      interval: BillingPriceInterval.one_time,
      archivedAt: null,
    },
  });
  const data = {
    itemId: input.itemId,
    currency: 'CNY',
    amountMinor: input.amountMinor,
    interval: BillingPriceInterval.one_time,
    subjectType: input.subjectType,
    grantsWalletCurrency: input.grantsWalletCurrency,
    grantsWalletBalanceKind: input.grantsWalletBalanceKind,
    grantsWalletAmount: input.grantsWalletAmount,
    grantsPlanKey: input.grantsPlanKey,
    grantDurationDays: input.grantDurationDays,
    isActive: true,
    archivedAt: null,
    metadata: { source: SOURCE, ...(input.priceMetadata ?? {}) },
  } satisfies Prisma.BillingPriceUncheckedCreateInput;
  if (existing) {
    return prisma.billingPrice.update({ where: { id: existing.id }, data });
  }
  return prisma.billingPrice.create({ data });
}

/** Active wechat_pay binding (no providerPriceId — amount charged directly). */
async function ensureWechatBinding(
  prisma: PrismaClient,
  priceId: string,
): Promise<void> {
  const existing = await prisma.billingProviderPriceBinding.findFirst({
    where: { priceId, provider: PaymentProvider.wechat_pay, archivedAt: null },
  });
  if (existing) {
    if (existing.status !== BillingProviderBindingStatus.active) {
      await prisma.billingProviderPriceBinding.update({
        where: { id: existing.id },
        data: { status: BillingProviderBindingStatus.active },
      });
    }
    return;
  }
  await prisma.billingProviderPriceBinding.create({
    data: {
      priceId,
      provider: PaymentProvider.wechat_pay,
      status: BillingProviderBindingStatus.active,
      metadata: { source: SOURCE },
    },
  });
}
