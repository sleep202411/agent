import type { ShotRow, ShotColumn, ShotValue } from "@/src/store/slices/projectSlice";

// ─── Constants ─────────────────────────────────────────

export const FPS = 30;
export const MIN_ZOOM = 10;
export const MAX_ZOOM = 200;
export const ZOOM_STEP = 10;
export const MIN_TIMELINE_DURATION = 60;
export const TIMELINE_BUFFER = 30;
export const PLAYHEAD_OFFSET = 12;
export const PLAYHEAD_SCREEN_POSITION = 0.25;
export const MIN_DURATION = 0.5;
export const MAX_DURATION = 300;
export const OSS_BASE = process.env.NEXT_PUBLIC_OSS_BASE_URL ?? "";

// ─── Types ─────────────────────────────────────────────

export type AssetType = "image" | "video";
export type TimelineMenuAction =
  | "replaceImage"
  | "replaceVideo"
  | "aiImage"
  | "aiVideo"
  | "lipSync"
  | "downloadImage"
  | "downloadVideo"
  | "setDuration"
  | "delete"
  | "insertBefore"
  | "insertAfter";

export type TimelineFile = {
  id?: string;
  path?: string;
  url?: string;
  name?: string;
  preferred?: boolean;
  coverUrl?: string;
};

export interface TimelineShot {
  id: string;
  row: ShotRow;
  shotNo: number;
  rowIndex: number;
  duration: number;
  thumbnailUrl: string;
  imageUrl: string;
  videoUrl: string;
  mediaType: "image" | "video";
  hasMedia: boolean;
  description: string;
  dialogue: string;
  narration: string;
  imageCell?: ShotValue;
  videoCell?: ShotValue;
  lipSyncCell?: ShotValue;
  audioCell?: ShotValue;
  baseVideoUrl: string;
}

// ─── Utility functions ─────────────────────────────────

export function ossUrl(path?: string | null): string {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${OSS_BASE}/${path}`;
}

export function getVideoThumbnail(path?: string | null): string {
  const fullUrl = ossUrl(path);
  if (!fullUrl || fullUrl.startsWith("blob:")) return fullUrl;
  const separator = fullUrl.includes("?") ? "&" : "?";
  return `${fullUrl}${separator}x-oss-process=video/snapshot,t_0,m_fast`;
}

export function formatClock(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 100);
  return `${String(mins).padStart(2, "0")}:${String(secs).padStart(2, "0")}.${String(ms).padStart(2, "0")}`;
}

export function formatDurationLabel(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

export function parseAspectRatioValue(raw?: string | null) {
  const normalized = String(raw ?? "")
    .replace(/^_+/, "")
    .replace(/_/g, ":")
    .replace("/", ":");
  const match = normalized.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/);
  if (!match) return 16 / 9;
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    return 16 / 9;
  }
  return width / height;
}

export function getTickInterval(pxPerSecond: number) {
  const rawInterval = 50 / pxPerSecond;
  const intervals = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60];
  return intervals.find((interval) => interval >= rawInterval) ?? 60;
}

export function snapTimeToTick(time: number, pxPerSecond: number, threshold = 8) {
  const tickInterval = getTickInterval(pxPerSecond);
  const nearestTick = Math.round(time / tickInterval) * tickInterval;
  const distancePx = Math.abs(time - nearestTick) * pxPerSecond;
  return distancePx <= threshold ? nearestTick : time;
}

export function stripTags(content: string) {
  return content
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function getCellText(cell?: ShotValue) {
  return String(cell?.richText?.content ?? cell?.value ?? "");
}

export function getPreferredFile(cell?: ShotValue): TimelineFile | null {
  const files = Array.isArray(cell?.files) ? (cell?.files as TimelineFile[]) : [];
  return files.find((file) => file.preferred) ?? files[0] ?? null;
}

export function getAllFilePaths(cell?: ShotValue) {
  const files = Array.isArray(cell?.files) ? (cell?.files as TimelineFile[]) : [];
  return files.map((file) => String(file.path ?? file.url ?? "")).filter(Boolean);
}

export function findCellByColumnId(row: ShotRow, columnId?: string) {
  if (!columnId) return undefined;
  return row.shotValues?.find((value) => String(value.shotColumnId ?? "") === columnId);
}

export function findCellByPreset(row: ShotRow, presetColumnKey: string) {
  return row.shotValues?.find((value) => value.presetColumnKey === presetColumnKey);
}

export function resolveShotValueId(result: unknown) {
  if (typeof result === "string" || typeof result === "number") {
    return String(result);
  }

  if (result && typeof result === "object") {
    const record = result as Record<string, unknown>;
    if (typeof record.id === "string" || typeof record.id === "number") {
      return String(record.id);
    }
    if (typeof record.data === "string" || typeof record.data === "number") {
      return String(record.data);
    }
    if (record.data && typeof record.data === "object") {
      const nested = record.data as Record<string, unknown>;
      if (typeof nested.id === "string" || typeof nested.id === "number") {
        return String(nested.id);
      }
    }
  }

  return "";
}

export function upsertShotCell(
  rows: ShotRow[],
  shotId: string,
  shotColumnId: string,
  patch: Partial<ShotValue>
) {
  return rows.map((row) => {
    if (String(row.shotId ?? "") !== shotId) return row;

    const values = [...(row.shotValues ?? [])];
    const index = values.findIndex((value) => String(value.shotColumnId ?? "") === shotColumnId);
    if (index >= 0) {
      values[index] = { ...values[index], ...patch };
    } else {
      values.push({ shotColumnId, ...patch });
    }

    return { ...row, shotValues: values };
  });
}

export function moveRowBefore(rows: ShotRow[], currentShotId: string, beforeShotId?: string) {
  const nextRows = [...rows];
  const fromIndex = nextRows.findIndex((row) => String(row.shotId ?? "") === currentShotId);
  if (fromIndex < 0) return rows;

  const [moved] = nextRows.splice(fromIndex, 1);
  if (!moved) return rows;

  if (!beforeShotId) {
    nextRows.push(moved);
    return nextRows;
  }

  const targetIndex = nextRows.findIndex((row) => String(row.shotId ?? "") === beforeShotId);
  if (targetIndex < 0) {
    nextRows.push(moved);
    return nextRows;
  }

  nextRows.splice(targetIndex, 0, moved);
  return nextRows;
}

export function buildPreferredFiles(existingFiles: TimelineFile[], preferredPath: string) {
  const map = new Map<string, TimelineFile>();
  for (const file of existingFiles) {
    const path = String(file.path ?? file.url ?? "");
    if (!path) continue;
    map.set(path, { ...file, preferred: path === preferredPath });
  }
  if (!map.has(preferredPath)) {
    map.set(preferredPath, { path: preferredPath, preferred: true });
  }
  return Array.from(map.values()).map((file) => ({
    ...file,
    preferred: String(file.path ?? file.url ?? "") === preferredPath,
  }));
}

export function mergeMediaFiles(
  existingFiles: TimelineFile[],
  nextPaths: string[],
  preferredMediaPath = ""
) {
  return nextPaths.map((itemPath) => {
    const existing = existingFiles.find((file) => String(file.path ?? file.url ?? "") === itemPath);
    return {
      ...(existing ?? { path: itemPath }),
      path: itemPath,
      preferred: preferredMediaPath
        ? itemPath === preferredMediaPath
        : Boolean(existing?.preferred),
    };
  });
}

export function getProjectStyleLabel(detail?: Record<string, unknown> | null) {
  return String(detail?.stylePaintingName ?? detail?.stylePainting ?? "");
}

export function getPromptContent(cell?: ShotValue) {
  return stripTags(getCellText(cell));
}

export function getShotWidth(duration: number, pxPerSecond: number) {
  return duration * pxPerSecond;
}

export function getCompositionSize(ratio: number) {
  if (ratio >= 1) {
    const width = 1280;
    return { width, height: Math.round(width / ratio) };
  }
  const height = 1280;
  return { width: Math.round(height * ratio), height };
}

export function buildImagePromptContext(
  row: ShotRow,
  column: ShotColumn | undefined,
  columns: ShotColumn[],
  detail?: Record<string, unknown> | null
) {
  const shotValues = row.shotValues ?? [];
  const imagePromptCell = shotValues.find((item) => item.presetColumnKey === "image_prompt");

  const directPrompt = getPromptContent(imagePromptCell);
  if (directPrompt) {
    return {
      prompt: directPrompt,
      referenceFields: [] as string[],
      imagePromptColumnId: imagePromptCell?.shotColumnId
        ? String(imagePromptCell.shotColumnId)
        : "",
    };
  }

  const aiRefs = Array.isArray(column?.aiRef) ? column.aiRef.map((item) => String(item)) : [];
  if (aiRefs.length > 0) {
    const promptParts: string[] = [];
    const referenceFields: string[] = [];

    for (const columnId of aiRefs) {
      const cell = shotValues.find((item) => String(item.shotColumnId ?? "") === columnId);
      const content = getPromptContent(cell);
      if (!content) continue;
      promptParts.push(content);
      const matchedColumn = columns.find((item) => String(item.id ?? "") === columnId);
      if (matchedColumn?.columnName) {
        referenceFields.push(String(matchedColumn.columnName));
      }
    }

    return {
      prompt: promptParts.join(", "),
      referenceFields,
      imagePromptColumnId: imagePromptCell?.shotColumnId
        ? String(imagePromptCell.shotColumnId)
        : "",
    };
  }

  const fallbackKeys = ["description", "shot_size", "perspective", "style_planting"];
  const promptParts: string[] = [];
  const referenceFields: string[] = [];
  const styleLabel = getProjectStyleLabel(detail);

  for (const presetKey of fallbackKeys) {
    const matchedCell = shotValues.find((item) => item.presetColumnKey === presetKey);
    let content = getPromptContent(matchedCell);
    if (presetKey === "style_planting" && !content && styleLabel) {
      content = styleLabel;
    }
    if (!content) continue;
    promptParts.push(content);

    const matchedColumn = columns.find((item) => item.presetColumnKey === presetKey);
    if (matchedColumn?.columnName) {
      referenceFields.push(String(matchedColumn.columnName));
    }
  }

  return {
    prompt: promptParts.join(", "),
    referenceFields,
    imagePromptColumnId: imagePromptCell?.shotColumnId ? String(imagePromptCell.shotColumnId) : "",
  };
}

export function buildVideoPromptContext(
  row: ShotRow,
  column: ShotColumn | undefined,
  columns: ShotColumn[],
  detail?: Record<string, unknown> | null
) {
  const shotValues = row.shotValues ?? [];
  const videoPromptCell = shotValues.find((item) => item.presetColumnKey === "video_prompt");

  const directPrompt = getPromptContent(videoPromptCell);
  if (directPrompt) {
    return {
      prompt: directPrompt,
      referenceFields: [] as string[],
      videoPromptColumnId: videoPromptCell?.shotColumnId
        ? String(videoPromptCell.shotColumnId)
        : "",
    };
  }

  const aiRefs = Array.isArray(column?.aiRef) ? column.aiRef.map((item) => String(item)) : [];
  if (aiRefs.length > 0) {
    const promptParts: string[] = [];
    const referenceFields: string[] = [];

    for (const columnId of aiRefs) {
      const cell = shotValues.find((item) => String(item.shotColumnId ?? "") === columnId);
      const content = getPromptContent(cell);
      if (!content) continue;
      promptParts.push(content);
      const matchedColumn = columns.find((item) => String(item.id ?? "") === columnId);
      if (matchedColumn?.columnName) {
        referenceFields.push(String(matchedColumn.columnName));
      }
    }

    return {
      prompt: promptParts.join(", "),
      referenceFields,
      videoPromptColumnId: videoPromptCell?.shotColumnId
        ? String(videoPromptCell.shotColumnId)
        : "",
    };
  }

  const fallbackKeys = ["video_prompt", "movement", "style_planting"];
  const promptParts: string[] = [];
  const referenceFields: string[] = [];
  const styleLabel = getProjectStyleLabel(detail);

  for (const presetKey of fallbackKeys) {
    const matchedCell = shotValues.find((item) => item.presetColumnKey === presetKey);
    let content = getPromptContent(matchedCell);
    if (presetKey === "style_planting" && !content && styleLabel) {
      content = styleLabel;
    }
    if (!content) continue;
    promptParts.push(content);

    const matchedColumn = columns.find((item) => item.presetColumnKey === presetKey);
    if (matchedColumn?.columnName) {
      referenceFields.push(String(matchedColumn.columnName));
    }
  }

  return {
    prompt: promptParts.join(", "),
    referenceFields,
    videoPromptColumnId: videoPromptCell?.shotColumnId ? String(videoPromptCell.shotColumnId) : "",
  };
}

export function extractTimelineShots(rows: ShotRow[], columns: ShotColumn[]) {
  const imageColumn = columns.find((col) => col.presetColumnKey === "image_path");
  const videoColumn = columns.find((col) => col.presetColumnKey === "video_path");
  const lipSyncColumn = columns.find((col) => col.presetColumnKey === "video_path_lip_sync");
  const audioColumn = columns.find((col) => col.presetColumnKey === "sound_path");
  const durationColumn = columns.find((col) => col.presetColumnKey === "duration");

  return rows
    .map((row, rowIndex) => {
      const durationCell =
        findCellByColumnId(row, String(durationColumn?.id ?? "")) ??
        findCellByPreset(row, "duration");
      let duration = Number(getCellText(durationCell)) || 3;
      if (duration > 600) {
        duration /= 1000;
      }
      duration = Math.max(0.1, Math.min(300, duration));

      const imageCell =
        findCellByColumnId(row, String(imageColumn?.id ?? "")) ??
        findCellByPreset(row, "image_path");
      const baseVideoCell =
        findCellByColumnId(row, String(videoColumn?.id ?? "")) ??
        findCellByPreset(row, "video_path");
      const lipSyncCell =
        findCellByColumnId(row, String(lipSyncColumn?.id ?? "")) ??
        findCellByPreset(row, "video_path_lip_sync");
      const audioCell =
        findCellByColumnId(row, String(audioColumn?.id ?? "")) ??
        findCellByPreset(row, "sound_path");

      const preferredImage = getPreferredFile(imageCell);
      const preferredBaseVideo = getPreferredFile(baseVideoCell);
      const preferredLipSyncVideo = getPreferredFile(lipSyncCell);

      const imagePath = String(
        preferredImage?.path ?? preferredImage?.url ?? imageCell?.value ?? ""
      );
      const baseVideoPath = String(
        preferredBaseVideo?.path ?? preferredBaseVideo?.url ?? baseVideoCell?.value ?? ""
      );
      const lipSyncVideoPath = String(
        preferredLipSyncVideo?.path ?? preferredLipSyncVideo?.url ?? lipSyncCell?.value ?? ""
      );
      const videoPath = lipSyncVideoPath || baseVideoPath;
      const imageUrl = ossUrl(imagePath);
      const baseVideoUrl = ossUrl(baseVideoPath);
      const videoUrl = ossUrl(videoPath);
      const parsedShotNo = Number(row.shotNo);
      const shotNo =
        Number.isFinite(parsedShotNo) && parsedShotNo > 0 ? parsedShotNo : rowIndex + 1;

      let thumbnailUrl = "";
      if (preferredLipSyncVideo) {
        thumbnailUrl =
          ossUrl(preferredLipSyncVideo.coverUrl ?? "") || getVideoThumbnail(lipSyncVideoPath);
      } else if (preferredBaseVideo) {
        thumbnailUrl =
          ossUrl(preferredBaseVideo.coverUrl ?? "") || getVideoThumbnail(baseVideoPath);
      } else if (imagePath) {
        thumbnailUrl = imageUrl;
      }

      return {
        id: String(row.shotId ?? ""),
        row,
        shotNo,
        rowIndex,
        duration,
        thumbnailUrl,
        imageUrl,
        videoUrl,
        baseVideoUrl,
        mediaType: (preferredLipSyncVideo || preferredBaseVideo ? "video" : "image") as
          | "image"
          | "video",
        hasMedia: Boolean(thumbnailUrl || videoUrl),
        description: getCellText(findCellByPreset(row, "description")),
        dialogue: getCellText(findCellByPreset(row, "dialogue")),
        narration: "",
        imageCell,
        videoCell: baseVideoCell,
        lipSyncCell,
        audioCell,
      };
    })
    .filter((shot) => shot.hasMedia);
}
