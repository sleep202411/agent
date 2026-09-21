import {
  BillingMembershipPlanStatus,
  BillingSubjectType,
  EntitlementGrantStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import {
  COMMUNITY_MEMBERSHIP_PLAN_KEY,
  EntitlementService,
} from './entitlement.service';
import { DEFAULT_FREE_BENEFITS } from './membership-benefits';
import {
  DEFAULT_WORKSPACE_SEAT_POLICY,
  decideSeatAdmission,
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
      findMany: jest.fn().mockResolvedValue([]),
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
      $executeRaw: jest.fn().mockResolvedValue(0),
      $queryRaw: jest.fn().mockResolvedValue([]),
      billingMembershipPlan: {
        findUnique: jest.fn().mockResolvedValue(planRow),
      },
      entitlementGrant: {
        findFirst: jest.fn().mockResolvedValue(null),
        findMany: jest.fn().mockResolvedValue([]),
        findUnique: jest.fn().mockResolvedValue(null),
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

  it('rejects an unknown plan key on the plan row, not on the compute rank table', async () => {
    const prisma = grantPrismaMock(null);
    const service = new EntitlementService(prisma as never);

    // The rank table ranks COMPUTE tiers; it is not the list of grantable
    // plans. Gating writes on it rejected community_membership — a real plan
    // with a real row — so billing_membership_plans is the only authority here.
    await expect(
      service.grantComplimentary({ ...input, planKey: 'unknown_plan' }),
    ).rejects.toMatchObject({
      response: { code: 'MEMBERSHIP_PLAN_NOT_GRANTABLE' },
    });
    expect(prisma.entitlementGrant.upsert).not.toHaveBeenCalled();
  });

  it('grants community membership, which the compute rank table does not list', async () => {
    const prisma = grantPrismaMock(
      plan({ planKey: COMMUNITY_MEMBERSHIP_PLAN_KEY }),
    );
    const service = new EntitlementService(prisma as never);

    await expect(
      service.grantComplimentary({
        ...input,
        planKey: COMMUNITY_MEMBERSHIP_PLAN_KEY,
      }),
    ).resolves.toBeDefined();
    expect(prisma.entitlementGrant.upsert).toHaveBeenCalled();
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
  const openSeats = {
    maxSeats: null,
    seatOverageAllowed: true,
    seatOveragePriceId: null,
  };

  function seatPrismaMock(input: {
    defaultForUserId: string | null;
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
        findUnique: jest
          .fn()
          .mockResolvedValue({ defaultForUserId: input.defaultForUserId }),
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

  it('opens seats for a default workspace with no grant', async () => {
    const prisma = seatPrismaMock({ defaultForUserId: 'user-1' });
    const service = new EntitlementService(prisma as never);

    await expect(
      service.resolveWorkspaceSeatPolicy(WORKSPACE_ID),
    ).resolves.toEqual({ ...DEFAULT_WORKSPACE_SEAT_POLICY, ...openSeats });
  });

  it('opens seats for a team workspace with no grant', async () => {
    const prisma = seatPrismaMock({ defaultForUserId: null });
    const service = new EntitlementService(prisma as never);

    await expect(
      service.resolveWorkspaceSeatPolicy(WORKSPACE_ID),
    ).resolves.toEqual({ ...DEFAULT_WORKSPACE_SEAT_POLICY, ...openSeats });
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
      seatPrismaMock({ defaultForUserId: 'user-1', grants }) as never,
    );
    const team = new EntitlementService(
      seatPrismaMock({ defaultForUserId: null, grants }) as never,
    );

    await expect(
      personal.resolveWorkspaceSeatPolicy(WORKSPACE_ID),
    ).resolves.toEqual({ ...DEFAULT_WORKSPACE_SEAT_POLICY, ...openSeats });
    await expect(
      team.resolveWorkspaceSeatPolicy(WORKSPACE_ID),
    ).resolves.toEqual({ ...DEFAULT_WORKSPACE_SEAT_POLICY, ...openSeats });
  });

  it('preserves paid included seats while allowing unlimited free overage', async () => {
    const prisma = seatPrismaMock({
      defaultForUserId: 'user-1',
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
      ...openSeats,
    });
    expect(prisma.workspace.findUnique).not.toHaveBeenCalled();

    const resolved = await service.resolveWorkspaceSeatPolicy(WORKSPACE_ID);
    expect(decideSeatAdmission(resolved, 100_000)).toEqual({ kind: 'allow' });
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

describe('Membership plan cache recovery', () => {
  type Row = ReturnType<typeof plan>;
  type Cache = { byKey: Map<string, Row> };
  type Probe = {
    loadPlanCache(): Promise<Cache>;
    planBenefits(row: Row): ReturnType<typeof benefits>;
  };
  const deferred = <T>() => {
    let resolve!: (value: T) => void;
    let reject!: (reason: Error) => void;
    const promise = new Promise<T>((yes, no) => {
      resolve = yes;
      reject = no;
    });
    return { promise, resolve, reject };
  };
  const setup = () => {
    const read = jest.fn<Promise<Row[]>, []>();
    const service = new EntitlementService({
      billingMembershipPlan: { findMany: read },
    } as never);
    return { read, service, probe: service as unknown as Probe };
  };
  it('coalesces concurrent cache misses', async () => {
    const { read, probe } = setup();
    const pending = deferred<Row[]>();
    read.mockReturnValueOnce(pending.promise);
    const first = probe.loadPlanCache();
    const second = probe.loadPlanCache();
    expect(read).toHaveBeenCalledTimes(1);
    const row = plan();
    pending.resolve([row]);
    expect(await first).toBe(await second);
  });
  it.each(['success', 'failure'])(
    'ignores invalidated delayed %s and preserves the replacement cache',
    async (outcome) => {
      const { read, service, probe } = setup();
      const pending = deferred<Row[]>();
      const replacement = plan({ rank: 22 });
      read
        .mockReturnValueOnce(pending.promise)
        .mockResolvedValueOnce([replacement]);
      const old = probe.loadPlanCache();
      service.invalidatePlanCache();
      const latest = await probe.loadPlanCache();
      if (outcome === 'success') pending.resolve([plan({ rank: 1 })]);
      else pending.reject(new Error('abandoned read'));
      expect(await old).toBe(latest);
      expect((await probe.loadPlanCache()).byKey.get('basic')).toBe(
        replacement,
      );
      expect(read).toHaveBeenCalledTimes(2);
    },
  );
  it('releases a failed current cache read for explicit retry', async () => {
    const { read, probe } = setup();
    read
      .mockRejectedValueOnce(new Error('database unavailable'))
      .mockResolvedValueOnce([plan()]);
    await expect(probe.loadPlanCache()).rejects.toThrow('database unavailable');
    expect((await probe.loadPlanCache()).byKey.size).toBe(1);
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('keeps derived benefits attached to the exact cached plan row', async () => {
    const { read, service, probe } = setup();
    const old = plan({ benefits: benefits({ concurrentJobs: 2 }) });
    const current = plan({ benefits: benefits({ concurrentJobs: 11 }) });
    read.mockResolvedValueOnce([old]).mockResolvedValueOnce([current]);
    await probe.loadPlanCache();
    expect(probe.planBenefits(old).concurrentJobs).toBe(2);
    service.invalidatePlanCache();
    await probe.loadPlanCache();
    expect(probe.planBenefits(old).concurrentJobs).toBe(2);
    expect(probe.planBenefits(current).concurrentJobs).toBe(11);
    expect(probe.planBenefits(old).concurrentJobs).toBe(2);
    expect(probe.planBenefits(current).concurrentJobs).toBe(11);
  });
});

describe('entitlement selection across overlapping records', () => {
  it('keeps an older high-rank grant when five lower-rank grants are newer', async () => {
    const prisma = prismaMock({
      plans: [plan(), plan({ planKey: 'pro', rank: 30 })],
    });
    const rows = [
      ...Array.from({ length: 5 }, (_, index) =>
        grant({ id: `basic-${index}` }),
      ),
      grant({
        id: 'older-pro',
        planKey: 'pro',
        startsAt: new Date('2026-05-01T00:00:00Z'),
      }),
    ];
    prisma.entitlementGrant.findMany
      .mockReset()
      .mockImplementation((query: { take?: number }) =>
        Promise.resolve(rows.slice(0, query.take)),
      );
    const snapshot = await new EntitlementService(
      prisma as never,
    ).resolveForUser(user(), { now: NOW });
    expect(snapshot.planKey).toBe('pro');
  });

  it('selects the higher-rank grace subscription even when the lower plan expires later', async () => {
    const prisma = prismaMock({
      plans: [plan(), plan({ planKey: 'pro', rank: 30 })],
    });
    const rows = [
      {
        subjectType: BillingSubjectType.user,
        subjectId: 'user-1',
        planKey: 'basic',
        currentPeriodEnd: new Date('2026-08-01T00:00:00Z'),
      },
      {
        subjectType: BillingSubjectType.user,
        subjectId: 'user-1',
        planKey: 'pro',
        currentPeriodEnd: new Date('2026-07-01T00:00:00Z'),
      },
    ];
    prisma.billingSubscription.findFirst.mockResolvedValue(rows[0] as never);
    Object.assign(prisma.billingSubscription, {
      findMany: jest.fn().mockResolvedValue(rows),
    });
    const snapshot = await new EntitlementService(
      prisma as never,
    ).resolveForUser(user(), { now: NOW, workspaceId: 'workspace-1' });
    expect(snapshot.planKey).toBe('pro');
    expect(snapshot.subject.id).toBe('user-1');
    expect(snapshot.source).toBe('subscription_grace');
  });
});
