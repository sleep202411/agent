import type { RawAiModel, AssetRecord } from "@/src/types/workspace";
import { env } from "@/src/env";

export type { RawAiModel, AssetRecord };

// ── Constants ──────────────────────────────────────────────────────────

export const API_PATH_VIDEO = "/api/ai/video/generate/basic";
export const MAX_CONCURRENT = 4;

// ── Type definitions ───────────────────────────────────────────────────

export type SimpleMode = "reference" | "frames" | "multiReference";
export type EditMode = "repaint" | "localEdit" | "extend" | "outpainting";
export type VideoMode = SimpleMode | EditMode;
export type PickerAssetType = "img" | "video";
export type MultiRefType = "obj" | "bg";

export interface VideoResultItem {
  id: string;
  url?: string;
  storagePath?: string;
  status?: "waiting" | "generating" | "success" | "failed";
  error?: string;
  other?: string;
  fromQueue?: boolean;
  fromHistory?: boolean;
}

export interface ReferenceAsset {
  url: string;
  path: string;
  typeTag?: MultiRefType;
}

export interface VideoQueueTask {
  id: string;
  status: "waiting" | "generating" | "success" | "failed";
  params: {
    prompt: string;
    mode: VideoMode;
    model?: string;
    size?: string;
    videoLength?: number;
    referenceImageUrl?: string;
    startFrameImageUrl?: string;
    endFrameImageUrl?: string;
    refImageUrls?: string[];
    objOrBg?: MultiRefType[];
    videoUrl?: string;
    controlCondition?: string;
    strength?: number;
    refImageUrl?: string;
    maskImageUrl?: string;
    maskType?: "tracking" | "fixed";
    expandRatio?: number;
    maskFrameId?: number;
    firstClipUrl?: string;
    lastClipUrl?: string;
    firstFrameUrl?: string;
    lastFrameUrl?: string;
    topScale?: number;
    bottomScale?: number;
    leftScale?: number;
    rightScale?: number;
  };
  result: { url: string; storagePath: string } | null;
  error: string | null;
}

export type PickerTarget =
  | "referenceImages"
  | "firstFrames"
  | "lastFrames"
  | "multiRefSubject"
  | "multiRefBg"
  | "repaintVideo"
  | "repaintImage"
  | "localEditVideo"
  | "localEditMask"
  | "localEditRefImage"
  | "extendFirstClip"
  | "extendLastClip"
  | "extendFirstFrame"
  | "extendLastFrame"
  | "outpaintingVideo";

export interface AiVideoGeneratorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shotId: string;
  shotColumnId: string;
  shotNumber?: number;
  defaultPrompt?: string;
  defaultReferenceImage?: string;
  referenceFields?: string[];
  appliedPaths?: string[];
  preferredPath?: string;
  onCollect?: (item: { id: string; url?: string; storagePath?: string }) => void;
  onSetPreferred?: (item: { id: string; url?: string; storagePath?: string }) => void;
  onGeneratePrompt?: (prompt: string) => void;
  onGeneratingChange?: (isGenerating: boolean) => void;
  onGenerateSuccess?: () => void;
  onPrevShot?: () => void;
  onNextShot?: () => void;
}

// ── Utility functions ──────────────────────────────────────────────────

export function ossUrl(path?: string) {
  if (!path) return "";
  if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("blob:")) {
    return path;
  }
  return `${env.OSS_BASE_URL}/${path}`;
}

export function getVideoThumbnail(path?: string) {
  const fullUrl = ossUrl(path);
  if (!fullUrl || fullUrl.startsWith("blob:")) return fullUrl;
  const separator = fullUrl.includes("?") ? "&" : "?";
  return `${fullUrl}${separator}x-oss-process=video/snapshot,t_0,m_fast`;
}

export function parseModelSizes(model?: RawAiModel) {
  if (!model?.description) return [];
  try {
    const parsed = JSON.parse(model.description);
    const sizes = Array.isArray(parsed?.size) ? parsed.size : [];
    return sizes
      .map((item: unknown) => {
        if (typeof item === "string") {
          return { label: item, value: item };
        }
        if (typeof item === "object" && item) {
          const ratio = String((item as { ratio?: string }).ratio ?? "");
          const dimension = String((item as { dimension?: string }).dimension ?? "");
          return {
            label: ratio && dimension ? `${ratio} (${dimension})` : dimension || ratio,
            value: dimension || ratio,
          };
        }
        return null;
      })
      .filter(
        (item: { label: string; value: string } | null): item is { label: string; value: string } =>
          Boolean(item?.value)
      );
  } catch {
    return [];
  }
}

export function parseModelVideoLengths(model?: RawAiModel) {
  if (!model?.description) return [];
  try {
    const parsed = JSON.parse(model.description);
    const videoLength = Array.isArray(parsed?.videoLength) ? parsed.videoLength : [];
    return videoLength
      .map((item: unknown) => {
        const numeric = Number(item);
        if (!Number.isFinite(numeric) || numeric <= 0) return null;
        return { label: `${numeric}s`, value: String(numeric) };
      })
      .filter(
        (item: { label: string; value: string } | null): item is { label: string; value: string } =>
          Boolean(item?.value)
      );
  } catch {
    return [];
  }
}

export function parseVideoGenerateResult(result: unknown) {
  if (Array.isArray(result)) {
    const candidates = result.filter(
      (item): item is string => typeof item === "string" && item.length > 0
    );
    const storagePath = candidates[1] ?? candidates[0] ?? "";
    if (storagePath) {
      return { storagePath, url: ossUrl(storagePath) };
    }
  }

  if (typeof result === "string" && result) {
    return { storagePath: result, url: ossUrl(result) };
  }

  if (result && typeof result === "object") {
    const record = result as {
      storagePath?: string;
      path?: string;
      url?: string;
      filePath?: string;
    };
    const storagePath = record.storagePath ?? record.path ?? record.filePath ?? "";
    const url = record.url ?? (storagePath ? ossUrl(storagePath) : "");
    if (storagePath || url) {
      return { storagePath, url };
    }
  }

  throw new Error("未获取到生成结果");
}

export function toHistoryItem(record: AssetRecord): VideoResultItem {
  const storagePath = String(record.storagePath ?? record.filePath ?? record.path ?? "");
  return {
    id: String(record.id ?? storagePath),
    url: ossUrl(storagePath || String(record.url ?? "")),
    storagePath,
    fromHistory: true,
  };
}

export function toReferenceAssets(paths: string[], typeTag?: MultiRefType) {
  return paths.map((path) => ({
    url: ossUrl(path),
    path,
    ...(typeTag ? { typeTag } : {}),
  }));
}

export function ensureVideoReference(item?: VideoResultItem | null): ReferenceAsset[] {
  if (!item?.storagePath && !item?.url) return [];
  return [
    {
      url: item.url ?? ossUrl(item.storagePath),
      path: item.storagePath ?? item.url ?? "",
    },
  ];
}

export function getModePath(mode: VideoMode) {
  switch (mode) {
    case "frames":
      return "/api/ai/video/generate/start-end-frame";
    case "multiReference":
      return "/api/ai/video/generate/multiplereference";
    case "repaint":
      return "/api/ai/video/generate/videorepainting";
    case "localEdit":
      return "/api/ai/video/generate/videoedit";
    case "extend":
      return "/api/ai/video/generate/videoextension";
    case "outpainting":
      return "/api/ai/video/generate/videooutpainting";
    case "reference":
    default:
      return API_PATH_VIDEO;
  }
}
