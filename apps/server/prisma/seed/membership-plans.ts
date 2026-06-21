import {
  BillingMembershipPlanStatus,
  BillingPriceInterval,
  BillingProductType,
  BillingSubjectType,
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
const SGD_PER_USD = 1.2886;

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
  {
    planKey: 'studio',
    productType: BillingProductType.membership_plan,
    subjectType: BillingSubjectType.user,
    status: BillingMembershipPlanStatus.active,
    rank: 40,
    name: 'Studio',
    description: 'Individual studio plan for sustained production volume.',
    includedComputeCredits: 18000n,
    includedSeats: 1,
    maxSeats: 1,
    seatOverageAllowed: false,
    topupDiscountBps: 1500,
    featureFlags: {
      storyOs: 'full',
      privateGenerations: true,
      commercialUse: true,
      prioritySupport: true,
      advancedWorkflows: true,
    },
    limits: {
      queuePriority: 2,
      concurrentJobs: 5,
      queuedJobs: 16,
      messagesPerConversation: 1000,
      chatHistoryDays: 365,
      approximateImagesPerMonth: 600,
      approximateVideosPerMonth: 240,
    },
    marketing: {
      audience: 'High-volume solo studios',
      badge: 'New',
      order: 40,
    },
    metadata: { source: PLAN_SEED_SOURCE },
  },
  {
    planKey: 'enterprise',
    productType: BillingProductType.membership_plan,
    subjectType: BillingSubjectType.user,
    status: BillingMembershipPlanStatus.active,
    rank: 90,
    name: 'Enterprise',
    description: 'Custom individual enterprise agreement managed by sales.',
    includedComputeCredits: 0n,
    includedSeats: 1,
    maxSeats: null,
    seatOverageAllowed: true,
    topupDiscountBps: 0,
    featureFlags: {
      customContract: true,
      prioritySupport: true,
      advancedWorkflows: true,
    },
    limits: {
      queuePriority: 1,
      concurrentJobs: null,
      queuedJobs: null,
      messagesPerConversation: null,
      chatHistoryDays: null,
    },
    marketing: {
      audience: 'Enterprise customers',
      badge: 'Custom',
      order: 90,
    },
    metadata: { source: PLAN_SEED_SOURCE, salesOnly: true },
  },
];

const teamPlans: MembershipPlanSeed[] = [
  {
    planKey: 'team_ultimate',
    productType: BillingProductType.team_membership_plan,
    subjectType: BillingSubjectType.workspace,
    status: BillingMembershipPlanStatus.active,
    rank: 110,
    name: 'Teams Ultimate',
    description:
      'Team plan for small creative partners standardizing workflows.',
    includedComputeCredits: 16000n,
    includedSeats: 6,
    maxSeats: 6,
    seatOverageAllowed: false,
    topupDiscountBps: 1000,
    featureFlags: {
      sharedCredits: true,
      privateGenerations: true,
      commercialUse: true,
      prioritySupport: true,
    },
    limits: {
      queuePriority: 3,
      concurrentJobs: 6,
      queuedJobs: 24,
      approximateImagesPerMonth: 3200,
      sharedWorkspaceStorageGb: 100,
    },
    marketing: {
      audience: 'Creative partners',
      badge: null,
      order: 110,
    },
    metadata: { source: PLAN_SEED_SOURCE },
  },
  {
    planKey: 'team_creator',
    productType: BillingProductType.team_membership_plan,
    subjectType: BillingSubjectType.workspace,
    status: BillingMembershipPlanStatus.active,
    rank: 120,
    name: 'Teams Creator',
    description: 'Team plan for agencies maximizing production throughput.',
    includedComputeCredits: 100000n,
    includedSeats: 20,
    maxSeats: 20,
    seatOverageAllowed: false,
    topupDiscountBps: 1500,
    featureFlags: {
      sharedCredits: true,
      privateGenerations: true,
      commercialUse: true,
      prioritySupport: true,
      advancedWorkflows: true,
    },
    limits: {
      queuePriority: 2,
      concurrentJobs: 16,
      queuedJobs: 64,
      approximateImagesPerMonth: 20000,
      sharedWorkspaceStorageGb: 500,
    },
    marketing: {
      audience: 'High-output agencies',
      badge: null,
      order: 120,
    },
    metadata: { source: PLAN_SEED_SOURCE },
  },
  {
    planKey: 'team_scale',
    productType: BillingProductType.team_membership_plan,
    subjectType: BillingSubjectType.workspace,
    status: BillingMembershipPlanStatus.active,
    rank: 130,
    name: 'Teams Scale',
    description: 'Team plan for large teams institutionalizing AI production.',
    includedComputeCredits: 215000n,
    includedSeats: 40,
    maxSeats: 40,
    seatOverageAllowed: false,
    topupDiscountBps: 2000,
    featureFlags: {
      sharedCredits: true,
      privateGenerations: true,
      commercialUse: true,
      prioritySupport: true,
      advancedWorkflows: true,
      governanceControls: true,
    },
    limits: {
      queuePriority: 1,
      concurrentJobs: 32,
      queuedJobs: 128,
      approximateImagesPerMonth: 43000,
      sharedWorkspaceStorageGb: 1000,
    },
    marketing: {
      audience: 'Scaling agencies',
      badge: 'Best for agencies',
      order: 130,
    },
    metadata: { source: PLAN_SEED_SOURCE },
  },
  {
    planKey: 'team_enterprise',
    productType: BillingProductType.team_membership_plan,
    subjectType: BillingSubjectType.workspace,
    status: BillingMembershipPlanStatus.active,
    rank: 190,
    name: 'Enterprise Team',
    description: 'Custom team agreement for large organizations.',
    includedComputeCredits: 0n,
    includedSeats: 1,
    maxSeats: null,
    seatOverageAllowed: true,
    topupDiscountBps: 0,
    featureFlags: {
      sharedCredits: true,
      customContract: true,
      privateGenerations: true,
      commercialUse: true,
      prioritySupport: true,
      advancedWorkflows: true,
      governanceControls: true,
    },
    limits: {
      queuePriority: 1,
      concurrentJobs: null,
      queuedJobs: null,
      approximateImagesPerMonth: null,
      sharedWorkspaceStorageGb: null,
    },
    marketing: {
      audience: 'Enterprise teams',
      badge: 'Custom',
      order: 190,
    },
    metadata: { source: PLAN_SEED_SOURCE, salesOnly: true },
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
    planKey: 'studio',
    monthlyAutoRenewMinor: 19900n,
    monthlyOriginalMinor: 22000n,
    annualMinor: 199000n,
    annualOriginalMinor: 264000n,
  },
  {
    planKey: 'team_ultimate',
    monthlyAutoRenewMinor: 3900n,
    monthlyOriginalMinor: 4700n,
    annualMinor: 39000n,
    annualOriginalMinor: 56400n,
  },
  {
    planKey: 'team_creator',
    monthlyAutoRenewMinor: 19900n,
    monthlyOriginalMinor: 23400n,
    annualMinor: 199000n,
    annualOriginalMinor: 280800n,
  },
  {
    planKey: 'team_scale',
    monthlyAutoRenewMinor: 39900n,
    monthlyOriginalMinor: 47000n,
    annualMinor: 399000n,
    annualOriginalMinor: 564000n,
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
