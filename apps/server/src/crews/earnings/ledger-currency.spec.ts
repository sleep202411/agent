import { assertNewCrewCurrency, formatLedgerAmount } from './ledger-currency';
import { CreateCrewEarningSchema } from './earnings.dto';

describe('Crew monetary boundary', () => {
  it('rejects historical points and cross-region currency for new earnings', () => {
    expect(() => assertNewCrewCurrency('POINTS')).toThrow();
    expect(() => assertNewCrewCurrency('CNY')).toThrow();
    expect(() => assertNewCrewCurrency(undefined)).toThrow();
    expect(() => assertNewCrewCurrency('USD')).not.toThrow();
  });
  it('formats maximum bigint money without floating-point loss', () => {
    expect(formatLedgerAmount(9223372036854775807n, 'CNY')).toBe(
      'CNY 92233720368547758.07',
    );
    expect(formatLedgerAmount(100n, 'POINTS')).toBe('100 points');
    expect(formatLedgerAmount(-1n, 'USD')).toBe('USD -0.01');
  });
  it('rejects fractional minor units, overflow and missing currency', () => {
    const valid = {
      crewMemberId: 'member',
      sourceType: 'adjustment',
      title: 'Pay',
      pointsAmount: '125',
      currency: 'USD',
      idempotencyKey: 'unique-key',
    };
    expect(CreateCrewEarningSchema.safeParse(valid).success).toBe(true);
    for (const pointsAmount of ['1.5', '9223372036854775808', '-1']) {
      expect(
        CreateCrewEarningSchema.safeParse({ ...valid, pointsAmount }).success,
      ).toBe(false);
    }
    expect(
      CreateCrewEarningSchema.safeParse({ ...valid, currency: undefined })
        .success,
    ).toBe(false);
  });
});
