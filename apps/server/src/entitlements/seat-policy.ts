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
  /** Unique creator seats included in the plan (owner counts as one). */
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
 * Default for a TEAM workspace with NO active team plan.
 *
 * Creating a team is ungated — `POST /workspaces/team` checks no entitlement, the
 * switcher offers it to every signed-in user, and the subscription dialog creates
 * the team BEFORE checkout (it has to: a team entitlement's subject IS the
 * workspace, so the workspace must exist before the grant can attach). A team
 * that never had a plan is therefore the ordinary case here, not a lapsed one.
 *
 * That default used to be owner-only, which made every free team a dead end: you
 * could create one, invite someone, and only when THEY clicked accept did anyone
 * learn the team could not hold a second creator. All 10 teams on .com sat at one
 * member with zero workspace-subject grants between them — the feature had never
 * once worked. Seats are now free up to the same 28 the paid plan carries, so a
 * team is usable the moment it exists.
 *
 * What the team plan sells is therefore capacity, not colleagues: unlimited daily
 * chat/image/video/workflow, 28 concurrent jobs, 50 GB of upload. That split holds
 * because compute is metered separately — `resolvePayerTx` charges every job to
 * the workspace's own point wallet, so an extra collaborator costs us no AI spend.
 *
 * Members granted by a plan that later lapsed are grandfathered, because
 * enforcement is add-time only.
 */
export const DEFAULT_TEAM_SEAT_POLICY: SeatPolicy = {
  planKey: 'free',
  includedSeats: 28,
  maxSeats: 28,
  seatOverageAllowed: false,
};

/**
 * A free personal workspace has one creator seat (its owner). It may still have
 * any number of project viewers/reviewers because those roles do not consume a
 * creator seat.
 */
export const PERSONAL_WORKSPACE_SEAT_POLICY: SeatPolicy = {
  planKey: 'free',
  includedSeats: 1,
  maxSeats: 1,
  seatOverageAllowed: false,
};

/**
 * Personal workspaces that existed before team workspaces became usable are
 * grandfathered onto the team allowance.
 *
 * Until 2026-08-11 a free team was owner-only, so "create a team and collaborate
 * there" was advice nobody could act on — every collaborative project on .com
 * ended up inside somebody's personal workspace. The 虎豹花园 series is the shape
 * of it: seven projects spread across four separate personal workspaces, none of
 * which can admit a second creator, and the owners only find out when an invitee
 * clicks accept.
 *
 * Punishing that history would be punishing users for our own gap, so anything
 * created before the cutoff keeps collaborating. New personal workspaces stay
 * owner-only, which is what makes a team workspace worth creating — the boundary
 * holds going forward, it just isn't applied retroactively.
 *
 * This is deliberately a fixed instant, not a rolling window: the exemption must
 * stop growing the moment teams became a real option.
 *
 * The instant is midnight of 2026-08-12 in UTC+8, where the product and its
 * users are — a day of grace past the seat change rather than a hard cut at the
 * moment it shipped, so nobody who signed up the same day is caught out.
 */
export const LEGACY_PERSONAL_WORKSPACE_CUTOFF = new Date(
  '2026-08-12T00:00:00+08:00',
);

/** Same allowance as a free team, so there is one seat number to reason about. */
export const LEGACY_PERSONAL_WORKSPACE_SEAT_POLICY: SeatPolicy = {
  planKey: 'free',
  includedSeats: 28,
  maxSeats: 28,
  seatOverageAllowed: false,
};

/**
 * Decide whether ONE more active member may occupy a seat, given the count of
 * unique users already occupying one across the workspace's projects.
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
  const seatWord = cap === 1 ? 'creator seat' : 'creator seats';
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
