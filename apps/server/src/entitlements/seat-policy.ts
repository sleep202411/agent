/**
 * Team seat policy + the seat-admission decision.
 *
 * Pure + decoupled: the resolver (EntitlementService.resolveWorkspaceSeatPolicy)
 * produces a SeatPolicy from a workspace's active team plan; the enforcement
 * points (member add / invite accept) call `decideSeatAdmission` and act on the
 * result. This is a *decision*, not a hardcoded block, so the future
 * pay-per-extra-seat model is a localized change (the `requires_purchase` branch
 * + a billing hook) — no rewrite of the enforcement.
 */

export interface SeatPolicy {
  /** The plan the policy came from (or `free` for the default). */
  planKey: string;
  /** Seats included in the plan (owner counts as a seat). */
  includedSeats: number;
  /** Hard cap including overage; `null` = no cap once overage is allowed. */
  maxSeats: number | null;
  /** Whether members beyond `includedSeats` are permitted at all. */
  seatOverageAllowed: boolean;
  /**
   * FUTURE: when set, an extra seat is a billable add-on at this price — the
   * seam for the pay-per-seat model. Unset today, so overage (if allowed) is free.
   */
  seatOveragePriceId?: string | null;
}

export type SeatAdmission =
  | { kind: 'allow' }
  | { kind: 'block'; reason: string; policy: SeatPolicy; activeSeats: number }
  // FUTURE pay-per-seat: caller routes to a one-seat checkout for `seatPriceId`.
  | {
      kind: 'requires_purchase';
      seatPriceId: string;
      policy: SeatPolicy;
      activeSeats: number;
    };

/**
 * Default for a team workspace with NO active team plan: a small free allowance
 * (3 seats including the owner), after which inviting more members requires a
 * paid team plan. This is the monetization gate — the single product knob for
 * the free-team seat allowance. Set to 1 for an owner-only strict gate, or
 * higher for a gentler funnel.
 */
export const DEFAULT_TEAM_SEAT_POLICY: SeatPolicy = {
  planKey: 'free',
  includedSeats: 3,
  maxSeats: 3,
  seatOverageAllowed: false,
};

/**
 * Decide whether ONE more active member may occupy a seat, given the count of
 * members already occupying one (active, not removed — the owner included).
 */
export function decideSeatAdmission(
  policy: SeatPolicy,
  activeSeats: number,
): SeatAdmission {
  if (activeSeats < policy.includedSeats) return { kind: 'allow' };

  if (policy.seatOverageAllowed) {
    const underMax = policy.maxSeats == null || activeSeats < policy.maxSeats;
    if (underMax) {
      if (policy.seatOveragePriceId) {
        return {
          kind: 'requires_purchase',
          seatPriceId: policy.seatOveragePriceId,
          policy,
          activeSeats,
        };
      }
      return { kind: 'allow' }; // overage allowed, no price configured → free
    }
  }

  const seatWord = policy.includedSeats === 1 ? 'seat' : 'seats';
  return {
    kind: 'block',
    reason: `This team's plan includes ${policy.includedSeats} ${seatWord}. Upgrade the team plan to add more members.`,
    policy,
    activeSeats,
  };
}
