import {
  BillingMembershipPlanStatus,
  BillingSubjectType,
  EntitlementGrantStatus,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { EntitlementService } from './entitlement.service';

const NOW = '2026-06-12T12:00:00.000Z';

function user(overrides: Partial<AuthUser> = {}): AuthUser {
  return { userId: 'user-1', userLevel: 'FREE', ...overrides };
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

function plan(overrides: Record<string, unknown> = {}) {
  return {
    id: 'plan-1',
    planKey: 'studio',
    subjectType: BillingSubjectType.user,
    rank: 40,
    status: BillingMembershipPlanStatus.active,
    archivedAt: null,
    featureFlags: {},
    limits: {
      queuePriority: 2,
      concurrentJobs: 7,
      queuedJobs: 21,
    },
    ...overrides,
  };
}

describe('EntitlementService queue limits', () => {
  it('hydrates membership queue/concurrency limits into the snapshot', async () => {
    const prisma = {
      entitlementGrant: {
        findMany: jest.fn().mockResolvedValueOnce([grant()]),
      },
      billingMembershipPlan: {
        findMany: jest.fn().mockResolvedValueOnce([plan()]),
      },
    };
    const service = new EntitlementService(prisma as never);

    const snapshot = await service.resolveForUser(user(), { now: NOW });

    expect(snapshot.subject).toEqual({ type: 'user', id: 'user-1' });
    expect(snapshot.planKey).toBe('studio');
    expect(snapshot.limits.queuePriority).toBe(2);
    expect(snapshot.limits.concurrentJobs).toBe(7);
    expect(snapshot.limits.queuedJobs).toBe(21);
  });

  it('keeps workspace team limits scoped to the workspace subject', async () => {
    const prisma = {
      entitlementGrant: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([
            grant({
              subjectType: BillingSubjectType.workspace,
              subjectId: 'workspace-1',
              planKey: 'team',
            }),
          ])
          .mockResolvedValueOnce([]),
      },
      billingMembershipPlan: {
        findMany: jest.fn().mockResolvedValueOnce([
          plan({
            planKey: 'team',
            subjectType: BillingSubjectType.workspace,
            rank: 120,
            featureFlags: { sharedCredits: true },
            limits: {
              queuePriority: 2,
              concurrentJobs: 16,
              queuedJobs: 64,
            },
          }),
        ]),
      },
    };
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
    const prisma = {
      entitlementGrant: {
        findMany: jest.fn().mockResolvedValueOnce([
          grant({
            planKey: 'enterprise',
          }),
        ]),
      },
      billingMembershipPlan: {
        findMany: jest.fn().mockResolvedValueOnce([
          plan({
            planKey: 'enterprise',
            rank: 90,
            limits: {
              queuePriority: 1,
              concurrentJobs: null,
              queuedJobs: null,
            },
          }),
        ]),
      },
    };
    const service = new EntitlementService(prisma as never);

    const snapshot = await service.resolveForUser(user(), { now: NOW });

    expect(snapshot.limits.queuePriority).toBe(1);
    expect(snapshot.limits.concurrentJobs).toBeNull();
    expect(snapshot.limits.queuedJobs).toBeNull();
  });
});
