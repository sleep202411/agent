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
 * Scene assignment is supported here too: the LLM passes a scene name,
 * we resolve it against the world's existing worldscenes, create a new
 * one if needed, then write the numeric sceneId plus the name/worldId
 * metadata that the Tiptap chip renderer expects.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";
import { resolveCharacterIdsByNames, resolveSceneIdByName } from "../../lib/storyboard-ids";

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
    '改一集分镜表里某一镜的字段（场景 / 角色 / 描述 / 对白 / 图提 / 视频提 / 运镜 / 景别 / 视角 / 时长 / 风格）。用户明确说"第 N 集第 M 镜的对白改为 xxx" / "把第 1 镜的场景设为咖啡馆" / "把第 3 镜加上杰克和李娜两个角色"时调。scene 传场景名——已存在的直接绑定，不存在的自动新建。characters 传角色名数组——只接受已存在的 worldrole。批量改整集/多集请用 invoke_workflow。',
  inputSchema: z.object({
    episodeId: z.string().describe("Java episode id — 从 query_context 拿"),
    shotNo: z
      .string()
      .describe(
        '镜号字符串，如 "5"。优先匹配 shot_no 列值；若该列尚未写入（新建集），退化为 1-based 列表位置——"1" 就是第一行。'
      ),
    patch: z
      .object({
        scene: z
          .string()
          .optional()
          .describe("场景名（例：咖啡馆）。已存在的复用，不存在的自动新建"),
        characters: z
          .array(z.string())
          .optional()
          .describe(
            "角色名数组（例：['杰克', '李娜']）。只接受已存在的 worldrole；找不到的会在 failedFields 里告诉你。传空数组表示清空"
          ),
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
      .refine(
        (p) =>
          Object.entries(p).some(
            ([, v]) => v !== undefined && v !== "" && (Array.isArray(v) ? v.length >= 0 : true)
          ),
        {
          message: "patch 至少要提供一个字段",
        }
      ),
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

    // 2. Find the shot. Prefer matching the `shot_no` preset column's
    //    value (that's what the user types — "第 5 镜"), then fall back
    //    to 1-based list position when `shot_no` hasn't been written yet
    //    (e.g. a fresh episode whose shots were seeded but no column
    //    values populated). Java returns shots already sorted by `sort`,
    //    so the list order matches the on-screen order.
    type ShotRow = {
      shotId?: string | number;
      sort?: number;
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
    const shots = shotsResp.list ?? [];
    const trimmedShotNo = shotNo.trim();
    let targetShot = shots.find((shot) => {
      const rowShotNo = String(
        shot.shotValues?.find((v) => v.presetColumnKey === "shot_no")?.value ?? ""
      ).trim();
      return rowShotNo === trimmedShotNo;
    });
    if (!targetShot) {
      const parsedIndex = Number(trimmedShotNo);
      if (Number.isInteger(parsedIndex) && parsedIndex >= 1 && parsedIndex <= shots.length) {
        targetShot = shots[parsedIndex - 1];
      }
    }
    if (!targetShot?.shotId) {
      return {
        ok: false,
        message:
          shots.length === 0
            ? `episode ${episodeId} 还没有分镜，先生成分镜再调这个工具`
            : `未找到 episode ${episodeId} 的第 ${shotNo} 镜（该集共 ${shots.length} 镜）`,
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

    // 4a. Characters — multi-value column. Java's shotValue/input
    //     carries the full id list under `values`, `value` stays "".
    //     Unknown names don't fail the whole call — we surface them
    //     per-missing so the supervisor can report back.
    if (patch.characters !== undefined) {
      const characterColumnId = columnIdByKey.get("character");
      const worldId = ctx.worldId ?? "";
      if (!characterColumnId) {
        failedFields.push({ key: "characters", reason: "column character not found" });
      } else if (!worldId && patch.characters.length > 0) {
        failedFields.push({ key: "characters", reason: "worldId missing from context" });
      } else {
        try {
          const { ids, missing } = await resolveCharacterIdsByNames(ctx, worldId, patch.characters);
          for (const name of missing) {
            failedFields.push({
              key: "characters",
              reason: `worldrole '${name}' not found — create the character first`,
            });
          }
          // Always write, even if empty — lets the caller clear the column.
          await javaRequest(ctx, "/api/user/shotValue/input", {
            data: {
              shotId,
              shotColumnId: characterColumnId,
              value: "",
              values: ids,
            },
          });
          if (ids.length > 0 || patch.characters.length === 0) {
            updatedFields.push("characters");
          }
        } catch (err) {
          failedFields.push({
            key: "characters",
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    // 4b. Scene write (separate from the plain-text loop because it
    //     needs name→id resolution + extra metadata in the payload).
    if (patch.scene !== undefined && patch.scene !== "") {
      const sceneColumnId = columnIdByKey.get("scene");
      const worldId = ctx.worldId ?? "";
      if (!sceneColumnId) {
        failedFields.push({ key: "scene", reason: "column scene not found" });
      } else if (!worldId) {
        failedFields.push({ key: "scene", reason: "worldId missing from context" });
      } else {
        try {
          const sceneId = await resolveSceneIdByName(ctx, worldId, patch.scene);
          if (!sceneId) {
            failedFields.push({ key: "scene", reason: "failed to resolve or create scene" });
          } else {
            // Tiptap chip renderer expects sceneId/sceneName/worldId
            // metadata alongside the plain `value` — mirror what the
            // storyboard-phase backfill writes.
            await javaRequest(ctx, "/api/user/shotValue/input", {
              data: {
                shotId,
                shotColumnId: sceneColumnId,
                value: sceneId,
                presetColumnKey: "scene",
                sceneId,
                sceneName: patch.scene.trim(),
                worldId,
              },
            });
            updatedFields.push("scene");
          }
        } catch (err) {
          failedFields.push({
            key: "scene",
            reason: err instanceof Error ? err.message : String(err),
          });
        }
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
