/**
 * generate_character_image / generate_scene_image / generate_prop_image —
 * atomic single-image tools for already-saved assets. Call Java's
 * synchronous `/api/ai/image/generate/basic` endpoint (blocks 5-30s per
 * image), write the returned OSS path back onto the asset record, then
 * publish a `updated` entity event so the frontend's sidebar red-dot and
 * asset panel both refresh.
 *
 * Why atomic (vs workflow): supervisor naturally pipelines these after
 * `batch_create_character` — one tool call per asset gives each image
 * its own ToolIndicator chip in the chat, which is enough progress UX
 * for the common N ≤ ~5 case. For bulk regenerates over a full world
 * (dozens of assets, progress bar + cancellation), keep using
 * `invoke_workflow: role_image_phase` / `scene_image_phase` / etc.
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext } from "../../lib/workspace-client";
import { generateAssetImageViaJava, updateAssetImagePath } from "../../lib/java-image-gen";
import { publishEntityEvent } from "../../lib/entity-events";
import type { EntityType } from "@repo/shared/entity-events";

const InputSchema = z.object({
  assetId: z
    .string()
    .min(1)
    .describe(
      "worldrole / worldscene / worldprop 的 id（batch_create_* 返回的 id，或 list_assets 查到的）"
    ),
  name: z.string().min(1).describe("资产名 — 仅用于错误消息定位，不参与入库"),
  prompt: z.string().min(1).describe("图像提示词 — 直接透传给 Java，不做改写"),
});

const OutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional().describe("OSS 路径（成功时）"),
  message: z.string(),
});

type AssetKind = "role" | "scene" | "prop";

const UI_ENTITY: Record<AssetKind, EntityType> = {
  role: "character",
  scene: "scene",
  prop: "prop",
};

const LABEL: Record<AssetKind, string> = {
  role: "角色",
  scene: "场景",
  prop: "道具",
};

async function runGenerate(
  kind: AssetKind,
  toolId: string,
  input: z.infer<typeof InputSchema>,
  execCtx: { requestContext?: unknown } | undefined
): Promise<z.infer<typeof OutputSchema>> {
  const ctx = getContext(
    (execCtx?.requestContext ?? undefined) as Parameters<typeof getContext>[0]
  );

  try {
    const path = await generateAssetImageViaJava(ctx, {
      assetType: kind,
      assetId: input.assetId,
      prompt: input.prompt,
    });
    await updateAssetImagePath(ctx, kind, input.assetId, input.name, path);
    await publishEntityEvent(ctx, {
      entity: UI_ENTITY[kind],
      action: "updated",
      id: input.assetId,
      source: toolId,
    });
    return {
      ok: true,
      path,
      message: `已为${LABEL[kind]}「${input.name}」生成主图。`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `${LABEL[kind]}「${input.name}」生图失败：${reason}`,
    };
  }
}

export const generateCharacterImage = createTool({
  id: "generate_character_image",
  description:
    '为单个已入库角色（worldrole）同步生成主图并写回记录。Java 接口阻塞 5-30s 后返回 OSS 路径。用在"用户已确认要生图"的场景 —— 典型是 batch_create_character 之后对每个返回的 id 调一次。多个角色就多次调用这个 tool（不要期望它接收数组）。对凭空设计一批角色 + 生图的场景用 invoke_workflow: role_design。',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (input, execCtx) =>
    runGenerate("role", "generate_character_image", input, execCtx),
});

export const generateSceneImage = createTool({
  id: "generate_scene_image",
  description:
    "为单个已入库场景（worldscene）同步生成主图并写回记录。用法同 generate_character_image。",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (input, execCtx) => runGenerate("scene", "generate_scene_image", input, execCtx),
});

export const generatePropImage = createTool({
  id: "generate_prop_image",
  description:
    "为单个已入库道具（worldprop）同步生成主图并写回记录。用法同 generate_character_image。",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (input, execCtx) => runGenerate("prop", "generate_prop_image", input, execCtx),
});
