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
import { publishEntityEvent } from "../../lib/entity-events";

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
    'Patch one or more fields of a single shot in an episode\'s storyboard (scene / characters / description / dialogue / image prompt / video prompt / movement / shot size / perspective / duration / style). Call when the user explicitly says e.g. "change the dialogue of episode N shot M to X" / "set the scene of shot 1 to café" / "add Jack and Lina to shot 3". Pass scene as a name — existing scenes are reused, new names are auto-created. Pass characters as an array of names — only existing worldroles are accepted. For bulk changes across an episode, use `batch_update_storyboard_rows` instead.',
  inputSchema: z.object({
    episodeId: z.string().describe("Java episode id — get from query_context"),
    shotNo: z
      .string()
      .describe(
        'Shot number as a string, e.g. "5". Prefers matching the shot_no column value; if shot_no has not been populated yet (fresh episode), falls back to 1-based list position — "1" is the first row.'
      ),
    patch: z
      .object({
        scene: z
          .string()
          .optional()
          .describe(
            "Scene name (e.g. 'café'). Reuses an existing scene by name, or creates a new one"
          ),
        characters: z
          .array(z.string())
          .optional()
          .describe(
            "Array of character names (e.g. ['Jack', 'Lina']). Only accepts existing worldroles; missing ones are reported in failedFields. Pass an empty array to clear the column."
          ),
        description: z.string().optional().describe("Shot description"),
        image_prompt: z.string().optional().describe("Image prompt"),
        video_prompt: z.string().optional().describe("Video prompt"),
        movement: z.string().optional().describe("Camera movement"),
        dialogue: z.string().optional().describe("Dialogue / voiceover"),
        shot_size: z.string().optional().describe("Shot size"),
        perspective: z.string().optional().describe("Perspective / angle"),
        duration: z.coerce.number().optional().describe("Duration (seconds)"),
        style_planting: z.string().optional().describe("Style"),
      })
      .refine(
        (p) =>
          Object.entries(p).some(
            ([, v]) => v !== undefined && v !== "" && (Array.isArray(v) ? v.length >= 0 : true)
          ),
        {
          message: "patch must include at least one field",
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
            ? `Episode ${episodeId} has no shots yet — generate the storyboard first before calling this tool`
            : `Shot ${shotNo} not found in episode ${episodeId} (episode has ${shots.length} shots)`,
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
            // Java treats SCENE as a multi-value column — it silently
            // ignores the scalar `value` and only persists the `values`
            // array. Matches the frontend's persistValueList shape in
            // `cell-utils.ts`.
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

    const ok = failedFields.length === 0 && updatedFields.length > 0;
    if (updatedFields.length > 0) {
      await publishEntityEvent(ctx, {
        entity: "storyboard",
        action: "updated",
        episodeId,
        source: "update_storyboard_row",
      });
    }
    return {
      ok,
      message: ok
        ? `Updated shot ${shotNo}: ${updatedFields.join(" / ")}`
        : failedFields.length > 0
          ? `Some fields failed: ${failedFields.map((f) => f.key).join(", ")}`
          : "patch contained no fields to write",
      updatedFields,
      failedFields,
    };
  },
});

// Only referenced so future extensions know the canonical key list.
export const _PATCHABLE_STORYBOARD_KEYS = PATCHABLE_KEYS satisfies readonly PatchKey[];
