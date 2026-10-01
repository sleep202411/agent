import { EPISODE_SOURCE_MAX_BYTES } from "@repo/shared";
export function episodeVideoType(name: string, mime?: string) {
  const value = mime?.trim().toLowerCase();
  if (value === "video/mp4" || value === "video/quicktime" || value === "video/webm") return value;
  if (!value || value === "application/octet-stream") {
    if (/\.mp4$/i.test(name)) return "video/mp4";
    if (/\.mov$/i.test(name)) return "video/quicktime";
    if (/\.webm$/i.test(name)) return "video/webm";
  }
  throw new Error("Select an MP4, MOV or WebM video.");
}
export function validateEpisodeVideoSize(size: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > EPISODE_SOURCE_MAX_BYTES)
    throw new Error("Select a non-empty video up to 35 GiB.");
}
