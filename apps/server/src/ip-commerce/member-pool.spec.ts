import { formatSettlementPeriod } from './member-pool';

describe('formatSettlementPeriod', () => {
  it('formats UTC year-month, zero-padded', () => {
    expect(formatSettlementPeriod(new Date('2026-06-21T12:00:00Z'))).toBe(
      '2026-06',
    );
    expect(formatSettlementPeriod(new Date('2026-01-01T00:00:00Z'))).toBe(
      '2026-01',
    );
    expect(formatSettlementPeriod(new Date('2026-12-31T23:59:59Z'))).toBe(
      '2026-12',
    );
  });

  it('buckets by UTC (not local time) across a month boundary', () => {
    // 2026-07-01T00:30+08:00 === 2026-06-30T16:30Z → still June in UTC.
    expect(formatSettlementPeriod(new Date('2026-07-01T00:30:00+08:00'))).toBe(
      '2026-06',
    );
  });
});
