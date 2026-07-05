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
 * CN (.cn) fiat pricing — CNY compute-point packs + one-off membership passes, each
 * with a wechat_pay provider binding (WeChat has no catalog, so providerPriceId is
 * null — the amount is charged directly). Runs ONLY in the CN cell (see seed.ts) so
 * it never pollutes .com. Idempotent: re-running updates the same rows.
 *
 * Pricing mirrors .com VALUE at a FIXED business FX rate (the CN analogue of
 * SGD_PER_USD in membership-plans.ts): .com sells 1 point = 1 US cent, so at
 * CNY_PER_USD a CN point costs `1 分 × CNY_PER_USD` ≈ 7 分. Membership is a ONE-OFF
 * 30-day pass (no 委托代扣/auto-renew yet — users re-purchase on expiry).
 */

const SOURCE = 'seed.cn_prices.v1';
/** Fixed business FX rate (CNY per USD). Not real-time — a stable pricing anchor. */
const CNY_PER_USD = 7.0;
const MEMBERSHIP_PASS_DAYS = 30;

// Compute-point packs: .com point counts, priced at points × CNY_PER_USD 分.
const cnComputePacks = [5000n, 10000n, 30000n];

// Membership passes: .com USD monthly × ~CNY_PER_USD, cleaned to CN 尾数. Grants the
// existing basic/standard/pro plan (seeded cell-agnostically by membership-plans.ts)
// for a fixed 30 days.
const cnMembershipPasses: { planKey: string; amountMinor: bigint }[] = [
  { planKey: 'basic', amountMinor: 19900n }, // ¥199 (.com $27)
  { planKey: 'standard', amountMinor: 39900n }, // ¥399 (.com $54)
  { planKey: 'pro', amountMinor: 79900n }, // ¥799 (.com $108)
];

export async function seedCnPrices(prisma: PrismaClient): Promise<void> {
  for (const points of cnComputePacks) {
    await seedCnComputePack(prisma, points);
  }
  for (const pass of cnMembershipPasses) {
    await seedCnMembershipPass(prisma, pass.planKey, pass.amountMinor);
  }
}

async function seedCnComputePack(
  prisma: PrismaClient,
  points: bigint,
): Promise<void> {
  const code = `COMPUTE_CN_${points}`;
  const item = await prisma.billingCatalogItem.upsert({
    where: { code },
    create: {
      code,
      productType: BillingProductType.compute_point_pack,
      name: `${Number(points).toLocaleString('en-US')} 算力积分`,
      metadata: { source: SOURCE },
    },
    update: {
      productType: BillingProductType.compute_point_pack,
      isActive: true,
      archivedAt: null,
    },
  });
  const price = await upsertCnPrice(prisma, {
    itemId: item.id,
    amountMinor: points * BigInt(Math.round(CNY_PER_USD * 100)), // points × 分/point
    grantsWalletCurrency: WalletCurrencyType.compute_point,
    grantsWalletBalanceKind: WalletBalanceKind.consumable,
    grantsWalletAmount: points,
    grantsPlanKey: null,
    grantDurationDays: null,
  });
  await ensureWechatBinding(prisma, price.id);
}

async function seedCnMembershipPass(
  prisma: PrismaClient,
  planKey: string,
  amountMinor: bigint,
): Promise<void> {
  const code = `MEMBERSHIP_CN_${planKey}`.toUpperCase();
  const item = await prisma.billingCatalogItem.upsert({
    where: { code },
    create: {
      code,
      productType: BillingProductType.membership_plan,
      name: `会员 ${planKey}（30天）`,
      metadata: { source: SOURCE, planKey },
    },
    update: {
      productType: BillingProductType.membership_plan,
      isActive: true,
      archivedAt: null,
    },
  });
  const price = await upsertCnPrice(prisma, {
    itemId: item.id,
    amountMinor,
    grantsWalletCurrency: null,
    grantsWalletBalanceKind: null,
    grantsWalletAmount: null,
    grantsPlanKey: planKey,
    grantDurationDays: MEMBERSHIP_PASS_DAYS,
  });
  await ensureWechatBinding(prisma, price.id);
}

type CnPriceInput = {
  itemId: string;
  amountMinor: bigint;
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
    subjectType: BillingSubjectType.user,
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
    where: {
      priceId,
      provider: PaymentProvider.wechat_pay,
      archivedAt: null,
    },
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
