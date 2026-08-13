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

  /**
   * A free team is usable. This used to be owner-only, which made every team a
   * dead end — the wall only showed up when an invitee clicked accept.
   */
  it('no-plan TEAM default: a free team seats a real team', () => {
    expect(decideSeatAdmission(DEFAULT_TEAM_SEAT_POLICY, 1).kind).toBe('allow');
    expect(decideSeatAdmission(DEFAULT_TEAM_SEAT_POLICY, 27).kind).toBe(
      'allow',
    );
    expect(decideSeatAdmission(DEFAULT_TEAM_SEAT_POLICY, 28).kind).toBe(
      'block',
    );
  });

  /**
   * Free and paid teams carry the same seat count on purpose: the team plan
   * sells capacity (unlimited dailies, 28 concurrent jobs, 50 GB), not the right
   * to have colleagues. If these ever diverge it should be a pricing decision,
   * not a drift.
   */
  it('free team seats match the paid team plan', () => {
    expect(DEFAULT_TEAM_SEAT_POLICY.includedSeats).toBe(28);
    expect(DEFAULT_TEAM_SEAT_POLICY.maxSeats).toBe(28);
    expect(DEFAULT_TEAM_SEAT_POLICY.seatOverageAllowed).toBe(false);
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
    // Now reached by a PERSONAL workspace, which stays owner-only: the owner holds
    // the only seat and cannot be removed, so "remove a member" would be advice
    // nobody can act on.
    const result = decideSeatAdmission(PERSONAL_WORKSPACE_SEAT_POLICY, 1);
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

  it('OVER the cap (grandfathered members): removal is not the remedy', () => {
    // Live on .com: a personal workspace holding 2 creators against a 1-seat cap,
    // from a period when the guard was looser. Enforcement is add-time only, so
    // they keep their seats; removing one still leaves the workspace at the cap.
    const result = decideSeatAdmission(PERSONAL_WORKSPACE_SEAT_POLICY, 2);
    if (result.kind !== 'block') throw new Error('expected a block');
    expect(result.reason).toBe(
      'This workspace is limited to 1 creator seat. 2 members already hold a seat, so removing one will not free any — restore the plan that granted them to add another member.',
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
