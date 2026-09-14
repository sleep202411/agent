import {
  BillingProductType,
  BillingSubjectType,
  PaymentProvider,
} from '@prisma/client';
import { BillingService } from './billing.service';

const USER = { userId: 'user-1' };
const CHECKOUT = {
  priceId: '00000000-0000-4000-8000-000000000001',
  idempotencyKey: 'membership-checkout-1',
  quantity: 1,
  successUrl: 'https://studio.fizzdragon.com/en-US?payment=success',
  backUrl: 'https://studio.fizzdragon.com/en-US?payment=cancelled',
};

function membershipPrice() {
  return {
    id: CHECKOUT.priceId,
    amountMinor: 2700n,
    subjectType: BillingSubjectType.user,
    itemId: 'item-1',
    item: {
      id: 'item-1',
      productType: BillingProductType.membership_plan,
      name: 'Basic',
    },
    providerBindings: [],
  };
}

function serviceWith(prisma: Record<string, unknown>) {
  return new BillingService(
    prisma as never,
    {
      defaultProviderForRuntime: () => PaymentProvider.airwallex,
    } as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never,
  );
}

describe('compute membership checkout invariants', () => {
  it('rejects membership quantities above one before creating an order', async () => {
    const prisma = {
      billingOrder: { findUnique: jest.fn().mockResolvedValue(null) },
      billingPrice: {
        findFirst: jest.fn().mockResolvedValue(membershipPrice()),
      },
    };
    const service = serviceWith(prisma);

    await expect(
      service.createCheckout(USER, { ...CHECKOUT, quantity: 2 }),
    ).rejects.toMatchObject({
      response: { code: 'BILLING_MEMBERSHIP_QUANTITY_INVALID' },
    });
    expect(prisma.billingOrder.findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects another checkout while the same subject has a live membership', async () => {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(0),
      billingSubscription: {
        findFirst: jest.fn().mockResolvedValue({ id: 'subscription-1' }),
      },
      entitlementGrant: { findFirst: jest.fn().mockResolvedValue(null) },
      billingOrder: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const prisma = {
      billingOrder: { findUnique: jest.fn().mockResolvedValue(null) },
      billingPrice: {
        findFirst: jest.fn().mockResolvedValue(membershipPrice()),
      },
      $transaction: jest.fn((callback: (client: typeof tx) => unknown) =>
        callback(tx),
      ),
    };
    const service = serviceWith(prisma);

    await expect(service.createCheckout(USER, CHECKOUT)).rejects.toMatchObject({
      response: { code: 'BILLING_MEMBERSHIP_ALREADY_ACTIVE' },
    });
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe('current entitlement subscription binding', () => {
  it('looks up only the subscription matching the winning plan and subject', async () => {
    const entitlement = {
      subject: { type: 'workspace', id: 'workspace-1' },
      planKey: 'team',
      rank: 40,
      source: 'workspace_subscription',
      status: 'active',
      limits: {},
    };
    const prisma = {
      billingSubscription: { findFirst: jest.fn().mockResolvedValue(null) },
    };
    const permissions = {
      requireWorkspacePresence: jest
        .fn()
        .mockResolvedValue({ role: 'billing' }),
    };
    const service = new BillingService(
      prisma as never,
      {} as never,
      permissions as never,
      {} as never,
      {} as never,
      { resolveForUser: jest.fn().mockResolvedValue(entitlement) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.getMyEntitlement(USER, 'workspace-1'),
    ).resolves.toEqual({ entitlement, subscription: null });
    expect(permissions.requireWorkspacePresence).toHaveBeenCalledWith(
      USER.userId,
      'workspace-1',
    );
    expect(prisma.billingSubscription.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          subjectType: BillingSubjectType.workspace,
          subjectId: 'workspace-1',
          planKey: 'team',
        }) as unknown,
      }),
    );
  });

  it('does not expose a team subscription to project-only viewers', async () => {
    const entitlement = {
      subject: { type: 'workspace', id: 'workspace-1' },
      planKey: 'team',
      rank: 40,
      source: 'workspace_subscription',
      status: 'active',
      limits: {},
    };
    const prisma = {
      billingSubscription: { findFirst: jest.fn() },
    };
    const service = new BillingService(
      prisma as never,
      {} as never,
      {
        requireWorkspacePresence: jest
          .fn()
          .mockResolvedValue({ role: 'viewer', accessScope: 'project_only' }),
      } as never,
      {} as never,
      {} as never,
      { resolveForUser: jest.fn().mockResolvedValue(entitlement) } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(
      service.getMyEntitlement(USER, 'workspace-1'),
    ).resolves.toEqual({ entitlement, subscription: null });
    expect(prisma.billingSubscription.findFirst).not.toHaveBeenCalled();
  });
});
