import {
  BillingMembershipPlanStatus,
  BillingSubjectType,
  EntitlementGrantStatus,
  WorkspaceType,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { EntitlementService } from './entitlement.service';
import { DEFAULT_FREE_BENEFITS } from './membership-benefits';
import {
  DEFAULT_TEAM_SEAT_POLICY,
  PERSONAL_WORKSPACE_SEAT_POLICY,
} from './seat-policy';
import { enqueueEntitlementChanged } from '../billing/entitlement-realtime';

jest.mock('../billing/entitlement-realtime', () => ({
  enqueueEntitlementChanged: jest.fn().mockResolvedValue(undefined),
}));

const NOW = '2026-06-12T12:00:00.000Z';

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return { userId: 'user-1', ...overrides };
}

function grant(overrides: Record<string, unknown> = {}) {
  return {
    id: 'grant-1',
    subjectType: BillingSubjectType.user,
    subjectId: 'user-1',
    planKey: 'basic',
    status: EntitlementGrantStatus.active,
    startsAt: new Date('2026-06-01T00:00:00.000Z'),
    endsAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
  };
}

function benefits(overrides: Record<string, unknown> = {}) {
  return {
    queuePriority: 2,
    imageDaily: 'Infinity',
    videoDaily: 'Infinity',
    chatDaily: 'Infinity',
    workflowDaily: 'Infinity',
    uploadMB: 30720,
    chatPerMinute: 80,
    concurrentJobs: 7,
    queuedJobs: 21,
    ...overrides,
  };
}

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    planKey: 'basic',
    productType: 'membership_plan',
    subjectType: BillingSubjectType.user,
    rank: 10,
    status: BillingMembershipPlanStatus.active,
    archivedAt: null,
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
    expect(snapshot.planKey).toBe('basic');
    expect(snapshot.rank).toBe(10);
    expect(snapshot.limits.queuePriority).toBe(2);
    expect(snapshot.limits.imageDaily).toBe(Number.POSITIVE_INFINITY);
    expect(snapshot.limits.chatDaily).toBe(Number.POSITIVE_INFINITY);
    expect(snapshot.limits.uploadMB).toBe(30720);
    expect(snapshot.limits.chatPerMinute).toBe(80);
    expect(snapshot.limits.concurrentJobs).toBe(7);
    expect(snapshot.limits.queuedJobs).toBe(21);
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
      /Membership plan "basic" has invalid benefits/,
    );
  });

  it('resolves DEFAULT_FREE_BENEFITS when the subject has no grant', async () => {
    const prisma = prismaMock({ grants: [], plans: [] });
    const service = new EntitlementService(prisma as never);

    const snapshot = await service.resolveForUser(user(), { now: NOW });

    expect(snapshot.planKey).toBe('free');
    expect(snapshot.source).toBe('system_default');
    expect(snapshot.limits.chatDaily).toBe(DEFAULT_FREE_BENEFITS.chatDaily);
    expect(snapshot.limits.queuePriority).toBe(
      DEFAULT_FREE_BENEFITS.queuePriority,
    );
  });

  it('fails loud when a paid grant has no active plan row', async () => {
    const prisma = prismaMock({ grants: [grant()], plans: [] });
    const service = new EntitlementService(prisma as never);

    await expect(service.resolveForUser(user(), { now: NOW })).rejects.toThrow(
      /active compute membership plan row is missing/i,
    );
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
          rank: 40,
          benefits: benefits({
            concurrentJobs: 16,
            queuedJobs: 64,
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
    expect(snapshot.limits.concurrentJobs).toBe(16);
    expect(snapshot.limits.queuedJobs).toBe(64);
  });

  it('preserves null limits for contract-managed plans', async () => {
    const prisma = prismaMock({
      grants: [grant({ planKey: 'team' })],
      plans: [
        plan({
          planKey: 'team',
          rank: 40,
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

describe('EntitlementService.grantComplimentary', () => {
  const input = {
    subjectType: BillingSubjectType.user,
    subjectId: 'user-1',
    planKey: 'pro',
    durationDays: 30,
    sourceType: 'admin_manual',
    sourceId: 'source-1',
  };

  function grantPrismaMock(planRow: unknown) {
    const prisma = {
      $transaction: jest.fn(),
      billingMembershipPlan: {
        findUnique: jest.fn().mockResolvedValue(planRow),
      },
      entitlementGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        upsert: jest.fn((args: { create: { planKey: string } }) => args.create),
      },
    };
    prisma.$transaction.mockImplementation((run: (tx: unknown) => unknown) =>
      Promise.resolve(run(prisma)),
    );
    return prisma;
  }

  it('grants against an active plan row on the same subject axis', async () => {
    const prisma = grantPrismaMock(plan({ planKey: 'pro' }));
    const service = new EntitlementService(prisma as never);

    await service.grantComplimentary(input);

    expect(prisma.entitlementGrant.upsert).toHaveBeenCalledTimes(1);
    expect(enqueueEntitlementChanged).toHaveBeenCalledWith(
      prisma,
      expect.objectContaining({ planKey: 'pro' }),
      'fulfilled',
    );
  });

  it('rejects a non-canonical plan key before looking up a plan row', async () => {
    const prisma = grantPrismaMock(null);
    const service = new EntitlementService(prisma as never);

    await expect(
      service.grantComplimentary({ ...input, planKey: 'unknown_plan' }),
    ).rejects.toThrow('Unknown compute membership plan key: unknown_plan');
    expect(prisma.entitlementGrant.upsert).not.toHaveBeenCalled();
  });

  it('refuses a canonical plan with no active row instead of granting free benefits', async () => {
    const prisma = grantPrismaMock(null);
    const service = new EntitlementService(prisma as never);

    await expect(
      service.grantComplimentary({ ...input, planKey: 'basic' }),
    ).rejects.toMatchObject({
      response: { code: 'MEMBERSHIP_PLAN_NOT_GRANTABLE' },
    });
    expect(prisma.entitlementGrant.upsert).not.toHaveBeenCalled();
  });

  it('refuses an archived plan row', async () => {
    const prisma = grantPrismaMock(
      plan({
        planKey: 'pro',
        archivedAt: new Date('2026-07-01T00:00:00.000Z'),
      }),
    );
    const service = new EntitlementService(prisma as never);

    await expect(service.grantComplimentary(input)).rejects.toMatchObject({
      response: { code: 'MEMBERSHIP_PLAN_NOT_GRANTABLE' },
    });
  });

  it('refuses a plan row that is not active yet', async () => {
    const prisma = grantPrismaMock(
      plan({ planKey: 'pro', status: BillingMembershipPlanStatus.draft }),
    );
    const service = new EntitlementService(prisma as never);

    await expect(service.grantComplimentary(input)).rejects.toMatchObject({
      response: { code: 'MEMBERSHIP_PLAN_NOT_GRANTABLE' },
    });
  });

  it('refuses a workspace-subject plan handed to a user subject', async () => {
    const prisma = grantPrismaMock(
      plan({
        planKey: 'team',
        productType: 'team_membership_plan',
        subjectType: BillingSubjectType.workspace,
      }),
    );
    const service = new EntitlementService(prisma as never);

    await expect(
      service.grantComplimentary({ ...input, planKey: 'team' }),
    ).rejects.toMatchObject({
      response: { code: 'MEMBERSHIP_PLAN_SUBJECT_MISMATCH' },
    });
    expect(prisma.entitlementGrant.upsert).not.toHaveBeenCalled();
  });

  it('validates and stores the normalized plan key', async () => {
    const prisma = grantPrismaMock(plan({ planKey: 'pro' }));
    const service = new EntitlementService(prisma as never);

    await service.grantComplimentary({ ...input, planKey: '  Pro ' });

    expect(prisma.billingMembershipPlan.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { planKey: 'pro' } }),
    );
    const upsertArgs = prisma.entitlementGrant.upsert.mock.calls[0]?.[0];
    expect(upsertArgs?.create.planKey).toBe('pro');
  });
});

describe('EntitlementService.resolveWorkspaceSeatPolicy', () => {
  const WORKSPACE_ID = 'workspace-1';

  function seatPrismaMock(input: {
    type: WorkspaceType;
    grants?: unknown[];
    plans?: unknown[];
  }) {
    return {
      entitlementGrant: {
        findMany: jest.fn().mockResolvedValue(input.grants ?? []),
      },
      billingMembershipPlan: {
        findMany: jest.fn().mockResolvedValue(input.plans ?? []),
      },
      workspace: {
        findUnique: jest.fn().mockResolvedValue({ type: input.type }),
      },
    };
  }

  /** A team plan row: seats live on the plan, so they win over any fallback. */
  function teamPlan(overrides: Record<string, unknown> = {}) {
    return plan({
      planKey: 'team',
      productType: 'team_membership_plan',
      subjectType: BillingSubjectType.workspace,
      includedSeats: 12,
      maxSeats: 12,
      seatOverageAllowed: false,
      ...overrides,
    });
  }

  it('gives a personal workspace with no grant the provisional 5-seat allowance', async () => {
    const prisma = seatPrismaMock({ type: WorkspaceType.personal });
    const service = new EntitlementService(prisma as never);

    await expect(
      service.resolveWorkspaceSeatPolicy(WORKSPACE_ID),
    ).resolves.toEqual(PERSONAL_WORKSPACE_SEAT_POLICY);
  });

  it('keeps a TEAM workspace with no grant owner-only', async () => {
    const prisma = seatPrismaMock({ type: WorkspaceType.team });
    const service = new EntitlementService(prisma as never);

    await expect(
      service.resolveWorkspaceSeatPolicy(WORKSPACE_ID),
    ).resolves.toEqual(DEFAULT_TEAM_SEAT_POLICY);
  });

  it('branches on type for the other fallback too: grants naming no active plan', async () => {
    const grants = [
      grant({
        subjectType: BillingSubjectType.workspace,
        subjectId: WORKSPACE_ID,
        planKey: 'team',
      }),
    ];
    const personal = new EntitlementService(
      seatPrismaMock({ type: WorkspaceType.personal, grants }) as never,
    );
    const team = new EntitlementService(
      seatPrismaMock({ type: WorkspaceType.team, grants }) as never,
    );

    await expect(
      personal.resolveWorkspaceSeatPolicy(WORKSPACE_ID),
    ).resolves.toEqual(PERSONAL_WORKSPACE_SEAT_POLICY);
    await expect(
      team.resolveWorkspaceSeatPolicy(WORKSPACE_ID),
    ).resolves.toEqual(DEFAULT_TEAM_SEAT_POLICY);
  });

  it('lets an active plan row set the seats, without reading the workspace type', async () => {
    const prisma = seatPrismaMock({
      type: WorkspaceType.personal,
      grants: [
        grant({
          subjectType: BillingSubjectType.workspace,
          subjectId: WORKSPACE_ID,
          planKey: 'team',
        }),
      ],
      plans: [teamPlan()],
    });
    const service = new EntitlementService(prisma as never);

    await expect(
      service.resolveWorkspaceSeatPolicy(WORKSPACE_ID),
    ).resolves.toEqual({
      planKey: 'team',
      includedSeats: 12,
      maxSeats: 12,
      seatOverageAllowed: false,
    });
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();
  });
});

describe('EntitlementService quota profile', () => {
  const soldPlans = [
    plan({
      id: 'plan-basic',
      planKey: 'basic',
      rank: 10,
      benefits: benefits({
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
      benefits: benefits({ quotaTier: 'pro' }),
    }),
  ];

  it('suggests the lowest-ranked sold plan above the current one (free → basic)', async () => {
    const prisma = prismaMock({ grants: [], plans: soldPlans });
    const service = new EntitlementService(prisma as never);

    const profile = await service.quotaProfileForUser(user());

    expect(profile.planKey).toBe('free');
    expect(profile.tier).toBe('free');
    expect(profile.limits.chatDaily).toBe(30);
    expect(profile.upgrade).toMatchObject({
      planKey: 'basic',
      tier: 'basic',
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
      tier: 'standard',
    });

    // standard (rank 20) has no higher USER plan sold — team (rank 110) is
    // a workspace product and must never be suggested to a user subject.
    const fromStandard = await service.quotaProfileForUser(user());
    expect(fromStandard.planKey).toBe('standard');
    expect(fromStandard.upgrade).toBeNull();
  });
});
