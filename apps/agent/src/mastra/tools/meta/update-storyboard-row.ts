/**
 * update_storyboard_row — patch one or more fields of a single shot in an
 * episode's storyboard. Same write path the frontend editor uses
 * (`/api/user/shotValue/input` per cell), so values land where the Tiptap
 * editor reads them.
 *
 * Scope is single-shot / few-field. Batch rewrites stay in workflows
 * (script_edit / storyboard_phase) so there's HITL review of ~30 changes
 * at once.
 *
 * Scene column intentionally excluded — it stores worldscene IDs, not
 * names, and requires the sceneId cache + create-if-missing path.
 * Changing a scene assignment is rare; users can do it in the UI.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";

/**
 * Which shot column keys the LLM is allowed to patch. Keep in sync with
 * STORYBOARD_HEADERS in workflows/phases/storyboard-phase.ts (minus scene,
 * which is special, and shot_no, which is auto-generated).
 */
const PATCHABLE_KEYS = [
  "description",
  "image_prompt",
  "video_prompt",
  "movement",
  "dialogue",
  "shot_size",
  "perspective",
  "duration",
  "style_planting",
] as const;

type PatchKey = (typeof PATCHABLE_KEYS)[number];

export const updateStoryboardRow = createTool({
  id: "update_storyboard_row",
  description:
    '改一集分镜表里某一镜的字段（描述 / 对白 / 图提 / 视频提 / 运镜 / 景别 / 视角 / 时长）。用户明确说"第 N 集第 M 镜的对白改为 xxx" / "把第 3 集第 7 镜的景别换成特写"时调。批量改整集/多集请用 invoke_workflow("script_edit") 或重跑 storyboard_phase。**不支持**改场景（scene 要绑 worldscene id，去前端改）。',
  inputSchema: z.object({
    episodeId: z.string().describe("Java episode id — 从 query_context 拿"),
    shotNo: z.string().describe('镜号字符串，如 "5"（对应表里第 5 行）'),
    patch: z
      .object({
        description: z.string().optional().describe("画面描述"),
        image_prompt: z.string().optional().describe("图片提示词"),
        video_prompt: z.string().optional().describe("视频提示词"),
        movement: z.string().optional().describe("运镜"),
        dialogue: z.string().optional().describe("对白 / 旁白"),
        shot_size: z.string().optional().describe("景别"),
        perspective: z.string().optional().describe("视角"),
        duration: z.coerce.number().optional().describe("时长（秒）"),
        style_planting: z.string().optional().describe("风格"),
      })
      .refine((p) => Object.values(p).some((v) => v !== undefined && v !== ""), {
        message: "patch 至少要提供一个字段",
      }),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    message: z.string(),
    updatedFields: z.array(z.string()),
    failedFields: z.array(z.object({ key: z.string(), reason: z.string() })),
  }),
  execute: async ({ episodeId, shotNo, patch }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);

    // 1. Resolve column ids by presetColumnKey.
    const columns = await javaRequest<Array<{ id?: string | number; presetColumnKey?: string }>>(
      ctx,
      "/api/user/shotColumn/list",
      { data: { storyBoardId: episodeId } }
    );
    const columnIdByKey = new Map<string, string>();
    for (const col of columns ?? []) {
      if (typeof col.presetColumnKey === "string" && col.id != null) {
        columnIdByKey.set(col.presetColumnKey, String(col.id));
      }
    }

    // 2. Find the shot by shot_no.
    type ShotRow = {
      shotId?: string | number;
      shotValues?: Array<{ presetColumnKey?: string; value?: string }>;
    };
    const shotsResp = await javaRequest<{ list?: ShotRow[] }>(ctx, "/api/user/shot/queryPage", {
      data: {
        storyBoardId: episodeId,
        page: 1,
        pageSize: 999,
        shotIds: [],
        presetColumnKeys: [],
      },
    });
    const targetShot = (shotsResp.list ?? []).find((shot) => {
      const rowShotNo = String(
        shot.shotValues?.find((v) => v.presetColumnKey === "shot_no")?.value ?? ""
      ).trim();
      return rowShotNo === shotNo.trim();
    });
    if (!targetShot?.shotId) {
      return {
        ok: false,
        message: `未找到 episode ${episodeId} 的第 ${shotNo} 镜`,
        updatedFields: [],
        failedFields: [],
      };
    }
    const shotId = String(targetShot.shotId);

    // 3. Write each patched field via shotValue/input.
    const updatedFields: string[] = [];
    const failedFields: Array<{ key: string; reason: string }> = [];
    for (const key of PATCHABLE_KEYS) {
      const raw = (patch as Record<string, unknown>)[key];
      if (raw === undefined || raw === "") continue;
      const columnId = columnIdByKey.get(key);
      if (!columnId) {
        failedFields.push({ key, reason: `column ${key} not found` });
        continue;
      }
      try {
        await javaRequest(ctx, "/api/user/shotValue/input", {
          data: {
            shotId,
            shotColumnId: columnId,
            value: String(raw),
            presetColumnKey: key,
          },
        });
        updatedFields.push(key);
      } catch (err) {
        failedFields.push({
          key,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const ok = failedFields.length === 0 && updatedFields.length > 0;
    return {
      ok,
      message: ok
        ? `已更新第 ${shotNo} 镜的 ${updatedFields.join(" / ")} 字段`
        : failedFields.length > 0
          ? `部分字段失败：${failedFields.map((f) => f.key).join(", ")}`
          : "patch 里没有要写入的字段",
      updatedFields,
      failedFields,
    };
  },
});

// Only referenced so future extensions know the canonical key list.
export const _PATCHABLE_STORYBOARD_KEYS = PATCHABLE_KEYS satisfies readonly PatchKey[];
