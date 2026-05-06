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
      "ID of the worldrole / worldscene / worldprop (returned by batch_create_*, or fetched via list_assets)"
    ),
  name: z.string().min(1).describe("Asset name — only used for error messages, not persisted"),
  prompt: z
    .string()
    .min(1)
    .describe("Image prompt — passed straight through to Java without rewriting"),
});

const OutputSchema = z.object({
  ok: z.boolean(),
  path: z.string().optional().describe("OSS path (on success)"),
  message: z.string(),
});

type AssetKind = "role" | "scene" | "prop";

const UI_ENTITY: Record<AssetKind, EntityType> = {
  role: "character",
  scene: "scene",
  prop: "prop",
};

const LABEL: Record<AssetKind, string> = {
  role: "character",
  scene: "scene",
  prop: "prop",
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
      message: `Generated main image for ${LABEL[kind]} "${input.name}".`,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      ok: false,
      message: `Image generation failed for ${LABEL[kind]} "${input.name}": ${reason}`,
    };
  }
}

export const generateCharacterImage = createTool({
  id: "generate_character_image",
  description:
    'Synchronously generate a main image for a single saved character (worldrole) and write the OSS path back onto the record. The Java endpoint blocks 5-30s. Use when the user has already confirmed they want images — typical case: call once per id returned from batch_create_character. For multiple characters, invoke this tool multiple times (it does NOT take an array). For "design a fresh batch of characters from scratch + generate images", call `ask_character_designer` to draft, `batch_create_character` to commit, then loop this tool over each new id.',
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (input, execCtx) =>
    runGenerate("role", "generate_character_image", input, execCtx),
});

export const generateSceneImage = createTool({
  id: "generate_scene_image",
  description:
    "Synchronously generate a main image for a single saved scene (worldscene) and write it back. Same usage pattern as generate_character_image.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (input, execCtx) => runGenerate("scene", "generate_scene_image", input, execCtx),
});

export const generatePropImage = createTool({
  id: "generate_prop_image",
  description:
    "Synchronously generate a main image for a single saved prop (worldprop) and write it back. Same usage pattern as generate_character_image.",
  inputSchema: InputSchema,
  outputSchema: OutputSchema,
  execute: async (input, execCtx) => runGenerate("prop", "generate_prop_image", input, execCtx),
});
