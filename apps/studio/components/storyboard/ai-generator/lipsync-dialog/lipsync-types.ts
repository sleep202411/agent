import type { AssetRecord, VoiceOptionItem } from "@/src/types/workspace";
import type { ShotRow, ShotValue } from "@/src/store/slices/projectSlice";

// ─── Constants ─────────────────────────────────────────

export const OSS_BASE = process.env.NEXT_PUBLIC_OSS_BASE_URL ?? "";

// ─── Types ─────────────────────────────────────────────

export type PickerTarget = "video" | "face";
export type QueueStatus = "generating" | "failed";

export interface AudioResultItem {
  id: string;
  path: string;
  name?: string;
  status?: QueueStatus;
}

export interface VideoResultItem {
  id: string;
  path: string;
  name?: string;
  status?: QueueStatus;
}

export interface AiLipSyncGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shotId: string;
  shotColumnId: string;
  shotNumber?: number;
  row?: ShotRow;
  worldId?: string;
  defaultReferenceVideo?: string;
  defaultReferenceAudio?: string;
  defaultReferenceFace?: string;
  appliedPaths?: string[];
  preferredPath?: string;
  onCollect?: (item: { id: string; url?: string; storagePath?: string }) => void;
  onSetPreferred?: (item: { id: string; url?: string; storagePath?: string }) => void;
  onGeneratingChange?: (isGenerating: boolean) => void;
  onGenerateSuccess?: () => void;
}

// Re-export for convenience
export type { ShotRow, ShotValue, AssetRecord, VoiceOptionItem };

// ─── Utility functions ─────────────────────────────────

export function ossUrl(path?: string | null) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

export function getVideoThumbnail(path?: string | null) {
  const fullUrl = ossUrl(path);
  if (!fullUrl || fullUrl.startsWith("blob:")) return fullUrl;
  const separator = fullUrl.includes("?") ? "&" : "?";
  return `${fullUrl}${separator}x-oss-process=video/snapshot,t_0,m_fast`;
}

export function getPreferredFilePath(cell?: ShotValue) {
  const files = Array.isArray(cell?.files)
    ? (cell.files as Array<{ preferred?: boolean; path?: string; url?: string }>)
    : [];
  const preferred = files.find((file) => file.preferred) ?? files[0];
  return String(preferred?.path ?? preferred?.url ?? cell?.value ?? "").trim();
}

export function uniquePaths(paths: Array<string | undefined | null>) {
  return Array.from(new Set(paths.map((item) => String(item ?? "").trim()).filter(Boolean)));
}

export function parseMediaResultPath(result: unknown) {
  if (Array.isArray(result) && result.length > 0) {
    const stringItems = result.filter(
      (item): item is string => typeof item === "string" && item.trim().length > 0
    );
    return String(stringItems[1] ?? stringItems[0] ?? "").trim();
  }

  if (typeof result === "string") {
    return result.trim();
  }

  if (result && typeof result === "object") {
    const record = result as {
      path?: string;
      url?: string;
      filePath?: string;
      storagePath?: string;
    };
    return String(record.storagePath ?? record.filePath ?? record.path ?? record.url ?? "").trim();
  }

  return "";
}

export function toAudioHistoryItem(record: AssetRecord): AudioResultItem | null {
  const path = String(
    record.storagePath ?? record.filePath ?? record.path ?? record.url ?? ""
  ).trim();
  if (!path) return null;
  return {
    id: String(record.id ?? path),
    path,
    name: String(record.name ?? ""),
  };
}

export function toVideoHistoryItem(record: AssetRecord): VideoResultItem | null {
  const path = String(
    record.storagePath ?? record.filePath ?? record.path ?? record.url ?? ""
  ).trim();
  if (!path) return null;
  return {
    id: String(record.id ?? path),
    path,
    name: String(record.name ?? ""),
  };
}

export function buildVideoHistory(
  appliedPaths: string[],
  preferredPath: string,
  records: AssetRecord[]
) {
  const recordMap = new Map<string, VideoResultItem>();
  for (const record of records) {
    const item = toVideoHistoryItem(record);
    if (!item) continue;
    recordMap.set(item.path, item);
  }

  for (const path of appliedPaths) {
    if (!recordMap.has(path)) {
      recordMap.set(path, { id: path, path });
    }
  }

  const preferred = preferredPath && recordMap.has(preferredPath) ? preferredPath : "";
  const items = Array.from(recordMap.values());
  if (!preferred) return items;

  return [recordMap.get(preferred)!, ...items.filter((item) => item.path !== preferred)];
}
