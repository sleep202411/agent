/**
 * Call Java's image-generation endpoint.
 *
 * We don't call Replicate/OSS directly — we don't have OSS credentials in
 * this process. Java already owns:
 *   - model inference (whatever backend it proxies to — Tongyi, DALL-E, etc.)
 *   - OSS upload + path assignment
 *   - billing attribution to the caller's account
 *
 * Role-image calls reuse the generic `/api/ai/image/generate/basic` endpoint
 * with `shotColumnId = -1` (ROLE_RECORD_COLUMN_ID sentinel) — that's the
 * convention the frontend already uses, see apps/web/src/lib/asset-paths.ts.
 *
 * Synchronous: the response body is the OSS storage path (as a string).
 * Java holds the connection open for the 5-30s it takes to generate, so
 * the caller should be OK with blocking for that long — we're running
 * inside a BullMQ worker with concurrency = 16, so stuck connections don't
 * starve anything.
 */
import { javaRequest, type StoryosContext } from "./workspace-client";

// Sentinel values matching apps/web/src/lib/asset-paths.ts — DO NOT CHANGE
// without coordinating with the frontend and Java's column_id handling.
export const ROLE_RECORD_COLUMN_ID = -1;
export const SCENE_RECORD_COLUMN_ID = -2; // (guess — confirm with Java team before using)
export const PROP_RECORD_COLUMN_ID = -3; // (ditto)

/**
 * Shape of the /api/ai/image/generate/basic response. Java typically
 * returns the storage path as a plain string inside `data`, but older
 * variants nest it. Accept both.
 */
type ImageGenResponse = string | { path?: string; url?: string } | null | undefined;

function extractPath(resp: ImageGenResponse): string | null {
  if (typeof resp === "string" && resp.length > 0) return resp;
  if (resp && typeof resp === "object") {
    if (typeof resp.path === "string" && resp.path.length > 0) return resp.path;
    if (typeof resp.url === "string" && resp.url.length > 0) return resp.url;
  }
  return null;
}

/**
 * Kick off a synchronous image generation for the given asset. The Java
 * service will generate + upload to OSS + return the storage path. We
 * then use that path to update the asset record in a separate call
 * (Java doesn't write it back automatically).
 */
export async function generateAssetImageViaJava(
  ctx: StoryosContext,
  opts: {
    assetType: "role" | "scene" | "prop";
    assetId: string;
    prompt: string;
    referenceImageUrl?: string;
    model?: string;
  }
): Promise<string> {
  const columnId =
    opts.assetType === "role"
      ? ROLE_RECORD_COLUMN_ID
      : opts.assetType === "scene"
        ? SCENE_RECORD_COLUMN_ID
        : PROP_RECORD_COLUMN_ID;

  const body: Record<string, unknown> = {
    shotColumnId: columnId,
    shotId: opts.assetId,
    prompt: opts.prompt,
    watermark: false,
  };
  if (opts.referenceImageUrl) body.referenceImageUrl = opts.referenceImageUrl;
  if (opts.model) body.model = opts.model;

  // Java blocks for the full generation. Bump the default 60s timeout to
  // 180s so even a slow backend run (Tongyi variants go up to ~90s) has
  // headroom before we bail.
  const resp = await javaRequest<ImageGenResponse>(ctx, "/api/ai/image/generate/basic", {
    data: body,
    timeoutMs: 180_000,
  });

  const path = extractPath(resp);
  if (!path) {
    throw new Error(
      `Java image-gen returned no path (response: ${JSON.stringify(resp).slice(0, 200)})`
    );
  }
  return path;
}

/**
 * Write back the freshly generated OSS path onto the asset record.
 *
 * Java's `/api/user/world/update/worldX` endpoints do a **full-record
 * replace**, not a patch — omitted fields get blanked. So we list the
 * record first, echo every existing field, and swap in the new imgPath.
 * Called by both the image-worker (workflow path) and the atomic image
 * tools (direct supervisor path).
 */
export async function updateAssetImagePath(
  ctx: StoryosContext,
  assetType: "role" | "scene" | "prop",
  assetId: string,
  assetName: string,
  ossPath: string
): Promise<void> {
  const endpoint = `/api/user/world/update/world${assetType}`;
  const listEndpoint = `/api/user/world/list/world${assetType}`;
  const imgField =
    assetType === "role" ? "roleImgPath" : assetType === "scene" ? "sceneImgPath" : "propImgPath";

  type RawAsset = {
    id?: string | number;
    name?: string;
    description?: string;
    prompt?: string;
    roleImgPath?: string[];
    sceneImgPath?: string[];
    propImgPath?: string[];
    referenceImgPath?: string[];
    referenceImgDescription?: string[];
    model?: string;
    voiceId?: string;
  };
  const listed = await javaRequest<{ list?: RawAsset[] }>(ctx, listEndpoint, {
    data: { worldId: ctx.worldId ?? "", page: 1, pageSize: 999 },
  }).catch<{ list?: RawAsset[] }>(() => ({ list: [] }));
  const existing = (listed.list ?? []).find((a) => String(a.id ?? "") === String(assetId));

  const body: Record<string, unknown> = {
    id: assetId,
    name: existing?.name ?? assetName,
    description: existing?.description ?? "",
    prompt: existing?.prompt ?? "",
    [imgField]: [ossPath],
  };
  if (assetType === "role") {
    body.referenceImgPath = existing?.referenceImgPath ?? [];
    body.referenceImgDescription = existing?.referenceImgDescription ?? [];
    body.model = existing?.model ?? "";
    body.voiceId = existing?.voiceId ?? "";
  }

  await javaRequest<unknown>(ctx, endpoint, { data: body });
}
