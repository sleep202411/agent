import type { StoryCurrentVideo } from "@/lib/story-projects-api";

export type StoryVideoCardMetadataKey = "duration" | "dimensions" | "fileSize" | "format";

export interface StoryVideoCardMetadataItem {
  key: StoryVideoCardMetadataKey;
  value: string;
}

const BIGINT_ZERO = BigInt(0);
const BIGINT_TEN = BigInt(10);
const FILE_SIZE_UNITS = [
  { divisor: BigInt("1099511627776"), suffix: "TB" },
  { divisor: BigInt("1073741824"), suffix: "GB" },
  { divisor: BigInt("1048576"), suffix: "MB" },
  { divisor: BigInt("1024"), suffix: "KB" },
] as const;

/**
 * Keeps the story-graph card focused on editorially useful facts. Technical
 * diagnostics and immutable identity stay in the inspector/build pipeline.
 */
export function storyVideoCardMetadata(
  video: StoryCurrentVideo | null | undefined
): StoryVideoCardMetadataItem[] {
  if (!video) return [];

  const durationMs =
    video.durationMs ??
    (video.asset.durationSeconds === null ? null : video.asset.durationSeconds * 1_000);
  const width = video.width ?? video.asset.width;
  const height = video.height ?? video.asset.height;
  const items: StoryVideoCardMetadataItem[] = [];
  const duration = formatVideoDuration(durationMs);
  const fileSize = formatFileSize(video.sizeBytes);
  const format = formatVideoContentType(video.contentType || video.asset.contentType);

  if (duration) items.push({ key: "duration", value: duration });
  if (width && height) items.push({ key: "dimensions", value: `${width}×${height}` });
  if (fileSize) items.push({ key: "fileSize", value: fileSize });
  if (format) items.push({ key: "format", value: format });

  return items;
}

export function formatVideoDuration(durationMs: number | null): string | null {
  if (durationMs === null || !Number.isFinite(durationMs) || durationMs < 0) return null;
  const totalSeconds = Math.round(durationMs / 1_000);
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const hours = Math.floor(totalMinutes / 60);

  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
    : `${minutes}:${String(seconds).padStart(2, "0")}`;
}

export function formatFileSize(sizeBytes: string | null): string | null {
  if (!sizeBytes || !/^\d+$/.test(sizeBytes)) return null;
  const bytes = BigInt(sizeBytes);
  if (bytes <= BIGINT_ZERO) return null;

  const unit = FILE_SIZE_UNITS.find(({ divisor }) => bytes >= divisor);
  if (!unit) return `${bytes.toString()} B`;

  const tenths = (bytes * BIGINT_TEN + unit.divisor / BigInt(2)) / unit.divisor;
  const whole = tenths / BIGINT_TEN;
  const decimal = tenths % BIGINT_TEN;
  return `${whole.toString()}${
    decimal === BIGINT_ZERO ? "" : `.${decimal.toString()}`
  } ${unit.suffix}`;
}

export function formatVideoContentType(contentType: string): string | null {
  const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase();
  if (!normalized?.startsWith("video/")) return null;
  const subtype = normalized.slice("video/".length);
  const knownFormats: Record<string, string> = {
    mp4: "MP4",
    quicktime: "MOV",
    webm: "WebM",
    "x-matroska": "MKV",
  };
  return knownFormats[subtype] ?? (subtype.replace(/^x-/, "").toUpperCase() || null);
}
