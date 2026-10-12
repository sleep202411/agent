import type { SiteRegion } from "@/app/_components/region-provider";
import type { CanvasAsset } from "@/lib/canvas-core/types";
import { uploadFileViaSignedUrl } from "@/lib/media-upload";

export const DIRECTOR_DESK_CAPTURES_SENT = "storyai:director-desk-captures-sent";
export const DIRECTOR_DESK_CAPTURE_REQUEST = "fizz:director-desk-capture";
export const DIRECTOR_DESK_READY = "fizz:director-desk-ready";
export const DIRECTOR_DESK_STAGING_READY = "workbench:staging-ready";
export const DIRECTOR_DESK_STAGING = "workbench:staging";
export const DIRECTOR_DESK_STAGING_RESULT = "workbench:staging-result";
export const DIRECTOR_DESK_HOSTS = {
  global: "https://java.fizzdragon.com/",
  cn: "https://java.fizzspace.cn/",
} as const satisfies Record<SiteRegion, string>;

export const DIRECTOR_DESK_HOST = DIRECTOR_DESK_HOSTS.global;

export function directorDeskHost(region: SiteRegion = "global"): string {
  return DIRECTOR_DESK_HOSTS[region];
}

export interface DirectorCapture {
  dataUrl: string;
  fileName: string;
  captureId: string | null;
}

export interface DirectorCapturesPayload {
  captures: DirectorCapture[];
  instanceId: string | null;
  operationId: string;
}

export interface DirectorCapturesMessage {
  type: typeof DIRECTOR_DESK_CAPTURES_SENT;
  payload: DirectorCapturesPayload;
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function parseCapture(value: unknown): DirectorCapture | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  const dataUrl = asTrimmedString(row.dataUrl);
  if (!dataUrl?.startsWith("data:image/")) return null;
  return {
    dataUrl,
    fileName: asTrimmedString(row.fileName) || "director-desk-capture.png",
    captureId: asTrimmedString(row.captureId),
  };
}

export function parseDirectorDeskCommandError(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.type !== DIRECTOR_DESK_STAGING_RESULT) return null;
  return typeof message.error === "string" && message.error.trim() ? message.error.trim() : null;
}

export function parseDirectorCapturesMessage(data: unknown): DirectorCapturesMessage | null {
  if (!data || typeof data !== "object") return null;
  const message = data as Record<string, unknown>;
  if (message.type === DIRECTOR_DESK_STAGING_RESULT) {
    if (parseDirectorDeskCommandError(message)) return null;
    const result = message.result;
    if (!result || typeof result !== "object") return null;
    const capture = parseCapture((result as Record<string, unknown>).capture);
    const requestId = asTrimmedString(message.requestId);
    if (!capture || !requestId) return null;
    return {
      type: DIRECTOR_DESK_CAPTURES_SENT,
      payload: {
        captures: [capture],
        instanceId: null,
        operationId: requestId,
      },
    };
  }
  if (message.type !== DIRECTOR_DESK_CAPTURES_SENT) return null;
  const payload = message.payload;
  if (!payload || typeof payload !== "object") return null;
  const body = payload as Record<string, unknown>;
  const operationId = asTrimmedString(body.operationId);
  if (!operationId || !Array.isArray(body.captures)) return null;
  const captures = body.captures
    .map(parseCapture)
    .filter((item): item is DirectorCapture => !!item);
  if (captures.length === 0) return null;
  return {
    type: DIRECTOR_DESK_CAPTURES_SENT,
    payload: {
      captures,
      instanceId: asTrimmedString(body.instanceId),
      operationId,
    },
  };
}

export function isDirectorDeskOrigin(origin: string): boolean {
  if (origin === directorDeskOrigin("global") || origin === directorDeskOrigin("cn")) return true;
  try {
    const url = new URL(origin);
    if (url.protocol !== "http:" && url.protocol !== "https:") return false;
    if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") return false;
    return url.port === "5173" || url.port === "5174";
  } catch {
    return false;
  }
}

export function directorDeskSrc(
  projectId: string,
  stagingHost?: string,
  region: SiteRegion = "global"
): string {
  const url = new URL(directorDeskHost(region));
  url.searchParams.set("instanceId", projectId);
  url.searchParams.set("embed", "1");
  if (stagingHost) url.searchParams.set("stagingHost", stagingHost);
  return url.toString();
}

export function directorDeskOrigin(region: SiteRegion = "global"): string {
  return new URL(directorDeskHost(region)).origin;
}

export function requestDirectorDeskCapture(
  target: Window | null | undefined,
  region: SiteRegion = "global"
): void {
  const origin = directorDeskOrigin(region);
  target?.postMessage({ type: DIRECTOR_DESK_CAPTURE_REQUEST }, origin);
  target?.postMessage(
    {
      type: DIRECTOR_DESK_STAGING,
      requestId: globalThis.crypto?.randomUUID?.() ?? `capture-${Date.now()}`,
      operation: "capture",
      payload: {},
    },
    origin
  );
}

export function dataUrlToFile(dataUrl: string, fileName: string): File {
  const match = /^data:([^;]+);base64,(.+)$/.exec(dataUrl);
  if (!match) throw new Error("Invalid capture data URL");
  const bytes = Uint8Array.from(atob(match[2]), (char) => char.charCodeAt(0));
  return new File([bytes], fileName, { type: match[1] });
}

export async function importDirectorCaptures({
  captures,
  workspaceId,
  upload = uploadFileViaSignedUrl,
}: {
  captures: DirectorCapture[];
  workspaceId?: string | null;
  upload?: typeof uploadFileViaSignedUrl;
}): Promise<CanvasAsset[]> {
  const assets: CanvasAsset[] = [];
  for (const capture of captures) {
    const file = dataUrlToFile(capture.dataUrl, capture.fileName);
    const uploaded = await upload(file, {
      kind: "ai_reference_image",
      ...(workspaceId ? { workspaceId } : {}),
    });
    assets.push({
      id: uploaded.mediaAssetId,
      mediaAssetId: uploaded.mediaAssetId,
      kind: "image",
      source: "uploaded",
      url: uploaded.url,
      name: file.name,
      bytes: file.size,
      createdAt: Date.now(),
      category: "general",
    });
  }
  return assets;
}
