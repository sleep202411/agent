import {
  DEFAULT_TEAM_SEAT_POLICY,
  decideSeatAdmission,
  type SeatPolicy,
} from './seat-policy';

const policy = (overrides: Partial<SeatPolicy> = {}): SeatPolicy => ({
  planKey: 'team_creator',
  includedSeats: 3,
  maxSeats: 3,
  seatOverageAllowed: false,
  ...overrides,
});

describe('decideSeatAdmission', () => {
  it('allows while under the included seat count', () => {
    // 2 active (owner + 1) on a 3-seat plan → the 3rd fits.
    expect(decideSeatAdmission(policy(), 2).kind).toBe('allow');
  });

  it('blocks at the included seat count when overage is not allowed', () => {
    const result = decideSeatAdmission(policy(), 3);
    expect(result.kind).toBe('block');
    if (result.kind === 'block') {
      expect(result.activeSeats).toBe(3);
      expect(result.policy.includedSeats).toBe(3);
    }
  });

  it('no-plan default (owner-only): allows the owner, blocks a second member', () => {
    expect(decideSeatAdmission(DEFAULT_TEAM_SEAT_POLICY, 0).kind).toBe('allow');
    expect(decideSeatAdmission(DEFAULT_TEAM_SEAT_POLICY, 1).kind).toBe('block');
  });

  it('allows free overage when seatOverageAllowed and no price is set', () => {
    expect(
      decideSeatAdmission(
        policy({ seatOverageAllowed: true, maxSeats: null }),
        5,
      ).kind,
    ).toBe('allow');
  });

  it('still blocks once maxSeats is reached even with overage allowed', () => {
    expect(
      decideSeatAdmission(policy({ seatOverageAllowed: true, maxSeats: 5 }), 5)
        .kind,
    ).toBe('block');
  });

  it('FUTURE pay-per-seat: requires_purchase when an overage price is configured', () => {
    const result = decideSeatAdmission(
      policy({
        seatOverageAllowed: true,
        maxSeats: null,
        seatOveragePriceId: 'price_seat_1',
      }),
      4,
    );
    expect(result.kind).toBe('requires_purchase');
    if (result.kind === 'requires_purchase') {
      expect(result.seatPriceId).toBe('price_seat_1');
    }
  });
});
