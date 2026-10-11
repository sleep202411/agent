import { describe, expect, it } from "vitest";
import type { EpisodeAccess, IpAccess, IpEpisode } from "@/data/types";
import { resolvePlan } from "./episode-access";
const episode: IpEpisode = {
  id: "episode",
  title: "Episode",
  index: 1,
  videoUrl: "https://media.test/trailer.mp4",
};
const access = (code: EpisodeAccess): IpAccess => ({
  authenticated: true,
  member: false,
  balance: "100",
  ip: { owned: false, access: "free", price: null },
  episodes: { episode: { owned: false, access: code, price: null } },
});
describe("episode access actions", () => {
  it("never treats missing, partial or denied access as permission, even with a URL", () => {
    expect(resolvePlan(undefined, episode)).toEqual({ kind: "unavailable" });
    expect(resolvePlan({ ...access("free"), episodes: {} }, episode)).toEqual({
      kind: "unavailable",
    });
    expect(resolvePlan(access("locked"), episode)).toEqual({ kind: "unavailable" });
    expect(resolvePlan(access("locked_bundle"), episode)).toEqual({ kind: "unavailable" });
  });
  it.each(["owned_ip", "owned_episode", "free_preview", "member_free", "free"] as const)(
    "accepts confirmed %s",
    (code) => {
      expect(resolvePlan(access(code), episode)).toBeUndefined();
    }
  );
  it.each(["pending_unlock_ip", "pending_unlock_episode"] as const)(
    "does not resell pending %s",
    (code) => {
      const state = access(code);
      state.ip.price = { id: "bundle", targetType: "ip", amount: "50" };
      expect(resolvePlan(state, episode)).toEqual({ kind: "pending" });
    }
  );
  it("keeps membership distinct from a points purchase", () => {
    expect(resolvePlan(access("member_locked"), episode)).toEqual({ kind: "member" });
  });
  it("uses the current member price and per-episode rule before the bundle", () => {
    const state = access("locked");
    state.episodes.episode!.price = {
      id: "single",
      targetType: "episode",
      amount: "40",
      memberAmount: "25",
    };
    state.ip.price = { id: "bundle", targetType: "ip", amount: "90" };
    expect(resolvePlan(state, episode)).toEqual({
      kind: "buy",
      targetType: "episode",
      episodeId: "episode",
      priceRuleId: "single",
      points: "25",
    });
    state.episodes.episode!.price = null;
    state.episodes.episode!.access = "locked_bundle";
    expect(resolvePlan(state, episode)).toEqual({
      kind: "buy",
      targetType: "ip",
      priceRuleId: "bundle",
      points: "90",
    });
  });
});
