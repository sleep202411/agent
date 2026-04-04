import { tool } from "ai";
import { z } from "zod/v4";
import * as workspace from "../workspace";
import type { AssistantToolContext } from "./types";
import { assetTypeSchema } from "./shared";

export function createReadTools({
  headers,
  workspace: ctx,
  requireWorldId,
  requireEpisodeId,
}: AssistantToolContext) {
  return {
    get_project_snapshot: tool({
      description: "读取当前项目的基础信息、剧集列表，以及当前世界观和分镜的轻量概览。",
      inputSchema: z.object({}),
      outputSchema: z.any(),
      execute: async () => workspace.getProjectContextSummary(headers, ctx),
    }),

    get_world_assets: tool({
      description:
        "读取当前世界观资产概览。默认返回数量和样本，不返回全量列表。适合先了解当前项目有哪些角色、场景和道具。",
      inputSchema: z.object({
        type: z.enum(["all", "character", "scene", "prop"]).default("all"),
        query: z.string().optional(),
      }),
      outputSchema: z.any(),
      execute: async ({ type, query }) => {
        const worldId = requireWorldId();
        if (type !== "all") {
          return workspace.getWorldAssetSummary(headers, worldId, type, { name: query });
        }
        const [characters, scenes, props] = await Promise.all([
          workspace.getWorldAssetSummary(headers, worldId, "character", { name: query }),
          workspace.getWorldAssetSummary(headers, worldId, "scene", { name: query }),
          workspace.getWorldAssetSummary(headers, worldId, "prop", { name: query }),
        ]);
        return { characters, scenes, props };
      },
    }),

    search_world_assets: tool({
      description:
        "按类型分页检索当前世界观下的角色、场景或道具。适合查找某个名字、列出一页结果，避免一次拉取全量数据。",
      inputSchema: z.object({
        type: assetTypeSchema,
        query: z.string().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
      outputSchema: z.any(),
      execute: async ({ type, query, page, pageSize }) =>
        workspace.getWorldAssetPage(headers, requireWorldId(), type, {
          page,
          pageSize,
          name: query,
        }),
    }),

    aggregate_world_assets_for_analysis: tool({
      description:
        "在确实需要做全局分析时，按页聚合当前世界观下的角色、场景或道具。仅用于「分析全部/查重/一致性检查」场景。",
      inputSchema: z.object({
        type: assetTypeSchema,
        query: z.string().optional(),
        maxItems: z.number().int().min(1).max(200).default(120),
      }),
      outputSchema: z.any(),
      execute: async ({ type, query, maxItems }) =>
        workspace.aggregateWorldAssets(headers, requireWorldId(), type, { name: query, maxItems }),
    }),

    get_storyboard_snapshot: tool({
      description:
        "读取当前剧集的轻量分镜概览，包含列定义、镜头总数和少量示例镜头。适合先建立上下文，不适合直接做全量分析。",
      inputSchema: z.object({}),
      outputSchema: z.any(),
      execute: async () => workspace.getStoryboardSummary(headers, requireEpisodeId()),
    }),

    query_storyboard_rows: tool({
      description:
        "分页查询当前剧集的分镜镜头行。适合查具体镜头、看一页数据或按列过滤，而不是一次读取整表。",
      inputSchema: z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
        shotIds: z.array(z.string()).optional(),
        presetColumnKeys: z.array(z.string()).optional(),
      }),
      outputSchema: z.any(),
      execute: async ({ page, pageSize, shotIds, presetColumnKeys }) =>
        workspace.queryStoryboardRows(headers, requireEpisodeId(), {
          page,
          pageSize,
          shotIds,
          presetColumnKeys,
        }),
    }),

    aggregate_storyboard_rows_for_analysis: tool({
      description:
        "在确实需要分析当前剧集全量分镜时，按页聚合镜头数据。仅用于全局检查、批量整理或跨多镜头总结场景。",
      inputSchema: z.object({
        maxRows: z.number().int().min(1).max(200).default(120),
        shotIds: z.array(z.string()).optional(),
        presetColumnKeys: z.array(z.string()).optional(),
      }),
      outputSchema: z.any(),
      execute: async ({ maxRows, shotIds, presetColumnKeys }) =>
        workspace.aggregateStoryboardRows(headers, requireEpisodeId(), {
          maxRows,
          shotIds,
          presetColumnKeys,
        }),
    }),
  };
}
