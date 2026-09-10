import type { IpCommerceAsset, IpCommerceEpisode, IpCommerceIp } from "./api";

type PreviewAsset = Pick<IpCommerceAsset, "kind" | "url"> | null | undefined;

/** Only the server-resolved URL has passed readiness, access and moderation gates. */
export function previewVideoUrl(asset: PreviewAsset): string {
  return asset?.kind === "video" ? asset.url || "" : "";
}

export function ipPreviewVideoUrl(ip: {
  trailerAsset: IpCommerceIp["trailerAsset"];
  episodes: Pick<IpCommerceEpisode, "trailerAsset" | "mediaAsset">[];
}): string {
  const candidates = [
    ip.trailerAsset,
    ...ip.episodes.map((episode) => episode.trailerAsset),
    ...ip.episodes.map((episode) => episode.mediaAsset),
  ];
  return candidates.map(previewVideoUrl).find(Boolean) || "";
}
