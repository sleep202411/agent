import type { IpAccess, IpDetail } from "@/data/types";

const granted = new Set(["owned_ip", "owned_episode", "free_preview", "member_free", "free"]);
export type PlaybackEntry = {
  url: string;
  title: string;
  episodeId?: string;
  targetEpisodeId?: string;
};

/** A playback intent never substitutes another episode or an IP trailer. */
export function resolvePlaybackEntry(
  detail: IpDetail,
  access: IpAccess | undefined,
  watch: string | string[] | undefined,
  episode: string | string[] | undefined
): PlaybackEntry | undefined {
  if (watch !== "1" || Array.isArray(episode)) return undefined;
  if (episode !== undefined) {
    const target = detail.episodes.find((item) => item.id === episode);
    const permission = access?.episodes[episode]?.access;
    if (!target?.mediaUrl || !permission || !granted.has(permission)) return undefined;
    return {
      url: target.mediaUrl,
      title: target.title,
      targetEpisodeId: target.id,
      episodeId: target.feedbackEligible ? target.id : undefined,
    };
  }
  return detail.previewVideoUrl ? { url: detail.previewVideoUrl, title: detail.title } : undefined;
}

export function gpsPlaybackPath(ipId: string, episodeId?: string | null) {
  const query = new URLSearchParams({ watch: "1" });
  if (episodeId) query.set("episode", episodeId);
  return `/ip/${encodeURIComponent(ipId)}?${query}`;
}
