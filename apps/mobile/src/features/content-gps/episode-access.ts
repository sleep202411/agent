import type { EpisodeAccess, IpAccess, IpEpisode, PriceRule } from "@/data/types";

function chargeAmount(rule: PriceRule): string {
  return rule.memberAmount ?? rule.amount;
}

/** Resolved action for a locked episode. */
export type UnlockPlan =
  | { kind: "unavailable" }
  | { kind: "pending" }
  | { kind: "member" }
  | {
      kind: "buy";
      targetType: "ip" | "episode";
      episodeId?: string;
      priceRuleId?: string;
      /** Community points to charge (whole points, string). */
      points: string;
    };

/** Access codes that are already watchable — no unlock action. */
const GRANTED_ACCESS: EpisodeAccess[] = [
  "owned_ip",
  "owned_episode",
  "free_preview",
  "member_free",
  "free",
];

/** What tapping an episode does, from the authoritative access map. Returns
 *  undefined only when access is granted. A URL is never proof of access. */
export function resolvePlan(
  access: IpAccess | undefined,
  episode: IpEpisode
): UnlockPlan | undefined {
  const state = access?.episodes[episode.id];
  if (!state) return { kind: "unavailable" };
  if (GRANTED_ACCESS.includes(state.access)) return undefined; // already watchable
  if (state.access.startsWith("pending_unlock")) return { kind: "pending" };
  if (state.access === "member_locked") return { kind: "member" };
  // A per-episode price → buy just this episode.
  if (state.access === "locked" && state.price) {
    return {
      kind: "buy",
      targetType: "episode",
      episodeId: episode.id,
      priceRuleId: state.price.id,
      points: chargeAmount(state.price),
    };
  }
  // Gated by the whole-IP bundle price → buy the IP (unlocks all episodes).
  const ipRule = access?.ip.price ?? null;
  if (ipRule) {
    return { kind: "buy", targetType: "ip", priceRuleId: ipRule.id, points: chargeAmount(ipRule) };
  }
  return { kind: "unavailable" };
}
