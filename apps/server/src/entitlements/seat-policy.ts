/**
 * Workspace seat policy + the seat-admission decision.
 *
 * Pure + decoupled: the resolver (EntitlementService.resolveWorkspaceSeatPolicy)
 * produces a SeatPolicy from a workspace's active plan, or from the no-plan
 * fallback for its type; the enforcement points (member add / invite accept)
 * call `decideSeatAdmission` and act on the result. This is a *decision*, not a
 * hardcoded block, so the future pay-per-extra-seat model is a localized change
 * (the `requires_purchase` branch + a billing hook) — no rewrite of the
 * enforcement.
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
 * Default for a TEAM workspace with NO active team plan: owner-only.
 *
 * Creating a team is ungated — `POST /workspaces/team` checks no entitlement, the
 * switcher offers it to every signed-in user, and the subscription dialog creates
 * the team BEFORE checkout, so an abandoned payment leaves one behind. A team that
 * never had a plan is therefore the ordinary case here, not a lapsed one.
 *
 * Either way the owner keeps their seat and needs seats to add anyone. Members
 * granted by a plan that later lapsed are grandfathered, because enforcement is
 * add-time only.
 */
export const DEFAULT_TEAM_SEAT_POLICY: SeatPolicy = {
  planKey: 'free',
  includedSeats: 1,
  maxSeats: 1,
  seatOverageAllowed: false,
};

/**
 * Default for a PERSONAL workspace with NO active plan — which is every personal
 * workspace, since plans are sold against teams. 5 is a PROVISIONAL allowance,
 * chosen so collaboration works on the workspaces people actually have rather
 * than only on a team they'd have to create first. It is not a priced tier and
 * not final policy: aligning seats with each plan's `included_seats` is
 * deliberately deferred by product decision.
 */
export const PERSONAL_WORKSPACE_SEAT_POLICY: SeatPolicy = {
  planKey: 'free',
  includedSeats: 5,
  maxSeats: 5,
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

  // The cap being hit is `maxSeats` on an overage policy (a null one is allowed
  // above and never reaches here) and `includedSeats` otherwise.
  const cap =
    policy.seatOverageAllowed && policy.maxSeats != null
      ? policy.maxSeats
      : policy.includedSeats;
  const seatWord = cap === 1 ? 'seat' : 'seats';
  // Which remedy is true turns on whether removing a member could actually free a
  // seat, not on the workspace type — `planKey` cannot tell the two no-plan
  // defaults apart, both being 'free'.
  //
  // Over the cap: enforcement is add-time only, so a lapsed or downgraded plan
  // leaves members grandfathered above it. Removing one lands the workspace at the
  // cap at best, which is still full, so the seats have to come back.
  // At a cap of one: the sole holder is the owner, and an owner cannot be removed.
  // At a higher cap: removal genuinely frees a seat.
  let remedy: string;
  if (activeSeats > cap) {
    remedy = `${activeSeats} members already hold a seat, so removing one will not free any — restore the plan that granted them to add another member.`;
  } else if (activeSeats === 1) {
    remedy =
      'That seat belongs to the workspace owner, so there is no member to remove — subscribe to a plan with more seats to add a member.';
  } else {
    remedy = 'Remove a member before adding another.';
  }
  return {
    kind: 'block',
    reason: `This workspace is limited to ${cap} ${seatWord}. ${remedy}`,
    policy,
    activeSeats,
  };
}
