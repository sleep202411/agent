import { describe, expect, it } from "vitest";
import type { EpisodeAccess, IpAccess, IpDetail } from "@/data/types";
import { gpsPlaybackPath, resolvePlaybackEntry } from "./playback-entry";

const episode = {
  id: "episode-2",
  index: 2,
  title: "Second",
  mediaUrl: "https://media.test/second.mp4",
  feedbackEligible: true,
};
const detail = {
  id: "ip",
  title: "Story",
  previewVideoUrl: "https://media.test/trailer.mp4",
  episodes: [{ ...episode, id: "episode-1" }, episode],
} as IpDetail;
function access(code: EpisodeAccess): IpAccess {
  return {
    authenticated: true,
    member: false,
    balance: "0",
    ip: { owned: false, access: "free", price: null },
    episodes: { [episode.id]: { owned: false, access: code, price: null } },
  };
}
describe("GPS native playback entry", () => {
  it("keeps the selected episode in the route instead of opening only the parent", () => {
    expect(gpsPlaybackPath("ip", episode.id)).toBe("/ip/ip?watch=1&episode=episode-2");
    expect(gpsPlaybackPath("ip")).toBe("/ip/ip?watch=1");
  });
  it.each(["owned_ip", "owned_episode", "free_preview", "member_free", "free"] as EpisodeAccess[])(
    "plays the exact episode after fresh %s access",
    (code) => {
      expect(resolvePlaybackEntry(detail, access(code), "1", episode.id)).toEqual({
        url: episode.mediaUrl,
        title: "Second",
        episodeId: episode.id,
        targetEpisodeId: episode.id,
      });
    }
  );
  it.each([
    "locked",
    "member_locked",
    "pending_unlock",
    "pending_unlock_ip",
    "pending_unlock_episode",
  ])("does not auto-unlock or substitute a trailer for %s", (code) => {
    expect(
      resolvePlaybackEntry(detail, access(code as EpisodeAccess), "1", episode.id)
    ).toBeUndefined();
  });
  it("does not guess access, media, or a missing episode", () => {
    expect(
      resolvePlaybackEntry(
        {
          ...detail,
          episodes: [
            { ...episode, mediaUrl: undefined, videoUrl: "https://media.test/episode-trailer.mp4" },
          ],
        },
        access("free"),
        "1",
        episode.id
      )
    ).toBeUndefined();
    expect(resolvePlaybackEntry(detail, undefined, "1", episode.id)).toBeUndefined();
    expect(resolvePlaybackEntry(detail, access("free"), "1", "missing")).toBeUndefined();
    expect(
      resolvePlaybackEntry(
        { ...detail, episodes: [{ ...episode, mediaUrl: undefined }] },
        access("free"),
        "1",
        episode.id
      )
    ).toBeUndefined();
  });
  it("only opens the IP trailer when no episode was requested", () => {
    expect(resolvePlaybackEntry(detail, undefined, "1", undefined)).toEqual({
      url: detail.previewVideoUrl,
      title: detail.title,
    });
    expect(resolvePlaybackEntry(detail, undefined, "1", "")).toBeUndefined();
    expect(
      resolvePlaybackEntry({ ...detail, previewVideoUrl: undefined }, undefined, "1", undefined)
    ).toBeUndefined();
  });
  it("does not start playback for ordinary details or ambiguous parameters", () => {
    for (const watch of [undefined, "0", ["1", "1"]])
      expect(resolvePlaybackEntry(detail, access("free"), watch, episode.id)).toBeUndefined();
    expect(
      resolvePlaybackEntry(detail, access("free"), "1", [episode.id, episode.id])
    ).toBeUndefined();
  });
  it("never reports trailer playback as an eligible full-episode view", () => {
    expect(
      resolvePlaybackEntry(
        { ...detail, episodes: [{ ...episode, feedbackEligible: false }] },
        access("free_preview"),
        "1",
        episode.id
      )?.episodeId
    ).toBeUndefined();
  });
});
