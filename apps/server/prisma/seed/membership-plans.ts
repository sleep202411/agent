import {
  BillingMembershipPlanStatus,
  BillingPriceInterval,
  BillingProductType,
  BillingSubjectType,
  PaymentProvider,
  type Prisma,
  type PrismaClient,
} from '@prisma/client';

import {
  DEFAULT_FREE_BENEFITS,
  type MembershipBenefits,
} from '../../src/entitlements/membership-benefits';

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
  benefits: MembershipBenefits;
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
    benefits: {
      queuePriority: 5,
      imageDaily: 30,
      videoDaily: 4,
      chatDaily: 200,
      workflowDaily: 10,
      uploadMB: 1024,
      chatPerMinute: 40,
      concurrentJobs: 5,
      queuedJobs: 10,
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
    benefits: {
      queuePriority: 4,
      imageDaily: 60,
      videoDaily: 10,
      chatDaily: 350,
      workflowDaily: 20,
      uploadMB: 3072,
      chatPerMinute: 50,
      concurrentJobs: 8,
      queuedJobs: 16,
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
    benefits: {
      queuePriority: 3,
      imageDaily: 100,
      videoDaily: 20,
      chatDaily: 500,
      workflowDaily: 30,
      uploadMB: 5120,
      chatPerMinute: 60,
      concurrentJobs: 12,
      queuedJobs: 24,
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
// creator seats + member management). Team is the single workspace tier.
const teamPlans: MembershipPlanSeed[] = [
  {
    planKey: 'team',
    productType: BillingProductType.team_membership_plan,
    subjectType: BillingSubjectType.workspace,
    status: BillingMembershipPlanStatus.active,
    rank: 40,
    name: 'Team',
    description:
      'Team workspace plan: shared compute credits and up to 28 unique creator seats across all projects.',
    includedComputeCredits: 22500n,
    includedSeats: 28,
    maxSeats: 28,
    seatOverageAllowed: false,
    benefits: {
      queuePriority: 2,
      imageDaily: 'Infinity',
      videoDaily: 'Infinity',
      chatDaily: 'Infinity',
      workflowDaily: 'Infinity',
      uploadMB: 51200,
      chatPerMinute: 100,
      concurrentJobs: 28,
      queuedJobs: 56,
    },
    marketing: {
      audience: 'Teams & studios',
      badge: 'Team',
      order: 40,
    },
    metadata: { source: PLAN_SEED_SOURCE },
  },
];

// Community membership (社区会员) — a SEPARATE axis from the compute plans:
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
    benefits: DEFAULT_FREE_BENEFITS,
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
    // $2,700/yr (annual = list $300 x 12 x 0.75). 28 creator seats,
    // 22,500 shared credits per billing grant period.
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
    const benefits = plan.benefits as Prisma.InputJsonValue;
    await prisma.billingMembershipPlan.upsert({
      where: { planKey: plan.planKey },
      create: {
        ...plan,
        benefits,
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
        billingIntervalDefault: BillingPriceInterval.month,
        benefits,
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

  await seedAirwallexProviderBindings(prisma);
}

// Create a sync_pending Airwallex provider binding for every active, non-archived
// USD price that requires one (.com memberships are USD-only; sales-only plans
// have no seeded price). The actual Airwallex product/price objects
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
    // .com memberships are USD-only. (CN CNY prices are seeded by cn-prices.ts.)
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
