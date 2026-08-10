import {
  DEFAULT_TEAM_SEAT_POLICY,
  PERSONAL_WORKSPACE_SEAT_POLICY,
  decideSeatAdmission,
  type SeatPolicy,
} from './seat-policy';

const policy = (overrides: Partial<SeatPolicy> = {}): SeatPolicy => ({
  planKey: 'team',
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

  it('no-plan TEAM default (owner-only): allows the owner, blocks a second member', () => {
    expect(decideSeatAdmission(DEFAULT_TEAM_SEAT_POLICY, 0).kind).toBe('allow');
    expect(decideSeatAdmission(DEFAULT_TEAM_SEAT_POLICY, 1).kind).toBe('block');
  });

  it('no-plan PERSONAL allowance is owner-only for creator seats', () => {
    expect(decideSeatAdmission(PERSONAL_WORKSPACE_SEAT_POLICY, 0).kind).toBe(
      'allow',
    );
    expect(decideSeatAdmission(PERSONAL_WORKSPACE_SEAT_POLICY, 1).kind).toBe(
      'block',
    );
  });

  it('owner alone at a 1-seat cap: no member to remove, so the remedy is seats', () => {
    // The ordinary team block, since creating a team needs no plan: the owner holds
    // the only seat and cannot be removed, so "remove a member" would be advice
    // nobody can act on.
    const result = decideSeatAdmission(DEFAULT_TEAM_SEAT_POLICY, 1);
    if (result.kind !== 'block') throw new Error('expected a block');
    expect(result.reason).toBe(
      'This workspace is limited to 1 creator seat. That seat belongs to the workspace owner, so there is no member to remove — subscribe to a plan with more seats to add a member.',
    );
  });

  it('at the cap with removable members, tells the owner to remove one', () => {
    const result = decideSeatAdmission(policy(), 3);
    if (result.kind !== 'block') throw new Error('expected a block');
    expect(result.reason).toBe(
      'This workspace is limited to 3 creator seats. Remove a member before adding another.',
    );
  });

  it('OVER the cap (lapsed team plan, grandfathered members): removal is not the remedy', () => {
    // The exact shape of the rejected copy: a lapsed team plan caps at 1 while 5
    // grandfathered members keep their seats. Removing one leaves 4 — still over.
    const result = decideSeatAdmission(DEFAULT_TEAM_SEAT_POLICY, 5);
    if (result.kind !== 'block') throw new Error('expected a block');
    expect(result.reason).toBe(
      'This workspace is limited to 1 creator seat. 5 members already hold a seat, so removing one will not free any — restore the plan that granted them to add another member.',
    );
  });

  it('names maxSeats, not the included count, when overage ran out', () => {
    const result = decideSeatAdmission(
      policy({ seatOverageAllowed: true, maxSeats: 5 }),
      5,
    );
    if (result.kind !== 'block') throw new Error('expected a block');
    expect(result.reason).toContain('limited to 5 creator seats');
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
