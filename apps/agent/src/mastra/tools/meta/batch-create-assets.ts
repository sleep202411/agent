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
  name: z.string().min(1).max(50).describe("名称"),
  description: z.string().optional().describe("简介 / 设定"),
  prompt: z.string().optional().describe("图像提示词 — 不传则用 description"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(50).describe("要创建的资产列表"),
});

const OutputSchema = z.object({
  ok: z.boolean(),
  created: z
    .array(z.object({ name: z.string(), id: z.string() }))
    .describe("成功入库的条目（name 原样回显，id 为 Java 分配）"),
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
    '批量创建角色（worldrole）到当前项目，直接写入无需用户确认。用在"用户已经确认要保存这 N 个新角色"的场景 —— 典型触发：用户点击了"仅保存"按钮后，supervisor 应用该 action。对"帮我设计一批角色供我审查"这种提议类场景，用 invoke_workflow: role_design 而不是这个工具。',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ items }, execCtx) => runBatch("role", items, "batch_create_character", execCtx),
});

export const batchCreateScene = createTool({
  id: "batch_create_scene",
  description:
    "批量创建场景（worldscene）到当前项目，直接写入无需用户确认。用法同 batch_create_character，但针对场景。",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ items }, execCtx) => runBatch("scene", items, "batch_create_scene", execCtx),
});

export const batchCreateProp = createTool({
  id: "batch_create_prop",
  description:
    "批量创建道具（worldprop）到当前项目，直接写入无需用户确认。用法同 batch_create_character，但针对道具。",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async ({ items }, execCtx) => runBatch("prop", items, "batch_create_prop", execCtx),
});
