/**
 * batch_create_character / batch_create_scene / batch_create_prop —
 * direct-commit batch tools. Called when the user has already confirmed
 * (e.g. clicked a "仅保存" generative-UI button) and we just need to
 * persist N LLM-proposed items into Java. No draft gate, no workflow
 * suspend — unlike `batch_create_asset` which is for "propose → user
 * reviews drafts → approve" flows.
 *
 * Implementation wraps the existing `batchUpsert{Roles,Scenes,Props}`
 * writers. On success publishes a `batch_created` entity event so the
 * frontend refetches + lights the sidebar red-dot indicator.
 */
import { randomUUID } from "node:crypto";
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext } from "../../lib/workspace-client";
import {
  batchUpsertProps,
  batchUpsertRoles,
  batchUpsertScenes,
  type PropCreateData,
  type RoleCreateData,
  type SceneCreateData,
} from "../../lib/batch-writers/world-assets";
import { publishEntityEvent } from "../../lib/entity-events";
import type { EntityType } from "@repo/shared/entity-events";

const ItemSchema = z.object({
  name: z.string().min(1).max(50).describe("Name"),
  description: z.string().optional().describe("Brief / setting description"),
  prompt: z.string().optional().describe("Image prompt — falls back to description if omitted"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(50).describe("Assets to create"),
});

const OutputSchema = z.object({
  ok: z.boolean(),
  created: z
    .array(z.object({ name: z.string(), id: z.string() }))
    .describe("Items that landed in the DB (name echoed verbatim, id assigned by Java)"),
  failed: z.array(z.object({ name: z.string(), reason: z.string() })),
  message: z.string(),
});

type Item = z.infer<typeof ItemSchema>;

type AssetKind = "role" | "scene" | "prop";

const UI_ENTITY: Record<AssetKind, EntityType> = {
  role: "character",
  scene: "scene",
  prop: "prop",
};

const ASSET_LABEL: Record<AssetKind, string> = {
  role: "characters",
  scene: "scenes",
  prop: "props",
};

function buildRoleData(worldId: string, item: Item): RoleCreateData {
  return {
    worldId,
    name: item.name,
    description: item.description ?? "",
    prompt: item.prompt ?? item.description ?? "",
    roleImgPath: [],
    referenceImgPath: [],
    referenceImgDescription: [],
    model: "",
    voiceId: "",
  };
}

function buildSceneData(worldId: string, item: Item): SceneCreateData {
  return {
    worldId,
    name: item.name,
    description: item.description ?? "",
    prompt: item.prompt ?? item.description ?? "",
  };
}

function buildPropData(worldId: string, item: Item): PropCreateData {
  return {
    worldId,
    name: item.name,
    description: item.description ?? "",
    prompt: item.prompt ?? item.description ?? "",
  };
}

async function runBatch(
  kind: AssetKind,
  items: Item[],
  toolId: string,
  execCtx: { requestContext?: unknown } | undefined
): Promise<z.infer<typeof OutputSchema>> {
  const ctx = getContext(
    (execCtx?.requestContext ?? undefined) as Parameters<typeof getContext>[0]
  );
  const worldId = ctx.worldId ?? "";
  if (!worldId) {
    return {
      ok: false,
      created: [],
      failed: items.map((it) => ({ name: it.name, reason: "worldId missing from context" })),
      message: "This project is missing worldId — cannot commit assets.",
    };
  }

  const refMap = new Map<string, string>(); // clientRefId → name
  const buildItem = (it: Item) => {
    const clientRefId = randomUUID();
    refMap.set(clientRefId, it.name);
    const data =
      kind === "role"
        ? buildRoleData(worldId, it)
        : kind === "scene"
          ? buildSceneData(worldId, it)
          : buildPropData(worldId, it);
    return { clientRefId, data };
  };

  const results =
    kind === "role"
      ? await batchUpsertRoles(
          ctx,
          items.map(buildItem) as { clientRefId: string; data: RoleCreateData }[],
          { concurrency: 1 }
        )
      : kind === "scene"
        ? await batchUpsertScenes(
            ctx,
            items.map(buildItem) as { clientRefId: string; data: SceneCreateData }[],
            { concurrency: 1 }
          )
        : await batchUpsertProps(
            ctx,
            items.map(buildItem) as { clientRefId: string; data: PropCreateData }[],
            { concurrency: 1 }
          );

  const created: { name: string; id: string }[] = [];
  const failed: { name: string; reason: string }[] = [];
  for (const r of results) {
    const name = refMap.get(r.clientRefId) ?? r.clientRefId;
    if ((r.status === "created" || r.status === "unchanged") && r.serverId) {
      created.push({ name, id: r.serverId });
    } else {
      failed.push({ name, reason: r.error ?? "unknown" });
    }
  }

  if (created.length > 0) {
    await publishEntityEvent(ctx, {
      entity: UI_ENTITY[kind],
      action: "batch_created",
      source: toolId,
    });
  }

  const label = ASSET_LABEL[kind];
  return {
    ok: failed.length === 0,
    created,
    failed,
    message:
      failed.length === 0
        ? `Saved ${created.length} ${label}.`
        : `Saved ${created.length}, failed ${failed.length}: ${failed.map((f) => `${f.name} (${f.reason})`).join("; ")}`,
  };
}

export const batchCreateCharacter = createTool({
  id: "batch_create_character",
  description:
    'Batch-create characters (worldrole) in the current project — direct write, no user confirmation needed. Use when the user has already confirmed they want to save these N new characters — typical trigger: user clicked the "save only" button and the supervisor applies the resulting action. For propose-and-review flows ("design a batch of characters for me to review"), call `ask_character_designer` first to draft, surface the drafts to the user, then call this tool once they confirm.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ items }, execCtx) => runBatch("role", items, "batch_create_character", execCtx),
});

export const batchCreateScene = createTool({
  id: "batch_create_scene",
  description:
    "Batch-create scenes (worldscene) in the current project — direct write, no user confirmation needed. Same usage as batch_create_character, but for scenes.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ items }, execCtx) => runBatch("scene", items, "batch_create_scene", execCtx),
});

export const batchCreateProp = createTool({
  id: "batch_create_prop",
  description:
    "Batch-create props (worldprop) in the current project — direct write, no user confirmation needed. Same usage as batch_create_character, but for props.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ items }, execCtx) => runBatch("prop", items, "batch_create_prop", execCtx),
});
