import { assertNewCrewCurrency, formatLedgerAmount } from './ledger-currency';
import {
  CreateCrewEarningSchema,
  ListCrewEarningsQuerySchema,
} from './earnings.dto';
import {
  CreateCrewPayoutSchema,
  ListCrewPayoutsQuerySchema,
} from './payouts.dto';
import { UpdateCrewTaskSchema } from '../dto';

describe('Crew monetary boundary', () => {
  it('rejects historical points and cross-region currency for new earnings', () => {
    expect(() => assertNewCrewCurrency('POINTS')).toThrow();
    expect(() => assertNewCrewCurrency('CNY')).not.toThrow();
    expect(() => assertNewCrewCurrency('USD')).not.toThrow();
  });
  it('formats maximum bigint money without floating-point loss', () => {
    expect(formatLedgerAmount(9223372036854775807n, 'CNY')).toBe(
      'CNY 92233720368547758.07',
    );
    expect(formatLedgerAmount(-1n, 'USD')).toBe('USD -0.01');
  });
  it('rejects fractional minor units, overflow and missing currency', () => {
    const valid = {
      crewMemberId: 'member',
      sourceType: 'adjustment',
      title: 'Pay',
      amountMinor: '125',
      currency: 'USD',
      idempotencyKey: 'unique-key',
    };
    expect(CreateCrewEarningSchema.safeParse(valid).success).toBe(true);
    for (const amountMinor of ['1.5', '9223372036854775808', '-1']) {
      expect(
        CreateCrewEarningSchema.safeParse({ ...valid, amountMinor }).success,
      ).toBe(false);
    }
    expect(
      CreateCrewEarningSchema.safeParse({ ...valid, currency: undefined })
        .success,
    ).toBe(false);
  });
});

describe('Required money currency', () => {
  it.each([undefined, 'POINTS', 'EUR'])(
    'rejects %s in financial requests',
    (currency) => {
      expect(ListCrewEarningsQuerySchema.safeParse({ currency }).success).toBe(
        false,
      );
      expect(ListCrewPayoutsQuerySchema.safeParse({ currency }).success).toBe(
        false,
      );
      expect(
        CreateCrewPayoutSchema.safeParse({
          crewMemberId: 'member',
          currency,
          amountMinor: '1000',
          idempotencyKey: 'test-key',
        }).success,
      ).toBe(false);
      expect(
        UpdateCrewTaskSchema.safeParse({
          expectedVersion: 1,
          assignees: [{ userId: 'member', currency, rewardAmountMinor: 1000 }],
        }).success,
      ).toBe(false);
    },
  );
  it('accepts explicitly denominated rewards, including an empty reward', () => {
    for (const rewardAmountMinor of [null, 1000]) {
      expect(
        UpdateCrewTaskSchema.safeParse({
          expectedVersion: 1,
          assignees: [{ userId: 'member', currency: 'USD', rewardAmountMinor }],
        }).success,
      ).toBe(true);
    }
  });
});
