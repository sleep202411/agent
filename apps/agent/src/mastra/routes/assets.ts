/**
 * Asset endpoints — image-status query + regenerate trigger.
 *
 * Both paths sit behind Nest's AuthGuard which injects x-storyos-context.
 * Status query just reads the project's Redis hash; regenerate enqueues
 * a new job on the asset-images queue with a timestamped id so it
 * bypasses the idempotency key of any in-flight job for the same asset.
 */
import { registerApiRoute } from "@mastra/core/server";
import { HTTPException } from "hono/http-exception";
import { getProjectAssetImageStatus } from "../lib/asset-image-status";
import { javaRequest, type StoryosContext } from "../lib/workspace-client";
import { buildImageJobId, getImageQueue } from "../workflows/engine/image-queue";

function requireContext(c: import("hono").Context): StoryosContext {
  const rc = c.get("requestContext");
  const userId = rc?.get("userId") as string | undefined;
  const projectId = rc?.get("projectId") as string | undefined;
  const cookie = rc?.get("cookie") as string | undefined;
  if (!userId || !projectId) {
    throw new HTTPException(401, { message: "missing userId/projectId in requestContext" });
  }
  return {
    cookie: cookie ?? "",
    userId,
    projectId,
    worldId: rc?.get("worldId") as string | undefined,
    episodeId: rc?.get("episodeId") as string | undefined,
    locale: rc?.get("locale") as string | undefined,
    acceptLanguage: rc?.get("acceptLanguage") as string | undefined,
  };
}

export const assetsRoutes = [
  // ─── GET /assets/image-status ────────────────────────────────────
  // Frontend polls this every 3-5s while any asset in the project is
  // in a non-terminal imageStatus. Returns the full per-project hash —
  // cheap (one HGETALL on a Redis hash capped at a few dozen entries).
  registerApiRoute("/assets/image-status", {
    method: "GET",
    handler: async (c) => {
      const ctx = requireContext(c);
      const statuses = await getProjectAssetImageStatus(ctx.projectId);
      return c.json({ projectId: ctx.projectId, statuses });
    },
  }),

  // ─── POST /assets/:assetType/:assetId/regenerate-image ───────────
  // User-initiated retry. We re-fetch the prompt from Java (source of
  // truth — not Redis, which may have expired) and enqueue a job with a
  // timestamped id so it runs even if the original job is still queued
  // or in a retry backoff window.
  registerApiRoute("/assets/:assetType/:assetId/regenerate-image", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const assetType = c.req.param("assetType");
      const assetId = c.req.param("assetId");

      if (assetType !== "role" && assetType !== "scene" && assetType !== "prop") {
        throw new HTTPException(400, { message: "assetType must be role / scene / prop" });
      }

      const prompt = await fetchAssetPrompt(ctx, assetType, assetId);
      if (!prompt.trim()) {
        throw new HTTPException(400, {
          message: "asset has no visual prompt; cannot generate image",
        });
      }

      const assetName = await fetchAssetName(ctx, assetType, assetId);
      const regenerateAt = Date.now();

      const queue = getImageQueue();
      await queue.add(
        "generate",
        {
          projectId: ctx.projectId,
          worldId: ctx.worldId ?? "",
          assetType,
          assetId,
          prompt,
          assetName,
          ctx,
          regenerateAt,
        },
        { jobId: buildImageJobId(assetType, assetId, regenerateAt) }
      );

      return c.json({ ok: true, assetType, assetId, regenerateAt });
    },
  }),
];

// ─── Internal: pull prompt/name from Java ─────────────────────────

async function fetchAssetPrompt(
  ctx: StoryosContext,
  assetType: "role" | "scene" | "prop",
  assetId: string
): Promise<string> {
  const endpoint = `/api/user/world/query/world${assetType}?id=${encodeURIComponent(assetId)}`;
  const resp = await javaRequest<{ prompt?: string; description?: string }>(ctx, endpoint, {
    method: "GET",
  });
  return (resp.prompt ?? resp.description ?? "").trim();
}

async function fetchAssetName(
  ctx: StoryosContext,
  assetType: "role" | "scene" | "prop",
  assetId: string
): Promise<string> {
  const endpoint = `/api/user/world/query/world${assetType}?id=${encodeURIComponent(assetId)}`;
  const resp = await javaRequest<{ name?: string }>(ctx, endpoint, { method: "GET" });
  return resp.name ?? assetId;
}
