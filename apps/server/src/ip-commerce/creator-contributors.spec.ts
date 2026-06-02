import { ConflictException } from '@nestjs/common';
import {
  assertEligibleContributorSharesWithinPool,
  assertEligibleContributorsHaveAccount,
} from './ip-commerce.service';

// These mirror the final-state validations enforced inside the creator and
// admin revenue-config write transactions (eligible-requires-userId; eligible
// pool shares must total <= 100%). Pure functions → unit-testable without
// Prisma, in the revenue-split.spec style.

describe('assertEligibleContributorsHaveAccount', () => {
  it('passes when every eligible contributor has a linked account', () => {
    expect(() =>
      assertEligibleContributorsHaveAccount([
        { userId: 'u-1' },
        { userId: 'u-2' },
      ]),
    ).not.toThrow();
  });

  it('passes on an empty eligible set (owner-only fallback)', () => {
    expect(() => assertEligibleContributorsHaveAccount([])).not.toThrow();
  });

  it('rejects an eligible contributor with no linked account', () => {
    try {
      assertEligibleContributorsHaveAccount([
        { userId: 'u-1' },
        { userId: null },
      ]);
      throw new Error('expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        code: 'IP_REVENUE_CONTRIBUTOR_NO_ACCOUNT',
      });
    }
  });
});

describe('assertEligibleContributorSharesWithinPool', () => {
  it('passes when eligible shares total exactly 100%', () => {
    expect(() =>
      assertEligibleContributorSharesWithinPool([
        { revenueShareBps: 6000 },
        { revenueShareBps: 4000 },
      ]),
    ).not.toThrow();
  });

  it('passes when eligible shares total under 100% (remainder to owner)', () => {
    expect(() =>
      assertEligibleContributorSharesWithinPool([
        { revenueShareBps: 2500 },
        { revenueShareBps: null },
      ]),
    ).not.toThrow();
  });

  it('rejects when eligible shares exceed 100%', () => {
    try {
      assertEligibleContributorSharesWithinPool([
        { revenueShareBps: 6000 },
        { revenueShareBps: 5000 },
      ]);
      throw new Error('expected ConflictException');
    } catch (err) {
      expect(err).toBeInstanceOf(ConflictException);
      expect((err as ConflictException).getResponse()).toMatchObject({
        code: 'IP_REVENUE_SHARE_OVERALLOCATED',
      });
    }
  });
});
