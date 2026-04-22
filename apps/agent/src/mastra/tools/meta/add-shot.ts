/**
 * add_shot — append a new shot row to an episode's storyboard and
 * optionally fill in initial column values in the same call.
 * Same write path as the frontend toolbar
 * (`POST /api/user/shot/create`) plus per-cell `shotValue/input`
 * writes for any provided patch fields.
 *
 * Scene is auto-resolved (create if not found) mirroring
 * `update_storyboard_row`; characters resolve against existing
 * worldroles and unknown names are surfaced in failedFields.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";
import { resolveCharacterIdsByNames, resolveSceneIdByName } from "../../lib/storyboard-ids";
import { publishEntityEvent } from "../../lib/entity-events";

type CreateShotResponse = { id?: string | number } | string | number | null;

function extractShotId(raw: unknown): string {
  if (typeof raw === "string" || typeof raw === "number") return String(raw);
  if (raw && typeof raw === "object" && "id" in raw) {
    const id = (raw as { id?: string | number }).id;
    if (id != null) return String(id);
  }
  return "";
}

export const addShot = createTool({
  id: "add_shot",
  description:
    '在一集末尾新增一镜（新行），可选填初始字段（场景 / 角色 / 描述 / 对白 / 图提 / 视频提 / 运镜 / 景别 / 视角 / 时长 / 风格）。用户明确说"给第 3 集末尾加一镜，场景设为咖啡馆，角色是杰克"时调。Scene 和 update_storyboard_row 一样，已存在的复用不存在的新建；characters 只接受已存在的 worldrole。',
  inputSchema: z.object({
    episodeId: z.string().describe("Java episode id — 从 query_context 拿"),
    patch: z
      .object({
        scene: z.string().optional().describe("场景名"),
        characters: z.array(z.string()).optional().describe("角色名数组"),
        description: z.string().optional(),
        image_prompt: z.string().optional(),
        video_prompt: z.string().optional(),
        movement: z.string().optional(),
        dialogue: z.string().optional(),
        shot_size: z.string().optional(),
        perspective: z.string().optional(),
        duration: z.coerce.number().optional(),
        style_planting: z.string().optional(),
      })
      .optional()
      .describe("可选初始字段。不传就纯新建一个空行。"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    message: z.string(),
    shotId: z.string().optional(),
    updatedFields: z.array(z.string()),
    failedFields: z.array(z.object({ key: z.string(), reason: z.string() })),
  }),
  execute: async ({ episodeId, patch }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);

    // 1. Create the shot row.
    const createResp = await javaRequest<CreateShotResponse>(ctx, "/api/user/shot/create", {
      data: {
        projectId: ctx.projectId,
        storyBoardId: episodeId,
        enable: true,
      },
    });
    const shotId = extractShotId(createResp);
    if (!shotId) {
      return {
        ok: false,
        message: `创建 shot 失败：Java 未返回 id`,
        updatedFields: [],
        failedFields: [],
      };
    }

    const updatedFields: string[] = [];
    const failedFields: Array<{ key: string; reason: string }> = [];

    // No patch → plain empty row, done.
    if (!patch || Object.values(patch).every((v) => v === undefined || v === "")) {
      return {
        ok: true,
        message: `已新增一镜（${shotId}）`,
        shotId,
        updatedFields,
        failedFields,
      };
    }

    // 2. Resolve column ids by presetColumnKey for the patch writes.
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

    // 3. Plain-text fields.
    const plainKeys = [
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
    for (const key of plainKeys) {
      const raw = (patch as Record<string, unknown>)[key];
      if (raw === undefined || raw === "") continue;
      const columnId = columnIdByKey.get(key);
      if (!columnId) {
        failedFields.push({ key, reason: `column ${key} not found` });
        continue;
      }
      try {
        await javaRequest(ctx, "/api/user/shotValue/input", {
          data: { shotId, shotColumnId: columnId, value: String(raw), presetColumnKey: key },
        });
        updatedFields.push(key);
      } catch (err) {
        failedFields.push({
          key,
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    }

    const worldId = ctx.worldId ?? "";

    // 4. Characters (multi-value).
    if (patch.characters !== undefined) {
      const characterColumnId = columnIdByKey.get("character");
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
          await javaRequest(ctx, "/api/user/shotValue/input", {
            data: { shotId, shotColumnId: characterColumnId, value: "", values: ids },
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

    // 5. Scene (single-value + metadata).
    if (patch.scene !== undefined && patch.scene !== "") {
      const sceneColumnId = columnIdByKey.get("scene");
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
            // SCENE column is multi-value on Java; scalar `value` is
            // silently dropped. Match the frontend persistValueList shape.
            await javaRequest(ctx, "/api/user/shotValue/input", {
              data: {
                shotId,
                shotColumnId: sceneColumnId,
                value: "",
                values: [sceneId],
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

    const ok = failedFields.length === 0;
    await publishEntityEvent(ctx, {
      entity: "storyboard",
      action: "updated",
      episodeId,
      source: "add_shot",
    });
    return {
      ok,
      message: ok
        ? `已新增一镜（${shotId}），写入字段：${updatedFields.join(" / ") || "无"}`
        : `已新增一镜（${shotId}），但部分字段失败：${failedFields.map((f) => f.key).join(", ")}`,
      shotId,
      updatedFields,
      failedFields,
    };
  },
});
