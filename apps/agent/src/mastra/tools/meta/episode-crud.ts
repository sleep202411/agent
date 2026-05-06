/**
 * Single-episode CRUD — the historical `update_episode` / `delete_episode`
 * flat tools restored.
 *
 * Scope is intentionally narrow: 1 episode at a time. Batch operations
 * (reorder, mass-rename, bulk delete) stay in workflows so the user can
 * HITL-review before committing.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";
import { publishEntityEvent } from "../../lib/entity-events";

// ─── update_episode ────────────────────────────────────────────────────

/**
 * Java's `/api/user/world/update/episode` is a full-replacement write —
 * must re-fetch the existing episode and merge the patch on top. We list
 * episodes first (cheap paged call) to find the one we're touching.
 */
export const updateEpisode = createTool({
  id: "update_episode",
  description:
    'Update one episode\'s title / synopsis / per-shot prompt prefix or suffix. Call when the user explicitly says "rename episode N to X" or "add Y to the episode N synopsis". For **creating** new episodes, use `batch_create_episode`. Get episodeId from query_context(summary).episodes.',
  inputSchema: z.object({
    episodeId: z.string().describe("Java episode id"),
    title: z.string().optional(),
    introduction: z.string().optional(),
    frontPrompt: z
      .string()
      .optional()
      .describe("Prefix prepended to every shot's image/video prompt"),
    behindPrompt: z
      .string()
      .optional()
      .describe("Suffix appended to every shot's image/video prompt"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ episodeId, title, introduction, frontPrompt, behindPrompt }, execCtx) => {
    if (!title && !introduction && !frontPrompt && !behindPrompt) {
      return {
        ok: false,
        message: "Provide at least one field: title / introduction / frontPrompt / behindPrompt",
      };
    }
    const ctx = getContext(execCtx?.requestContext);
    const listed = await javaRequest<{
      list?: Array<Record<string, unknown>>;
    }>(ctx, "/api/user/world/list/episode", {
      data: { productId: ctx.projectId, page: 1, pageSize: 999 },
    });
    const current = (listed.list ?? []).find((ep) => String(ep.id) === episodeId);
    if (!current) return { ok: false, message: `Episode ${episodeId} not found` };
    await javaRequest(ctx, "/api/user/world/update/episode", {
      data: {
        ...current,
        id: episodeId,
        projectId: ctx.projectId,
        ...(title !== undefined ? { title } : {}),
        ...(introduction !== undefined ? { introduction } : {}),
        ...(frontPrompt !== undefined ? { frontPrompt } : {}),
        ...(behindPrompt !== undefined ? { behindPrompt } : {}),
      },
    });
    await publishEntityEvent(ctx, {
      entity: "episode",
      action: "updated",
      id: episodeId,
      episodeId,
      source: "update_episode",
    });
    return {
      ok: true,
      message: `Updated episode "${String(current.title ?? episodeId)}"`,
    };
  },
});

// ─── delete_episode ────────────────────────────────────────────────────

export const deleteEpisode = createTool({
  id: "delete_episode",
  description:
    'Delete one episode. Call when the user explicitly says "delete episode N" / "remove episode N" / "drop episode N from the project". **No undo** — only call after the user clearly confirmed deletion. Get episodeId from query_context.',
  inputSchema: z.object({
    episodeId: z.string().describe("Java episode id"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ episodeId }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);
    await javaRequest(ctx, `/api/user/world/delete/episode?id=${encodeURIComponent(episodeId)}`);
    await publishEntityEvent(ctx, {
      entity: "episode",
      action: "deleted",
      id: episodeId,
      episodeId,
      source: "delete_episode",
    });
    return { ok: true, message: `Deleted episode ${episodeId}` };
  },
});
