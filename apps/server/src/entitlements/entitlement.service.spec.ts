import {
  BillingMembershipPlanStatus,
  BillingSubjectType,
  EntitlementGrantStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { EntitlementService } from './entitlement.service';
import { DEFAULT_FREE_BENEFITS } from './membership-benefits';

const NOW = '2026-06-12T12:00:00.000Z';

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return { userId: 'user-1', ...overrides };
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    subjectType: BillingSubjectType.user,
    subjectId: 'user-1',
    planKey: 'studio',
    status: EntitlementGrantStatus.active,
    startsAt: new Date('2026-06-01T00:00:00.000Z'),
    endsAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function benefits(overrides: Record<string, unknown> = {}) {
  return {
    quotaTier: 'VIP3',
    queuePriority: 2,
    imageDaily: 'Infinity',
    videoDaily: 'Infinity',
    chatDaily: 'Infinity',
    workflowDaily: 'Infinity',
    uploadMB: 30720,
    chatPerMinute: 80,
    concurrentJobs: 7,
    queuedJobs: 21,
    features: {
      aiGeneration: true,
      advancedModelAccess: true,
      advancedParameters: true,
      teamSharedCredits: false,
    },
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    planKey: 'studio',
    productType: 'membership_plan',
    subjectType: BillingSubjectType.user,
    rank: 40,
    status: BillingMembershipPlanStatus.active,
    archivedAt: null,
    featureFlags: {},
    limits: {},
    benefits: benefits(),
    ...overrides,
  };
}

function prismaMock(input: {
  grants?: unknown[][] | unknown[];
  plans?: unknown[];
}) {
  const grantBatches = Array.isArray(input.grants?.[0])
    ? ([...(input.grants as unknown[][])] as unknown[][])
    : [(input.grants as unknown[]) ?? []];
  const grantFindMany = jest.fn();
  for (const batch of grantBatches) {
    grantFindMany.mockResolvedValueOnce(batch);
  }
  grantFindMany.mockResolvedValue([]);
  return {
    entitlementGrant: { findMany: grantFindMany },
    billingMembershipPlan: {
      findMany: jest.fn().mockResolvedValue(input.plans ?? []),
    },
    billingSubscription: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

describe('EntitlementService benefits resolution', () => {
  it('resolves the snapshot from the plan row benefits JSONB', async () => {
    const prisma = prismaMock({ grants: [grant()], plans: [plan()] });
    const service = new EntitlementService(prisma as never);

    const snapshot = await service.resolveForUser(user(), { now: NOW });

    expect(snapshot.subject).toEqual({ type: 'user', id: 'user-1' });
    expect(snapshot.planKey).toBe('studio');
    expect(snapshot.quotaTier).toBe('VIP3');
    expect(snapshot.rank).toBe(40);
    expect(snapshot.limits.queuePriority).toBe(2);
    expect(snapshot.limits.imageDaily).toBe(Number.POSITIVE_INFINITY);
    expect(snapshot.limits.chatDaily).toBe(Number.POSITIVE_INFINITY);
    expect(snapshot.limits.uploadMB).toBe(30720);
    expect(snapshot.limits.chatPerMinute).toBe(80);
    expect(snapshot.limits.concurrentJobs).toBe(7);
    expect(snapshot.limits.queuedJobs).toBe(21);
    expect(snapshot.features.advancedParameters).toBe(true);
  });

  it('caches plan rows in-process and re-reads after invalidatePlanCache', async () => {
    const prisma = prismaMock({
      grants: [[grant()], [grant()], [grant()]],
      plans: [plan()],
    });
    const service = new EntitlementService(prisma as never);

    await service.resolveForUser(user(), { now: NOW });
    await service.resolveForUser(user(), { now: NOW });
    expect(prisma.billingMembershipPlan.findMany).toHaveBeenCalledTimes(1);

    service.invalidatePlanCache();
    await service.resolveForUser(user(), { now: NOW });
    expect(prisma.billingMembershipPlan.findMany).toHaveBeenCalledTimes(2);
  });

  it('fails loud on an active plan row with invalid benefits', async () => {
    const prisma = prismaMock({
      grants: [grant()],
      plans: [plan({ benefits: { chatDaily: 'lots' } })],
    });
    const service = new EntitlementService(prisma as never);

    await expect(service.resolveForUser(user(), { now: NOW })).rejects.toThrow(
      /Membership plan "studio" has invalid benefits/,
    );
  });

  it('resolves DEFAULT_FREE_BENEFITS when the subject has no grant', async () => {
    const prisma = prismaMock({ grants: [], plans: [] });
    const service = new EntitlementService(prisma as never);

    const snapshot = await service.resolveForUser(user(), { now: NOW });

    expect(snapshot.planKey).toBe('free');
    expect(snapshot.source).toBe('system_default');
    expect(snapshot.quotaTier).toBe('Free');
    expect(snapshot.limits.chatDaily).toBe(DEFAULT_FREE_BENEFITS.chatDaily);
    expect(snapshot.limits.queuePriority).toBe(
      DEFAULT_FREE_BENEFITS.queuePriority,
    );
    expect(snapshot.features).toEqual(DEFAULT_FREE_BENEFITS.features);
  });

  it('falls back to free benefits (with the grant planKey kept) when the plan row is missing', async () => {
    const prisma = prismaMock({ grants: [grant()], plans: [] });
    const service = new EntitlementService(prisma as never);

    const snapshot = await service.resolveForUser(user(), { now: NOW });

    expect(snapshot.planKey).toBe('studio');
    expect(snapshot.quotaTier).toBe('Free');
    expect(snapshot.limits.chatDaily).toBe(DEFAULT_FREE_BENEFITS.chatDaily);
  });

  it('excludes community membership grants from compute resolution', async () => {
    const prisma = prismaMock({ grants: [], plans: [] });
    const service = new EntitlementService(prisma as never);

    await service.resolveForUser(user(), { now: NOW });

    const calls = prisma.entitlementGrant.findMany.mock.calls as Array<
      [{ where: { planKey: unknown } }]
    >;
    expect(calls[0]?.[0]?.where.planKey).toEqual({
      not: 'community_membership',
    });
  });

  it('keeps workspace team limits scoped to the workspace subject', async () => {
    const prisma = prismaMock({
      grants: [
        [
          grant({
            subjectType: BillingSubjectType.workspace,
            subjectId: 'workspace-1',
            planKey: 'team',
          }),
        ],
        [],
      ],
      plans: [
        plan({
          planKey: 'team',
          productType: 'team_membership_plan',
          subjectType: BillingSubjectType.workspace,
          rank: 120,
          benefits: benefits({
            concurrentJobs: 16,
            queuedJobs: 64,
            features: {
              aiGeneration: true,
              advancedModelAccess: true,
              advancedParameters: true,
              teamSharedCredits: true,
            },
          }),
        }),
      ],
    });
    const service = new EntitlementService(prisma as never);

    const snapshot = await service.resolveForUser(user(), {
      workspaceId: 'workspace-1',
      now: NOW,
    });

    expect(snapshot.subject).toEqual({
      type: 'workspace',
      id: 'workspace-1',
    });
    expect(snapshot.features.teamSharedCredits).toBe(true);
    expect(snapshot.limits.concurrentJobs).toBe(16);
    expect(snapshot.limits.queuedJobs).toBe(64);
  });

  it('preserves null limits for contract-managed enterprise plans', async () => {
    const prisma = prismaMock({
      grants: [grant({ planKey: 'enterprise' })],
      plans: [
        plan({
          planKey: 'enterprise',
          rank: 90,
          benefits: benefits({
            queuePriority: 1,
            concurrentJobs: null,
            queuedJobs: null,
          }),
        }),
      ],
    });
    const service = new EntitlementService(prisma as never);

    const snapshot = await service.resolveForUser(user(), { now: NOW });

    expect(snapshot.limits.queuePriority).toBe(1);
    expect(snapshot.limits.concurrentJobs).toBeNull();
    expect(snapshot.limits.queuedJobs).toBeNull();
  });
});

describe('EntitlementService quota profile', () => {
  const soldPlans = [
    plan({
      id: 'plan-basic',
      planKey: 'basic',
      rank: 10,
      benefits: benefits({
        quotaTier: 'VIP1',
        queuePriority: 5,
        imageDaily: 30,
        videoDaily: 4,
        chatDaily: 200,
        workflowDaily: 10,
        uploadMB: 1024,
        chatPerMinute: 40,
        concurrentJobs: 1,
        queuedJobs: 4,
      }),
    }),
    plan({
      id: 'plan-standard',
      planKey: 'standard',
      rank: 20,
      benefits: benefits({
        quotaTier: 'VIP2',
        queuePriority: 4,
        imageDaily: 60,
        videoDaily: 10,
        chatDaily: 350,
        workflowDaily: 20,
        uploadMB: 3072,
        chatPerMinute: 50,
        concurrentJobs: 2,
        queuedJobs: 6,
      }),
    }),
    plan({
      id: 'plan-team',
      planKey: 'team',
      productType: 'team_membership_plan',
      subjectType: BillingSubjectType.workspace,
      rank: 110,
      benefits: benefits({ quotaTier: 'VIP3' }),
    }),
  ];

  it('suggests the lowest-ranked sold plan above the current one (free → basic)', async () => {
    const prisma = prismaMock({ grants: [], plans: soldPlans });
    const service = new EntitlementService(prisma as never);

    const profile = await service.quotaProfileForUser(user());

    expect(profile.planKey).toBe('free');
    expect(profile.tier).toBe('Free');
    expect(profile.limits.chatDaily).toBe(30);
    expect(profile.upgrade).toMatchObject({
      planKey: 'basic',
      tier: 'VIP1',
    });
    expect(profile.upgrade?.limits.chatDaily).toBe(200);
  });

  it('walks the plan rank ladder, ignores team plans for users, and tops out at null', async () => {
    const prisma = prismaMock({
      grants: [[grant({ planKey: 'basic' })], [grant({ planKey: 'standard' })]],
      plans: soldPlans,
    });
    const service = new EntitlementService(prisma as never);

    const fromBasic = await service.quotaProfileForUser(user());
    expect(fromBasic.upgrade).toMatchObject({
      planKey: 'standard',
      tier: 'VIP2',
    });

    // standard (rank 20) has no higher USER plan sold — team (rank 110) is
    // a workspace product and must never be suggested to a user subject.
    const fromStandard = await service.quotaProfileForUser(user());
    expect(fromStandard.planKey).toBe('standard');
    expect(fromStandard.upgrade).toBeNull();
  });
});
