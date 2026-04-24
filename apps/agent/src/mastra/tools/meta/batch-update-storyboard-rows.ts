/**
 * batch_update_storyboard_rows — apply the same patch to multiple
 * shots in one episode. Same write path as update_storyboard_row
 * (per-cell `/api/user/shotValue/input`), just looped across several
 * shot rows with a single column-ids / shot-list fetch.
 *
 * Designed for conversational bulk edits that are still small enough
 * to stay out of the workflow lane, e.g. "把第 3 集 1-5 镜的景别都改
 * 为特写". Anything bigger (touching the whole episode, cross-episode,
 * or >N shots) should route to invoke_workflow — the supervisor prompt
 * enforces that boundary.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";
import { resolveCharacterIdsByNames, resolveSceneIdByName } from "../../lib/storyboard-ids";
import { publishEntityEvent } from "../../lib/entity-events";

/** Hard cap on shots per call. Beyond this, the supervisor should
 *  suggest a workflow instead (see storyos prompt: threshold trigger). */
const MAX_SHOTS = 30;

const PLAIN_KEYS = [
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

type ShotRow = {
  shotId?: string | number;
  shotValues?: Array<{ presetColumnKey?: string; value?: string }>;
};

export const batchUpdateStoryboardRows = createTool({
  id: "batch_update_storyboard_rows",
  description: `把同一份 patch 套到一集里多个分镜。用户明确说"把第 3 集第 1-5 镜的景别改成特写" / "给第 1 集前三镜都加上杰克" / "把第 2 集第 2、4、6 镜的风格改为写实" 时调。\n\npatch 字段和 update_storyboard_row 一致（scene / characters / description / image_prompt / video_prompt / movement / dialogue / shot_size / perspective / duration / style_planting）。\n\nshotNos 必须是字符串数组（例：["1","2","3"]）。上限 ${MAX_SHOTS} 镜；超过请走 invoke_workflow。shotNo 规则同 update_storyboard_row：优先匹配 shot_no 列值，退化到 1-based 位置。`,
  inputSchema: z.object({
    episodeId: z.string().describe("Java episode id — 从 query_context 拿"),
    shotNos: z
      .array(z.string())
      .min(1)
      .max(MAX_SHOTS)
      .describe(`要改的镜号列表，例：["1","2","3"]。最多 ${MAX_SHOTS} 条。`),
    patch: z
      .object({
        scene: z.string().optional(),
        characters: z.array(z.string()).optional(),
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
      .refine((p) => Object.values(p).some((v) => v !== undefined && v !== ""), {
        message: "patch must include at least one field",
      }),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    message: z.string(),
    perShot: z.array(
      z.object({
        shotNo: z.string(),
        shotId: z.string().optional(),
        updatedFields: z.array(z.string()),
        failedFields: z.array(z.object({ key: z.string(), reason: z.string() })),
      })
    ),
  }),
  execute: async ({ episodeId, shotNos, patch }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);
    const worldId = ctx.worldId ?? "";

    // 1. Column id lookup (once per call).
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

    // 2. Shot list (once per call). Used for shot_no / index fallback.
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

    const findShotId = (shotNo: string): string | null => {
      const trimmed = shotNo.trim();
      const byShotNo = shots.find((shot) => {
        const rowShotNo = String(
          shot.shotValues?.find((v) => v.presetColumnKey === "shot_no")?.value ?? ""
        ).trim();
        return rowShotNo === trimmed;
      });
      if (byShotNo?.shotId != null) return String(byShotNo.shotId);
      const parsed = Number(trimmed);
      if (Number.isInteger(parsed) && parsed >= 1 && parsed <= shots.length) {
        const byIndex = shots[parsed - 1];
        if (byIndex?.shotId != null) return String(byIndex.shotId);
      }
      return null;
    };

    // 3. Shared resolver caches — amortise worldscene / worldrole
    //    lookups across all shots in this call (typical case: same
    //    patch.scene / patch.characters applied to 5-10 shots → 1 list
    //    call, 1 potential create, reused for all).
    const sceneIdCache = new Map<string, string>();
    const roleIdCache = new Map<string, string>();

    // Pre-resolve scene id once if patch.scene is set (avoids the
    // per-shot retry logic even though the cache would do the same).
    let resolvedSceneId: string | null = null;
    if (patch.scene !== undefined && patch.scene !== "") {
      if (!worldId) {
        // fall through — per-shot handler will report the error
      } else {
        try {
          resolvedSceneId = await resolveSceneIdByName(ctx, worldId, patch.scene, sceneIdCache);
        } catch {
          resolvedSceneId = "";
        }
      }
    }

    // Pre-resolve character ids once if patch.characters is set.
    let resolvedCharacterIds: string[] | null = null;
    let characterMissing: string[] = [];
    if (patch.characters !== undefined) {
      if (!worldId && patch.characters.length > 0) {
        // per-shot handler will surface the error
      } else {
        try {
          const { ids, missing } = await resolveCharacterIdsByNames(
            ctx,
            worldId,
            patch.characters,
            roleIdCache
          );
          resolvedCharacterIds = ids;
          characterMissing = missing;
        } catch {
          resolvedCharacterIds = [];
        }
      }
    }

    // 4. Apply per shot.
    const perShot: Array<{
      shotNo: string;
      shotId?: string;
      updatedFields: string[];
      failedFields: Array<{ key: string; reason: string }>;
    }> = [];

    for (const shotNo of shotNos) {
      const shotId = findShotId(shotNo);
      const updatedFields: string[] = [];
      const failedFields: Array<{ key: string; reason: string }> = [];
      if (!shotId) {
        failedFields.push({
          key: "_shot",
          reason:
            shots.length === 0
              ? `episode ${episodeId} has no shots`
              : `shotNo ${shotNo} not found (episode has ${shots.length} shots)`,
        });
        perShot.push({ shotNo, updatedFields, failedFields });
        continue;
      }

      // Plain-text fields.
      for (const key of PLAIN_KEYS) {
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

      // Characters (multi-value). Uses pre-resolved ids + missing list.
      if (patch.characters !== undefined && resolvedCharacterIds !== null) {
        const characterColumnId = columnIdByKey.get("character");
        if (!characterColumnId) {
          failedFields.push({ key: "characters", reason: "column character not found" });
        } else {
          for (const name of characterMissing) {
            failedFields.push({
              key: "characters",
              reason: `worldrole '${name}' not found — create the character first`,
            });
          }
          try {
            await javaRequest(ctx, "/api/user/shotValue/input", {
              data: {
                shotId,
                shotColumnId: characterColumnId,
                value: "",
                values: resolvedCharacterIds,
              },
            });
            if (resolvedCharacterIds.length > 0 || patch.characters.length === 0) {
              updatedFields.push("characters");
            }
          } catch (err) {
            failedFields.push({
              key: "characters",
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }
      } else if (patch.characters !== undefined && !worldId) {
        failedFields.push({ key: "characters", reason: "worldId missing from context" });
      }

      // Scene (single-value + metadata). Uses pre-resolved id.
      if (patch.scene !== undefined && patch.scene !== "") {
        const sceneColumnId = columnIdByKey.get("scene");
        if (!sceneColumnId) {
          failedFields.push({ key: "scene", reason: "column scene not found" });
        } else if (!worldId) {
          failedFields.push({ key: "scene", reason: "worldId missing from context" });
        } else if (!resolvedSceneId) {
          failedFields.push({ key: "scene", reason: "failed to resolve or create scene" });
        } else {
          try {
            // SCENE column is multi-value on Java; scalar `value` is
            // silently dropped. Match persistValueList shape.
            await javaRequest(ctx, "/api/user/shotValue/input", {
              data: {
                shotId,
                shotColumnId: sceneColumnId,
                value: "",
                values: [resolvedSceneId],
                presetColumnKey: "scene",
                sceneId: resolvedSceneId,
                sceneName: patch.scene.trim(),
                worldId,
              },
            });
            updatedFields.push("scene");
          } catch (err) {
            failedFields.push({
              key: "scene",
              reason: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }

      perShot.push({ shotNo, shotId, updatedFields, failedFields });
    }

    const totalUpdated = perShot.filter((p) => p.updatedFields.length > 0).length;
    const totalFailed = perShot.filter((p) => p.failedFields.length > 0).length;
    const ok = totalFailed === 0 && totalUpdated > 0;

    if (totalUpdated > 0) {
      await publishEntityEvent(ctx, {
        entity: "storyboard",
        action: "batch_updated",
        episodeId,
        source: "batch_update_storyboard_rows",
      });
    }

    return {
      ok,
      message: ok
        ? `已更新 ${totalUpdated} 镜`
        : totalFailed > 0
          ? `${totalUpdated}/${shotNos.length} 镜成功，${totalFailed} 镜有失败（详见 perShot.failedFields）`
          : "没有任何字段写入",
      perShot,
    };
  },
});
