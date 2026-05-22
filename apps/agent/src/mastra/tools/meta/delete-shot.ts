/**
 * delete_shot — remove one shot row from an episode's storyboard.
 * Same write path the frontend toolbar uses
 * (`POST /api/user/shot/delete/:shotId`).
 *
 * Uses the same shot lookup rules as `update_storyboard_row`: prefer
 * matching the `shot_no` column value, fall back to 1-based list
 * position when `shot_no` hasn't been written yet.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";
import { publishEntityEvent } from "../../lib/entity-events";

export const deleteShot = createTool({
  id: "delete_shot",
  description:
    'Delete one shot row from an episode\'s storyboard. Call when the user explicitly says "delete shot 5 of episode 3" / "drop the first shot of episode 1". No batch delete — for bulk changes, route to invoke_workflow.',
  inputSchema: z.object({
    // Optional — falls back to ctx.episodeId (from <WORKSPACE_CONTEXT>) if
    // omitted. See add-shot.ts header for full rationale.
    episodeId: z
      .string()
      .optional()
      .describe(
        "Java episode id. Optional — auto-resolved from WORKSPACE_CONTEXT if the user is currently editing an episode."
      ),
    shotNo: z
      .string()
      .describe(
        'Shot number as a string, e.g. "5". Prefers matching the shot_no column value, falls back to 1-based list position.'
      ),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    message: z.string(),
    deletedShotId: z.string().optional(),
  }),
  execute: async ({ episodeId, shotNo }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);

    const effectiveEpisodeId = episodeId ?? ctx.episodeId;
    if (!effectiveEpisodeId) {
      return {
        ok: false,
        message:
          "episodeId is required and not in the workspace context. Ask the user which episode this shot belongs to before deleting.",
      };
    }

    type ShotRow = {
      shotId?: string | number;
      shotValues?: Array<{ presetColumnKey?: string; value?: string }>;
    };
    const resp = await javaRequest<{ list?: ShotRow[] }>(ctx, "/api/user/shot/queryPage", {
      data: {
        storyBoardId: effectiveEpisodeId,
        page: 1,
        pageSize: 999,
        shotIds: [],
        presetColumnKeys: [],
      },
    });
    const shots = resp.list ?? [];
    const trimmed = shotNo.trim();
    let target = shots.find((shot) => {
      const rowShotNo = String(
        shot.shotValues?.find((v) => v.presetColumnKey === "shot_no")?.value ?? ""
      ).trim();
      return rowShotNo === trimmed;
    });
    if (!target) {
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= shots.length) {
        target = shots[parsed - 1];
      }
    }
    if (!target?.shotId) {
      return {
        ok: false,
        message:
          shots.length === 0
            ? `Episode ${effectiveEpisodeId} has no shots yet`
            : `Shot ${shotNo} not found in episode ${effectiveEpisodeId} (episode has ${shots.length} shots)`,
      };
    }

    const shotId = String(target.shotId);
    try {
      await javaRequest(ctx, `/api/user/shot/delete/${encodeURIComponent(shotId)}`);
      await publishEntityEvent(ctx, {
        entity: "storyboard",
        action: "updated",
        episodeId: effectiveEpisodeId,
        source: "delete_shot",
      });
      return {
        ok: true,
        message: `Deleted shot ${shotNo}`,
        deletedShotId: shotId,
      };
    } catch (err) {
      return {
        ok: false,
        message: `Delete failed: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
