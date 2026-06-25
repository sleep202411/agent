import {
  BillingMembershipPlanStatus,
  BillingPriceInterval,
  BillingProductType,
  BillingProviderBindingStatus,
  BillingSubjectType,
  PaymentProvider,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';

type MembershipPlanSeed = {
  planKey: string;
  productType: BillingProductType;
  subjectType: BillingSubjectType;
  status: BillingMembershipPlanStatus;
  rank: number;
  name: string;
  description: string;
  includedComputeCredits: bigint;
  includedSeats: number;
  maxSeats: number | null;
  seatOverageAllowed: boolean;
  topupDiscountBps: number;
  featureFlags: Prisma.InputJsonValue;
  limits: Prisma.InputJsonValue;
  marketing: Prisma.InputJsonValue;
  metadata: Prisma.InputJsonValue;
};

type MembershipPriceSeed = {
  planKey: string;
  productType: BillingProductType;
  subjectType: BillingSubjectType;
  interval: BillingPriceInterval;
  currency: string;
  amountMinor: bigint;
  originalAmountMinor: bigint;
};

const PLAN_SEED_SOURCE = 'seed.membership_plans.v1';
const PRICE_SEED_SOURCE = 'seed.membership_prices.v1';
const BINDING_SEED_SOURCE = 'seed.provider_bindings.v1';
const SGD_PER_USD = 1.2886;

// Plans that existed in earlier seeds but are no longer offered. The seed
// archives them (+ their prices + provider bindings) so they neither display
// nor check out, without deleting historical rows. 2026-06-22: collapsed the
// individual lineup to Basic/Standard/Pro (dropped Studio) and the team lineup
// to a single self-serve Team tier (dropped Ultimate/Creator/Scale).
const retiredPlanKeys = [
  'studio',
  'team_ultimate',
  'team_creator',
  'team_scale',
  // Enterprise + Enterprise Team pulled from the lineup; archive (never delete)
  // their plan + prices + provider bindings.
  'enterprise',
  'team_enterprise',
];

const individualPlans: MembershipPlanSeed[] = [
  {
    planKey: 'basic',
    productType: BillingProductType.membership_plan,
    subjectType: BillingSubjectType.user,
    status: BillingMembershipPlanStatus.active,
    rank: 10,
    name: 'Basic',
    description: 'Entry individual plan for lightweight creator workflows.',
    includedComputeCredits: 2125n,
    includedSeats: 1,
    maxSeats: 1,
    seatOverageAllowed: false,
    topupDiscountBps: 0,
    featureFlags: {
      storyOs: 'basic',
      privateGenerations: false,
      commercialUse: true,
      prioritySupport: false,
    },
    limits: {
      queuePriority: 5,
      concurrentJobs: 1,
      queuedJobs: 4,
      messagesPerConversation: 100,
      chatHistoryDays: 15,
      approximateImagesPerMonth: 100,
      approximateVideosPerMonth: 30,
    },
    marketing: {
      audience: 'Starter creators',
      badge: null,
      order: 10,
    },
    metadata: { source: PLAN_SEED_SOURCE },
  },
  {
    planKey: 'standard',
    productType: BillingProductType.membership_plan,
    subjectType: BillingSubjectType.user,
    status: BillingMembershipPlanStatus.active,
    rank: 20,
    name: 'Standard',
    description: 'Full StoryOS plan for regular AI animation production.',
    includedComputeCredits: 4500n,
    includedSeats: 1,
    maxSeats: 1,
    seatOverageAllowed: false,
    topupDiscountBps: 1000,
    featureFlags: {
      storyOs: 'full',
      privateGenerations: true,
      commercialUse: true,
      prioritySupport: false,
    },
    limits: {
      queuePriority: 4,
      concurrentJobs: 2,
      queuedJobs: 6,
      messagesPerConversation: 200,
      chatHistoryDays: 90,
      approximateImagesPerMonth: 200,
      approximateVideosPerMonth: 60,
    },
    marketing: {
      audience: 'Active creators',
      badge: null,
      order: 20,
    },
    metadata: { source: PLAN_SEED_SOURCE },
  },
  {
    planKey: 'pro',
    productType: BillingProductType.membership_plan,
    subjectType: BillingSubjectType.user,
    status: BillingMembershipPlanStatus.active,
    rank: 30,
    name: 'Pro',
    description: 'Priority individual plan for high-output creator workflows.',
    includedComputeCredits: 9500n,
    includedSeats: 1,
    maxSeats: 1,
    seatOverageAllowed: false,
    topupDiscountBps: 1000,
    featureFlags: {
      storyOs: 'full',
      privateGenerations: true,
      commercialUse: true,
      prioritySupport: true,
    },
    limits: {
      queuePriority: 3,
      concurrentJobs: 3,
      queuedJobs: 10,
      messagesPerConversation: 500,
      chatHistoryDays: 365,
      approximateImagesPerMonth: 300,
      approximateVideosPerMonth: 120,
    },
    marketing: {
      audience: 'Professional creators',
      badge: 'Popular',
      order: 30,
    },
    metadata: { source: PLAN_SEED_SOURCE },
  },
];

// Team membership is the 4th tier of the unified studio lineup, but stays a
// workspace-subject plan (it grants a team workspace + shared compute pool +
// seats + member management). A single self-serve Team tier + a sales-only
// Enterprise Team tier.
const teamPlans: MembershipPlanSeed[] = [
  {
    planKey: 'team',
    productType: BillingProductType.team_membership_plan,
    subjectType: BillingSubjectType.workspace,
    status: BillingMembershipPlanStatus.active,
    rank: 40,
    name: 'Team',
    description:
      'Team workspace plan: shared compute credits, up to 8 seats, and member management.',
    includedComputeCredits: 22500n,
    includedSeats: 8,
    maxSeats: 8,
    seatOverageAllowed: false,
    topupDiscountBps: 1000,
    featureFlags: {
      storyOs: 'full',
      sharedCredits: true,
      teamWorkspace: true,
      memberManagement: true,
      privateGenerations: true,
      commercialUse: true,
      prioritySupport: true,
      advancedWorkflows: true,
    },
    limits: {
      queuePriority: 2,
      concurrentJobs: 8,
      queuedJobs: 32,
      messagesPerConversation: 1000,
      chatHistoryDays: 365,
      sharedWorkspaceStorageGb: 500,
    },
    marketing: {
      audience: 'Teams & studios',
      badge: 'Team',
      order: 40,
    },
    metadata: { source: PLAN_SEED_SOURCE },
  },
];

// Community membership (社区会员) — a SEPARATE axis from the studio/VIP plans:
// it grants no compute credits/tiers; its value is member-free IP viewing + IP
// purchase discounts + exclusive content/badge, enforced in ip-commerce by
// planKey === 'community_membership' (never by rank). See docs/community-membership.md.
const communityPlans: MembershipPlanSeed[] = [
  {
    planKey: 'community_membership',
    productType: BillingProductType.community_membership_plan,
    subjectType: BillingSubjectType.user,
    status: BillingMembershipPlanStatus.active,
    rank: 10,
    name: 'Community Membership',
    description:
      'Watch member-free IPs for free and get member discounts on paid IPs.',
    includedComputeCredits: 0n,
    includedSeats: 1,
    maxSeats: 1,
    seatOverageAllowed: false,
    topupDiscountBps: 0,
    featureFlags: {
      communityMemberFreeViewing: true,
      ipPurchaseDiscount: true,
      exclusiveContent: true,
      memberBadge: true,
    },
    limits: {},
    marketing: {
      audience: 'Community viewers & supporters',
      badge: null,
      order: 10,
    },
    metadata: { source: PLAN_SEED_SOURCE },
  },
];

const defaultUsdPrices = [
  {
    planKey: 'basic',
    monthlyAutoRenewMinor: 2700n,
    monthlyOriginalMinor: 3000n,
    annualMinor: 27000n,
    annualOriginalMinor: 36000n,
  },
  {
    planKey: 'standard',
    monthlyAutoRenewMinor: 5400n,
    monthlyOriginalMinor: 6000n,
    annualMinor: 54000n,
    annualOriginalMinor: 72000n,
  },
  {
    planKey: 'pro',
    monthlyAutoRenewMinor: 10800n,
    monthlyOriginalMinor: 12000n,
    annualMinor: 108000n,
    annualOriginalMinor: 144000n,
  },
  {
    // Team = single self-serve tier: $270/mo (list $300, auto-renew 0.9),
    // $2,700/yr (annual = list $300 x 12 x 0.75). 8 seats, 22,500 shared credits.
    planKey: 'team',
    monthlyAutoRenewMinor: 27000n,
    monthlyOriginalMinor: 30000n,
    annualMinor: 270000n,
    annualOriginalMinor: 360000n,
  },
  {
    // 9.99/mo base; annual = 10 months (2 free). Admin discounts ride on top via
    // BillingPromotion (no bespoke discount field).
    planKey: 'community_membership',
    monthlyAutoRenewMinor: 999n,
    monthlyOriginalMinor: 999n,
    annualMinor: 9990n,
    annualOriginalMinor: 11988n,
  },
] as const;

export async function seedMembershipPlans(prisma: PrismaClient) {
  const plans = [...individualPlans, ...teamPlans, ...communityPlans];
  for (const plan of plans) {
    await prisma.billingMembershipPlan.upsert({
      where: { planKey: plan.planKey },
      create: {
        ...plan,
        billingIntervalDefault: BillingPriceInterval.month,
      },
      update: {
        productType: plan.productType,
        subjectType: plan.subjectType,
        status: plan.status,
        rank: plan.rank,
        name: plan.name,
        description: plan.description,
        includedComputeCredits: plan.includedComputeCredits,
        includedSeats: plan.includedSeats,
        maxSeats: plan.maxSeats,
        seatOverageAllowed: plan.seatOverageAllowed,
        topupDiscountBps: plan.topupDiscountBps,
        billingIntervalDefault: BillingPriceInterval.month,
        featureFlags: plan.featureFlags,
        limits: plan.limits,
        marketing: plan.marketing,
        metadata: plan.metadata,
        archivedAt: null,
      },
    });
  }

  const planByKey = new Map(plans.map((plan) => [plan.planKey, plan]));
  for (const price of buildDefaultPriceSeeds(planByKey)) {
    await seedMembershipPrice(prisma, price);
  }

  // Order matters: archive retired plans/prices BEFORE seeding bindings so the
  // binding pass never (re)binds a price that is on its way out.
  await retireRemovedPlans(prisma);
  await seedAirwallexProviderBindings(prisma);
}

// Archive plans removed from the lineup, plus their prices and provider
// bindings. Idempotent: no-ops when the rows are absent (fresh DB) or already
// archived. Never deletes — keeps historical rows for audit/refunds.
async function retireRemovedPlans(prisma: PrismaClient) {
  const now = new Date();
  for (const planKey of retiredPlanKeys) {
    await prisma.billingMembershipPlan.updateMany({
      where: { planKey, archivedAt: null },
      data: {
        status: BillingMembershipPlanStatus.archived,
        archivedAt: now,
      },
    });
    const prices = await prisma.billingPrice.findMany({
      where: { grantsPlanKey: planKey, archivedAt: null },
      select: { id: true },
    });
    const priceIds = prices.map((price) => price.id);
    if (priceIds.length === 0) continue;
    await prisma.billingProviderPriceBinding.updateMany({
      where: { priceId: { in: priceIds }, archivedAt: null },
      data: { status: BillingProviderBindingStatus.inactive, archivedAt: now },
    });
    await prisma.billingPrice.updateMany({
      where: { id: { in: priceIds } },
      data: { isActive: false, archivedAt: now },
    });
  }
}

// Create a sync_pending Airwallex provider binding for every active, non-archived
// USD price that requires one (skips SGD — .com is USD-only — and sales-only
// plans, which have no seeded price). The actual Airwallex product/price objects
// are created later by POST /admin/billing/provider-bindings/sync-pending, which
// fills providerProductId/providerPriceId and flips status -> active. Idempotent:
// never clobbers an existing (active/synced) binding.
async function seedAirwallexProviderBindings(prisma: PrismaClient) {
  const prices = await prisma.billingPrice.findMany({
    where: { currency: 'USD', isActive: true, archivedAt: null },
    select: { id: true, metadata: true },
  });
  for (const price of prices) {
    const meta = price.metadata as { providerBindingRequired?: unknown } | null;
    if (!meta || meta.providerBindingRequired !== true) continue;
    const existing = await prisma.billingProviderPriceBinding.findFirst({
      where: {
        priceId: price.id,
        provider: PaymentProvider.airwallex,
        archivedAt: null,
      },
    });
    if (existing) continue;
    await prisma.billingProviderPriceBinding.create({
      data: {
        priceId: price.id,
        provider: PaymentProvider.airwallex,
        status: BillingProviderBindingStatus.sync_pending,
        metadata: { source: BINDING_SEED_SOURCE },
      },
    });
  }
}

function buildDefaultPriceSeeds(
  planByKey: Map<string, MembershipPlanSeed>,
): MembershipPriceSeed[] {
  return defaultUsdPrices.flatMap((input) => {
    const plan = planByKey.get(input.planKey);
    if (!plan) return [];
    return [
      priceSeed(
        plan,
        BillingPriceInterval.month,
        'USD',
        input.monthlyAutoRenewMinor,
        input.monthlyOriginalMinor,
      ),
      priceSeed(
        plan,
        BillingPriceInterval.year,
        'USD',
        input.annualMinor,
        input.annualOriginalMinor,
      ),
      priceSeed(
        plan,
        BillingPriceInterval.month,
        'SGD',
        usdToSgdMinor(input.monthlyAutoRenewMinor),
        usdToSgdMinor(input.monthlyOriginalMinor),
      ),
      priceSeed(
        plan,
        BillingPriceInterval.year,
        'SGD',
        usdToSgdMinor(input.annualMinor),
        usdToSgdMinor(input.annualOriginalMinor),
      ),
    ];
  });
}

function priceSeed(
  plan: MembershipPlanSeed,
  interval: BillingPriceInterval,
  currency: string,
  amountMinor: bigint,
  originalAmountMinor: bigint,
): MembershipPriceSeed {
  return {
    planKey: plan.planKey,
    productType: plan.productType,
    subjectType: plan.subjectType,
    interval,
    currency,
    amountMinor,
    originalAmountMinor,
  };
}

function usdToSgdMinor(usdMinor: bigint) {
  return BigInt(Math.round(Number(usdMinor) * SGD_PER_USD));
}

async function seedMembershipPrice(
  prisma: PrismaClient,
  price: MembershipPriceSeed,
) {
  const itemCode = buildMembershipItemCode(price);
  const item = await prisma.billingCatalogItem.upsert({
    where: { code: itemCode },
    create: {
      code: itemCode,
      productType: price.productType,
      name: membershipItemName(price),
      description: `Default ${price.interval} price for ${price.planKey}. Provider binding is configured in admin.`,
      metadata: { source: PRICE_SEED_SOURCE, planKey: price.planKey },
    },
    update: {
      productType: price.productType,
      isActive: true,
      archivedAt: null,
    },
  });

  const where = {
    itemId: item.id,
    currency: price.currency,
    interval: price.interval,
    grantsPlanKey: price.planKey,
    archivedAt: null,
  };
  const existingSeeded = await prisma.billingPrice.findFirst({
    where: {
      ...where,
      metadata: { path: ['source'], equals: PRICE_SEED_SOURCE },
    },
  });
  const existingManual = existingSeeded
    ? null
    : await prisma.billingPrice.findFirst({ where });
  if (existingManual) return;

  const data = {
    itemId: item.id,
    currency: price.currency,
    amountMinor: price.amountMinor,
    interval: price.interval,
    subjectType: price.subjectType,
    grantsWalletCurrency: null,
    grantsWalletBalanceKind: null,
    grantsWalletAmount: null,
    grantsPlanKey: price.planKey,
    grantDurationDays: null,
    isActive: true,
    archivedAt: null,
    metadata: {
      source: PRICE_SEED_SOURCE,
      planKey: price.planKey,
      originalAmountMinor: price.originalAmountMinor.toString(),
      autoRenew: true,
      providerBindingRequired: true,
    },
  } satisfies Prisma.BillingPriceUncheckedCreateInput;

  if (existingSeeded) {
    await prisma.billingPrice.update({
      where: { id: existingSeeded.id },
      data,
    });
    return;
  }

  await prisma.billingPrice.create({ data });
}

function buildMembershipItemCode(price: MembershipPriceSeed) {
  const prefix =
    price.productType === BillingProductType.team_membership_plan
      ? 'TEAM_MEMBERSHIP'
      : 'MEMBERSHIP';
  return `${prefix}_${price.planKey}`.toUpperCase().slice(0, 96);
}

function membershipItemName(price: MembershipPriceSeed) {
  const prefix =
    price.productType === BillingProductType.team_membership_plan
      ? 'Team Membership'
      : 'Membership';
  return `${prefix} ${price.planKey}`;
}
