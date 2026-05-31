import { ConflictException } from '@nestjs/common';
import {
  assertIpPurchaserAllowed,
  isEntitlementActiveForAccess,
  resolveIpEntitlementWindow,
} from './ip-commerce.service';

describe('IP commerce purchase guards', () => {
  it('rejects creator self-purchases', () => {
    expect(() =>
      assertIpPurchaserAllowed({
        buyerUserId: 'creator-1',
        creatorUserId: 'creator-1',
      }),
    ).toThrow(ConflictException);
  });

  it('allows purchases by a different user', () => {
    expect(() =>
      assertIpPurchaserAllowed({
        buyerUserId: 'viewer-1',
        creatorUserId: 'creator-1',
      }),
    ).not.toThrow();
  });
});

describe('IP commerce entitlement windows', () => {
  const now = new Date('2026-05-31T12:00:00.000Z');

  it('starts access immediately when no future unlock is configured', () => {
    expect(resolveIpEntitlementWindow({ unlocksAt: null }, now)).toEqual({
      startsAt: now,
      endsAt: null,
    });
  });

  it('starts access at the future unlock time for presales', () => {
    const unlocksAt = new Date('2026-06-01T12:00:00.000Z');

    expect(resolveIpEntitlementWindow({ unlocksAt }, now)).toEqual({
      startsAt: unlocksAt,
      endsAt: null,
    });
  });

  it('does not grant watch access before a future start time', () => {
    expect(
      isEntitlementActiveForAccess(
        { startsAt: new Date('2026-06-01T12:00:00.000Z'), endsAt: null },
        now,
      ),
    ).toBe(false);
  });

  it('grants watch access during the entitlement window', () => {
    expect(
      isEntitlementActiveForAccess(
        {
          startsAt: new Date('2026-05-30T12:00:00.000Z'),
          endsAt: new Date('2026-06-01T12:00:00.000Z'),
        },
        now,
      ),
    ).toBe(true);
  });

  it('does not grant watch access after the entitlement has expired', () => {
    expect(
      isEntitlementActiveForAccess(
        {
          startsAt: new Date('2026-05-30T12:00:00.000Z'),
          endsAt: new Date('2026-05-31T11:59:59.000Z'),
        },
        now,
      ),
    ).toBe(false);
  });
});
