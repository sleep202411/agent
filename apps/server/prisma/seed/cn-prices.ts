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
const COMPUTE_POINTS: PointKind = {
  walletCurrency: WalletCurrencyType.compute_point,
  productType: BillingProductType.compute_point_pack,
  codePrefix: 'COMPUTE_CN',
  label: '算力积分',
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

/** All catalog-item code prefixes this seed owns (used to cull stray non-CN SKUs). */
export const CN_CODE_PREFIXES = [
  'COMPUTE_CN_',
  'COMMUNITY_CN_',
  'MEMBERSHIP_CN_',
];

export async function seedCnPrices(prisma: PrismaClient): Promise<void> {
  for (const points of POINT_PACKS) {
    await seedCnPointPack(prisma, points, COMPUTE_POINTS);
    await seedCnPointPack(prisma, points, COMMUNITY_POINTS);
  }
  for (const pass of cnMembershipPasses) {
    await seedCnMembershipPass(prisma, pass);
  }
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
    metadata: { source: SOURCE },
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
