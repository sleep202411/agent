import { BillingService } from './billing.service';
import { DEFAULT_FREE_BENEFITS } from '../entitlements/membership-benefits';

const PLAN_ID = '019f7243-20c1-7054-a6fa-0a33da6efe11';

function planRow(overrides: Record<string, unknown> = {}) {
  return {
    id: PLAN_ID,
    planKey: 'basic',
    name: 'Basic',
    status: 'active',
    benefits: { ...DEFAULT_FREE_BENEFITS },
    updatedAt: new Date('2026-07-19T00:00:00.000Z'),
    ...overrides,
  };
}

describe('BillingService membership plan benefits admin', () => {
  let prisma: {
    billingMembershipPlan: {
      findUnique: jest.Mock;
      update: jest.Mock;
    };
  };
  let entitlements: { invalidatePlanCache: jest.Mock };
  let service: BillingService;

  beforeEach(() => {
    prisma = {
      billingMembershipPlan: {
        findUnique: jest.fn().mockResolvedValue(planRow()),
        update: jest
          .fn()
          .mockImplementation((args: { data: { benefits: unknown } }) =>
            Promise.resolve(planRow({ benefits: args.data.benefits })),
          ),
      },
    };
    entitlements = { invalidatePlanCache: jest.fn() };
    service = new BillingService(
      prisma as never,
      undefined as never,
      undefined as never,
      undefined as never,
      undefined as never,
      entitlements as never,
      undefined as never,
      undefined as never,
      undefined as never,
    );
  });

  it('returns stored benefits with no issues for a valid row', async () => {
    const result = await service.getAdminMembershipPlanBenefits(PLAN_ID);
    expect(result).toMatchObject({
      planKey: 'basic',
      benefits: DEFAULT_FREE_BENEFITS,
      issues: null,
    });
  });

  it('surfaces validation issues for an invalid stored row instead of hiding it', async () => {
    prisma.billingMembershipPlan.findUnique.mockResolvedValue(
      planRow({ benefits: { chatDaily: 'lots' } }),
    );
    const result = await service.getAdminMembershipPlanBenefits(PLAN_ID);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.stringContaining('chatDaily')]),
    );
  });

  it('404s on an unknown plan', async () => {
    prisma.billingMembershipPlan.findUnique.mockResolvedValue(null);
    await expect(
      service.getAdminMembershipPlanBenefits(PLAN_ID),
    ).rejects.toMatchObject({
      response: { code: 'BILLING_MEMBERSHIP_PLAN_NOT_FOUND' },
    });
  });

  it('writes benefits, stamps the admin, and busts the entitlement plan cache', async () => {
    const next = {
      ...DEFAULT_FREE_BENEFITS,
      quotaTier: 'VIP1' as const,
      chatDaily: 250,
    };
    const result = await service.updateAdminMembershipPlanBenefits(
      PLAN_ID,
      'admin-1',
      next,
    );
    expect(prisma.billingMembershipPlan.update).toHaveBeenCalledWith({
      where: { id: PLAN_ID },
      data: { benefits: next, updatedById: 'admin-1' },
    });
    expect(entitlements.invalidatePlanCache).toHaveBeenCalledTimes(1);
    expect(result.benefits).toEqual(next);
  });
});
