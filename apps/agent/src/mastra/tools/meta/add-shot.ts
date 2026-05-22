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
    'Append a new shot (new row) to the end of an episode, optionally pre-populating fields (scene / characters / description / dialogue / image prompt / video prompt / movement / shot size / perspective / duration / style). Call when the user explicitly says e.g. "add a shot at the end of episode 3, scene = café, character = Jack". Scene resolution mirrors update_storyboard_row: reuse an existing scene by name or create one; characters only accept existing worldroles.',
  inputSchema: z.object({
    // Optional — falls back to ctx.episodeId (from <WORKSPACE_CONTEXT>) if
    // the supervisor omits it. When BOTH are missing we return a friendly
    // ok:false instead of letting the schema reject with "episodeId required",
    // because Claude has a habit of emitting `{}` for tool args under load
    // and the schema error sends it into a retry loop.
    episodeId: z
      .string()
      .optional()
      .describe(
        "Java episode id. Optional — if WORKSPACE_CONTEXT has an active episode, it's auto-used. Pass explicitly only when targeting a different episode than the user's current focus."
      ),
    patch: z
      .object({
        scene: z.string().optional().describe("Scene name"),
        characters: z.array(z.string()).optional().describe("Array of character names"),
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
      .describe("Optional initial values. Omit to add a plain empty row."),
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

    // Resolve episodeId from arg → context → friendly error. Without this
    // fallback, Claude emitting `{}` for args triggered a chain of "Required"
    // schema errors and an 8x retry loop (see project_supervisor_context_overflow
    // and the 2026-05-22 incident).
    const effectiveEpisodeId = episodeId ?? ctx.episodeId;
    if (!effectiveEpisodeId) {
      return {
        ok: false,
        message:
          "episodeId is required and not in the workspace context. Ask the user which episode they want to add a shot to (use show_options with the episode list if available), then retry add_shot with that id.",
        updatedFields: [],
        failedFields: [],
      };
    }

    // 1. Create the shot row.
    const createResp = await javaRequest<CreateShotResponse>(ctx, "/api/user/shot/create", {
      data: {
        projectId: ctx.projectId,
        storyBoardId: effectiveEpisodeId,
        enable: true,
      },
    });
    const shotId = extractShotId(createResp);
    if (!shotId) {
      return {
        ok: false,
        message: `Failed to create shot: Java returned no id`,
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
        message: `Added one shot (${shotId})`,
        shotId,
        updatedFields,
        failedFields,
      };
    }

    // 2. Resolve column ids by presetColumnKey for the patch writes.
    const columns = await javaRequest<Array<{ id?: string | number; presetColumnKey?: string }>>(
      ctx,
      "/api/user/shotColumn/list",
      { data: { storyBoardId: effectiveEpisodeId } }
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
      episodeId: effectiveEpisodeId,
      source: "add_shot",
    });
    return {
      ok,
      message: ok
        ? `Added shot ${shotId}; wrote fields: ${updatedFields.join(" / ") || "(none)"}`
        : `Added shot ${shotId}, but some fields failed: ${failedFields.map((f) => f.key).join(", ")}`,
      shotId,
      updatedFields,
      failedFields,
    };
  },
});
