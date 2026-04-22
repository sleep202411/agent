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
    '删除一集分镜表里的某一镜。用户明确说"删掉第 3 集第 5 镜" / "第 1 集的第一镜不要了"时调。不支持批量删除，想批量改动请走 invoke_workflow。',
  inputSchema: z.object({
    episodeId: z.string().describe("Java episode id — 从 query_context 拿"),
    shotNo: z
      .string()
      .describe('镜号字符串，如 "5"。优先匹配 shot_no 列值，其次退化为 1-based 列表位置。'),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    message: z.string(),
    deletedShotId: z.string().optional(),
  }),
  execute: async ({ episodeId, shotNo }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);

    type ShotRow = {
      shotId?: string | number;
      shotValues?: Array<{ presetColumnKey?: string; value?: string }>;
    };
    const resp = await javaRequest<{ list?: ShotRow[] }>(ctx, "/api/user/shot/queryPage", {
      data: {
        storyBoardId: episodeId,
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
            ? `episode ${episodeId} 还没有分镜`
            : `未找到 episode ${episodeId} 的第 ${shotNo} 镜（该集共 ${shots.length} 镜）`,
      };
    }

    const shotId = String(target.shotId);
    try {
      await javaRequest(ctx, `/api/user/shot/delete/${encodeURIComponent(shotId)}`);
      await publishEntityEvent(ctx, {
        entity: "storyboard",
        action: "updated",
        episodeId,
        source: "delete_shot",
      });
      return {
        ok: true,
        message: `已删除第 ${shotNo} 镜`,
        deletedShotId: shotId,
      };
    } catch (err) {
      return {
        ok: false,
        message: `删除失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});
