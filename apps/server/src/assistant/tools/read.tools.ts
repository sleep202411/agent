import { tool } from 'ai';
import { z } from 'zod/v4';
import type { AssistantToolContext } from './types';
import { assetTypeSchema } from './shared';

export function createReadTools({
  headers,
  ws,
  context,
  requireWorldId,
  requireEpisodeId,
}: AssistantToolContext) {
  return {
    get_project_snapshot: tool({
      description:
        '读取当前项目的基础信息、剧集列表，以及当前世界观和分镜的轻量概览。',
      inputSchema: z.object({}),
      outputSchema: z.any(),
      execute: async () => ws.getProjectContextSummary(headers, context),
    }),

    get_world_assets: tool({
      description:
        '读取当前世界观资产概览。默认返回数量和样本，不返回全量列表。',
      inputSchema: z.object({
        type: z.enum(['all', 'character', 'scene', 'prop']).default('all'),
        query: z.string().optional(),
      }),
      outputSchema: z.any(),
      execute: async ({ type, query }) => {
        const worldId = requireWorldId();
        if (type !== 'all') {
          return ws.getWorldAssetSummary(headers, worldId, type, {
            name: query,
          });
        }
        const [characters, scenes, props] = await Promise.all([
          ws.getWorldAssetSummary(headers, worldId, 'character', {
            name: query,
          }),
          ws.getWorldAssetSummary(headers, worldId, 'scene', { name: query }),
          ws.getWorldAssetSummary(headers, worldId, 'prop', { name: query }),
        ]);
        return { characters, scenes, props };
      },
    }),

    search_world_assets: tool({
      description: '按类型分页检索当前世界观下的角色、场景或道具。',
      inputSchema: z.object({
        type: assetTypeSchema,
        query: z.string().optional(),
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(20),
      }),
      outputSchema: z.any(),
      execute: async ({ type, query, page, pageSize }) =>
        ws.getWorldAssetPage(headers, requireWorldId(), type, {
          page,
          pageSize,
          name: query,
        }),
    }),

    aggregate_world_assets_for_analysis: tool({
      description:
        '在确实需要做全局分析时，按页聚合当前世界观下的角色、场景或道具。',
      inputSchema: z.object({
        type: assetTypeSchema,
        query: z.string().optional(),
        maxItems: z.number().int().min(1).max(200).default(120),
      }),
      outputSchema: z.any(),
      execute: async ({ type, query, maxItems }) =>
        ws.aggregateWorldAssets(headers, requireWorldId(), type, {
          name: query,
          maxItems,
        }),
    }),

    get_storyboard_snapshot: tool({
      description:
        '读取当前剧集的轻量分镜概览，包含列定义、镜头总数和少量示例镜头。',
      inputSchema: z.object({}),
      outputSchema: z.any(),
      execute: async () => ws.getStoryboardSummary(headers, requireEpisodeId()),
    }),

    query_storyboard_rows: tool({
      description: '分页查询当前剧集的分镜镜头行。',
      inputSchema: z.object({
        page: z.number().int().min(1).default(1),
        pageSize: z.number().int().min(1).max(100).default(50),
        shotIds: z.array(z.string()).optional(),
        presetColumnKeys: z.array(z.string()).optional(),
      }),
      outputSchema: z.any(),
      execute: async ({ page, pageSize, shotIds, presetColumnKeys }) =>
        ws.queryStoryboardRows(headers, requireEpisodeId(), {
          page,
          pageSize,
          shotIds,
          presetColumnKeys,
        }),
    }),

    aggregate_storyboard_rows_for_analysis: tool({
      description: '在确实需要分析当前剧集全量分镜时，按页聚合镜头数据。',
      inputSchema: z.object({
        maxRows: z.number().int().min(1).max(200).default(120),
        shotIds: z.array(z.string()).optional(),
        presetColumnKeys: z.array(z.string()).optional(),
      }),
      outputSchema: z.any(),
      execute: async ({ maxRows, shotIds, presetColumnKeys }) =>
        ws.aggregateStoryboardRows(headers, requireEpisodeId(), {
          maxRows,
          shotIds,
          presetColumnKeys,
        }),
    }),
  };
}
