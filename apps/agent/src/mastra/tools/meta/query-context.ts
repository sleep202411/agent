/**
 * Read-only query of the workspace state (films / episodes / roles / scenes /
 * props / storyboard summary). Replaces the Phase 1 `get_project_snapshot`
 * tool with a narrower contract and broader coverage.
 *
 * The agent calls this when it needs to ground its response on actual project
 * data. Under the hood, routes through the Java API; results are small
 * summaries, never full lists (those live behind workflows).
 */
import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getContext, javaRequest, type StoryosContext } from "../../lib/workspace-client";

type Record_ = Record<string, unknown>;

const ASSET_ROUTES = {
  character: "/api/user/world/list/worldrole",
  scene: "/api/user/world/list/worldscene",
  prop: "/api/user/world/list/worldprop",
} as const;

type AssetKind = keyof typeof ASSET_ROUTES;

async function sampleAssets(
  ctx: StoryosContext,
  worldId: string,
  kind: AssetKind
): Promise<{ total: number; sampleNames: string[] }> {
  const page = await javaRequest<{ list?: Record_[]; total?: number; totalCount?: number }>(
    ctx,
    ASSET_ROUTES[kind],
    { data: { worldId, page: 1, pageSize: 8 } }
  );
  const items = page.list ?? [];
  const names = [
    ...new Set(
      items
        .map((item) =>
          typeof item.name === "string"
            ? item.name
            : typeof item.title === "string"
              ? item.title
              : ""
        )
        .map((v) => v.trim())
        .filter(Boolean)
    ),
  ];
  return {
    total: Number(page.totalCount ?? page.total ?? items.length ?? 0),
    sampleNames: names,
  };
}

export const queryContext = createTool({
  id: "query_context",
  description:
    'Read a summary of the current project (project info, episode count, character/scene/prop totals with sample names). Call before answering any factual question about the project state — e.g. "what characters do I have?", "which episode is X in?".',
  inputSchema: z.object({
    /**
     * Scope lets the agent ask for the lightweight common case (summary) or
     * narrow into one asset type. Full listings go through invoke_workflow
     * because they can be large for production projects.
     */
    scope: z.enum(["summary", "roles", "scenes", "props"]).default("summary"),
  }),
  outputSchema: z.object({
    projectId: z.string(),
    worldId: z.string().nullable(),
    episodeId: z.string().nullable(),
    detail: z.record(z.string(), z.any()).optional(),
    episodes: z.array(z.record(z.string(), z.any())).optional(),
    characters: z.object({ total: z.number(), sampleNames: z.array(z.string()) }).optional(),
    scenes: z.object({ total: z.number(), sampleNames: z.array(z.string()) }).optional(),
    props: z.object({ total: z.number(), sampleNames: z.array(z.string()) }).optional(),
  }),
  execute: async ({ scope }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);

    if (scope === "roles" || scope === "scenes" || scope === "props") {
      // Narrow read — only one asset type.
      const detail = await javaRequest<Record_>(ctx, `/api/user/project/detail/${ctx.projectId}`);
      const worldId =
        ctx.worldId ??
        (typeof detail.worldId === "string" || typeof detail.worldId === "number"
          ? String(detail.worldId)
          : null);
      const kind: AssetKind =
        scope === "roles" ? "character" : scope === "scenes" ? "scene" : "prop";
      const assets = worldId
        ? await sampleAssets(ctx, worldId, kind).catch(() => ({ total: 0, sampleNames: [] }))
        : { total: 0, sampleNames: [] };
      const field = scope === "roles" ? "characters" : scope;
      return {
        projectId: ctx.projectId,
        worldId,
        episodeId: ctx.episodeId ?? null,
        [field]: assets,
      } as never;
    }

    // Summary — project detail + episode count + asset samples.
    const detail = await javaRequest<Record_>(ctx, `/api/user/project/detail/${ctx.projectId}`);
    const worldId =
      ctx.worldId ??
      (typeof detail.worldId === "string" || typeof detail.worldId === "number"
        ? String(detail.worldId)
        : null);
    const [episodes, characters, scenes, props] = await Promise.all([
      javaRequest<{ list?: Record_[] }>(ctx, "/api/user/world/list/episode", {
        data: { productId: ctx.projectId, page: 1, pageSize: 100 },
      }).catch(() => ({ list: [] })),
      worldId
        ? sampleAssets(ctx, worldId, "character").catch(() => ({ total: 0, sampleNames: [] }))
        : Promise.resolve({ total: 0, sampleNames: [] }),
      worldId
        ? sampleAssets(ctx, worldId, "scene").catch(() => ({ total: 0, sampleNames: [] }))
        : Promise.resolve({ total: 0, sampleNames: [] }),
      worldId
        ? sampleAssets(ctx, worldId, "prop").catch(() => ({ total: 0, sampleNames: [] }))
        : Promise.resolve({ total: 0, sampleNames: [] }),
    ]);

    return {
      projectId: ctx.projectId,
      worldId,
      episodeId: ctx.episodeId ?? null,
      detail,
      episodes: episodes.list ?? [],
      characters,
      scenes,
      props,
    };
  },
});
