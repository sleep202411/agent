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
    '更新单集的标题 / 简介 / 前后缀 prompt。用户明确说"第 N 集标题改为 xxx"、"第 N 集简介补一句 yyy" 时调。批量改多集请用 invoke_workflow("episode_phase") 重新跑。episodeId 从 query_context(summary) 的 episodes 字段拿。',
  inputSchema: z.object({
    episodeId: z.string().describe("Java episode id"),
    title: z.string().optional(),
    introduction: z.string().optional(),
    frontPrompt: z.string().optional().describe("每镜图片/视频提示词前缀"),
    behindPrompt: z.string().optional().describe("每镜图片/视频提示词后缀"),
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
    '删除一集。用户明确说"删第 N 集 / 去掉第 N 集 / 把第 N 集从项目里移除"时调。**无撤销**，调之前确保用户明确说了要删。episodeId 从 query_context 拿。',
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
