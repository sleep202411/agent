/**
 * Asset endpoints — image-status query + regenerate trigger.
 *
 * Both paths sit behind Nest's AuthGuard which injects x-storyos-context.
 * Status query just reads the project's Redis hash; regenerate enqueues
 * a new job on the asset-images queue with a timestamped id so it
 * bypasses the idempotency key of any in-flight job for the same asset.
 *
 * Regenerate intentionally takes the prompt + display name in the POST
 * body rather than looking them up server-side — Java doesn't expose a
 * single-asset query endpoint that works reliably, and the frontend
 * already has the record loaded anyway.
 */
import { registerApiRoute } from "@mastra/core/server";
import { HTTPException } from "hono/http-exception";
import { getProjectAssetImageStatus } from "../lib/asset-image-status";
import type { StoryosContext } from "../lib/workspace-client";
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
  // User-initiated retry. Prompt + name come from the frontend (which
  // already has the record loaded in the panel) — Java doesn't expose
  // a reliable single-asset query endpoint so we avoid that dependency.
  // A fresh timestamped job id bypasses in-flight idempotency.
  registerApiRoute("/assets/:assetType/:assetId/regenerate-image", {
    method: "POST",
    handler: async (c) => {
      const ctx = requireContext(c);
      const assetType = c.req.param("assetType");
      const assetId = c.req.param("assetId");

      if (assetType !== "role" && assetType !== "scene" && assetType !== "prop") {
        throw new HTTPException(400, { message: "assetType must be role / scene / prop" });
      }

      const body = (await c.req.json().catch(() => ({}))) as {
        prompt?: string;
        assetName?: string;
      };
      const prompt = (body.prompt ?? "").trim();
      if (!prompt) {
        throw new HTTPException(400, {
          message: "prompt is required in request body",
        });
      }
      const assetName = (body.assetName ?? "").trim() || assetId;

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
