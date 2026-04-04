import { buildOssUrl } from "@/src/lib/uploads/workspace-upload";
import type { AssetRecordSource, AssetRecordType, AssetRecord } from "@/src/types/workspace";

export const PAGE_SIZE = 30;

export const IMAGE_TYPES = new Set([
  "img",
  "image",
  "jpg",
  "jpeg",
  "png",
  "gif",
  "webp",
  "bmp",
  "svg",
]);
export const VIDEO_TYPES = new Set(["video", "mp4", "webm", "mov", "avi", "mkv"]);
export const AUDIO_TYPES = new Set(["audio", "mp3", "wav", "ogg", "flac", "aac", "m4a"]);

export const TYPE_TAB_VALUES: AssetRecordType[] = ["img", "video", "audio"];
export const TYPE_TAB_I18N_KEYS: Record<AssetRecordType, string> = {
  img: "typeImage",
  video: "typeVideo",
  audio: "typeAudio",
};

export const SOURCE_VALUES: AssetRecordSource[] = ["all", "local", "ai"];
export const SOURCE_I18N_KEYS: Record<AssetRecordSource, string> = {
  all: "sourceAll",
  local: "sourceLocal",
  ai: "sourceAi",
};

export const SOURCE_API: Record<AssetRecordSource, string> = {
  all: "/api/ai/record/all/list",
  local: "/api/ai/record/local/list",
  ai: "/api/ai/record/ai/list",
};

export type AssetListItem = AssetRecord & {
  uploading?: boolean;
  tempKey?: string;
};

export function isImageType(type?: string) {
  return IMAGE_TYPES.has(type?.toLowerCase() ?? "");
}

export function isVideoType(type?: string) {
  return VIDEO_TYPES.has(type?.toLowerCase() ?? "");
}

export function isAudioType(type?: string) {
  return AUDIO_TYPES.has(type?.toLowerCase() ?? "");
}

export function getAssetKey(asset: AssetListItem) {
  return String(asset.id ?? asset.tempKey ?? asset.path ?? asset.url ?? crypto.randomUUID());
}

export function getAssetUrl(asset: AssetListItem) {
  const path = String(asset.path ?? asset.filePath ?? asset.storagePath ?? asset.url ?? "");
  return buildOssUrl(path);
}

export function inferAssetType(file: File, currentType: AssetRecordType): string {
  if (currentType === "img") return file.type.split("/")[1] || "img";
  if (currentType === "video") return file.type.split("/")[1] || "video";
  return file.type.split("/")[1] || "audio";
}

export function getUploadType(type: AssetRecordType) {
  if (type === "video") return "SHOT_VALUE_VIDEO";
  if (type === "audio") return "SHOT_VALUE_AUDIO";
  return "SHOT_VALUE_IMAGE";
}

export function formatDateLabel(dateString?: string) {
  const date = dateString ? new Date(dateString) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
