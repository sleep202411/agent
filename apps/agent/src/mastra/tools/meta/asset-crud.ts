/**
 * Single-asset CRUD for character / scene / prop — mirrors the
 * `update_episode` / `delete_episode` shape over in `episode-crud.ts`.
 *
 * The Java endpoints `/api/user/world/{update,delete}/{worldrole,worldscene,worldprop}`
 * are full-replacement writes (web admin panels POST the entire row
 * back), so each `update_*` tool here:
 *   1. Lists assets of the right kind for the current world,
 *   2. Finds the row by id,
 *   3. Merges the user-provided patch on top, and
 *   4. POSTs the merged record back.
 *
 * Batch creation already lives in `batch-create-assets.ts`. The
 * intentional split: batch-create for new rows the supervisor wants to
 * accept en bloc; this file for "rename / re-prompt / drop one" edits
 * the user can request in plain language.
 *
 * Scope is narrow on purpose. We only let the supervisor change the
 * fields a chat conversation can plausibly produce — name, description,
 * image prompt. Visual references (avatar / cover / multi-angle sheet)
 * stay manual through the UI panels because chat lacks the upload
 * affordance.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest } from "../../lib/workspace-client";
import { publishEntityEvent } from "../../lib/entity-events";
import type { EntityType } from "@repo/shared/entity-events";

interface AssetSpec {
  /** Java table name suffix used in the URL paths. */
  table: "worldrole" | "worldscene" | "worldprop";
  /** Entity name for publishEntityEvent. */
  entity: Extract<EntityType, "character" | "scene" | "prop">;
  /** Human label for log lines / success messages. */
  human: string;
}

const SPECS: Record<"character" | "scene" | "prop", AssetSpec> = {
  character: { table: "worldrole", entity: "character", human: "character" },
  scene: { table: "worldscene", entity: "scene", human: "scene" },
  prop: { table: "worldprop", entity: "prop", human: "prop" },
};

/**
 * Resolve a worldId to scope the listing query. Java's `list/world*`
 * endpoints want either `worldId` or fall back to whatever the cookie
 * resolves to; passing an explicit one is the safer path because a
 * single user can have multiple active worlds.
 */
function resolveWorldId(
  ctxWorldId: string | undefined,
  patchWorldId: string | undefined
): string | undefined {
  return patchWorldId?.trim() || ctxWorldId?.trim() || undefined;
}

interface JavaListResponse {
  list?: Array<Record<string, unknown>>;
}

async function fetchAsset(
  ctx: ReturnType<typeof getContext>,
  spec: AssetSpec,
  id: string,
  worldId: string | undefined
): Promise<Record<string, unknown> | null> {
  const listed = await javaRequest<JavaListResponse>(ctx, `/api/user/world/list/${spec.table}`, {
    data: { worldId, page: 1, pageSize: 999 },
  });
  return (listed.list ?? []).find((row) => String(row.id) === id) ?? null;
}

function buildUpdateTool(kind: "character" | "scene" | "prop") {
  const spec = SPECS[kind];
  return createTool({
    id: `update_${kind}`,
    description: `Update one ${spec.human}'s name / description / image prompt. Call when the user explicitly says "rename ${spec.human} X to Y", "change ${spec.human} X's description to ...", "${spec.human} X needs a new image prompt: ...". For batch creation use \`batch_create_${kind}\`. For deletion use \`delete_${kind}\`. Get the id from \`list_assets({assetType:"${kind}"})\` or \`query_context\`. Only the four exposed fields are editable — visual references (avatars / cover sheets) stay manual through the UI panel.`,
    inputSchema: z.object({
      id: z.string().describe(`Java ${spec.table} id`),
      name: z.string().min(1).optional().describe(`New ${spec.human} name`),
      description: z.string().min(1).optional().describe(`New narrative description`),
      prompt: z.string().min(1).optional().describe(`New visual-generation prompt`),
      worldId: z
        .string()
        .optional()
        .describe(
          "World scope — defaults to the request context's worldId; pass when the supervisor knows the row lives in a different world."
        ),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      message: z.string(),
    }),
    execute: async ({ id, name, description, prompt, worldId: patchWorldId }, execCtx) => {
      if (name === undefined && description === undefined && prompt === undefined) {
        return {
          ok: false,
          message: "Provide at least one field: name / description / prompt",
        };
      }
      const ctx = getContext(execCtx?.requestContext);
      const worldId = resolveWorldId(ctx.worldId, patchWorldId);
      const current = await fetchAsset(ctx, spec, id, worldId);
      if (!current) return { ok: false, message: `${spec.human} ${id} not found` };
      await javaRequest(ctx, `/api/user/world/update/${spec.table}`, {
        data: {
          ...current,
          id,
          ...(worldId ? { worldId } : {}),
          ...(name !== undefined ? { name } : {}),
          ...(description !== undefined ? { description } : {}),
          ...(prompt !== undefined ? { prompt } : {}),
        },
      });
      await publishEntityEvent(ctx, {
        entity: spec.entity,
        action: "updated",
        id,
        source: `update_${kind}`,
      });
      return {
        ok: true,
        message: `Updated ${spec.human} "${String(current.name ?? id)}"`,
      };
    },
  });
}

function buildDeleteTool(kind: "character" | "scene" | "prop") {
  const spec = SPECS[kind];
  return createTool({
    id: `delete_${kind}`,
    description: `Delete one ${spec.human}. Call when the user explicitly says "delete ${spec.human} X" / "remove ${spec.human} X" / "drop ${spec.human} X". **No undo** — only call after the user clearly confirmed deletion. Get the id from \`list_assets({assetType:"${kind}"})\` or \`query_context\`.`,
    inputSchema: z.object({
      id: z.string().describe(`Java ${spec.table} id`),
    }),
    outputSchema: z.object({
      ok: z.boolean(),
      message: z.string(),
    }),
    execute: async ({ id }, execCtx) => {
      const ctx = getContext(execCtx?.requestContext);
      await javaRequest(ctx, `/api/user/world/delete/${spec.table}?id=${encodeURIComponent(id)}`);
      await publishEntityEvent(ctx, {
        entity: spec.entity,
        action: "deleted",
        id,
        source: `delete_${kind}`,
      });
      return { ok: true, message: `Deleted ${spec.human} ${id}` };
    },
  });
}

export const updateCharacter = buildUpdateTool("character");
export const deleteCharacter = buildDeleteTool("character");
export const updateScene = buildUpdateTool("scene");
export const deleteScene = buildDeleteTool("scene");
export const updateProp = buildUpdateTool("prop");
export const deleteProp = buildDeleteTool("prop");

// ─── delete_episode_script ─────────────────────────────────────────────
//
// Java doesn't expose a dedicated "delete script" endpoint — scripts are
// only writable through the same `createOrUpdate` path used by saves. To
// give the supervisor an explicit "wipe this episode's script body" tool
// we just POST an empty `content`. The episode row itself stays put;
// only the script payload is cleared.
//
// Note: deleting the EPISODE (`delete_episode`) cascades the script
// deletion server-side — this tool is for the rarer "keep the episode
// but drop its script" intent.

export const deleteEpisodeScript = createTool({
  id: "delete_episode_script",
  description:
    'Clear one episode\'s script body while keeping the episode row intact. Call when the user explicitly says "清空第N集的剧本 / drop the script for episode N / 重新写第N集" (paired with a follow-up `ask_scriptwriter`). For full episode deletion use `delete_episode` (which cascades the script). **No undo** — only after explicit user confirmation.',
  inputSchema: z.object({
    episodeId: z.string().describe("Java episode id"),
  }),
  outputSchema: z.object({
    ok: z.boolean(),
    message: z.string(),
  }),
  execute: async ({ episodeId }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);
    try {
      await javaRequest<unknown>(ctx, "/api/user/project/scripts/episode/createOrUpdate", {
        data: { episodeId, content: "" },
        timeoutMs: 60_000,
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        message: `Java write failed: ${reason}`,
      };
    }
    await publishEntityEvent(ctx, {
      entity: "script",
      action: "deleted",
      id: episodeId,
      episodeId,
      source: "delete_episode_script",
    });
    return {
      ok: true,
      message: `Cleared script for episode ${episodeId}`,
    };
  },
});
