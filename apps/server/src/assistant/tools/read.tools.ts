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
        'Get asset counts and sample names for characters, scenes, and props. ' +
        'Use this for quick overview. For full list with details, use list_characters / list_scenes / list_props.',
      inputSchema: z.object({
        type: z.enum(['all', 'character', 'scene', 'prop']).default('all'),
      }),
      outputSchema: z.any(),
      execute: async ({ type }) => {
        const worldId = requireWorldId();
        if (type !== 'all') {
          return ws.getWorldAssetSummary(headers, worldId, type);
        }
        const [characters, scenes, props] = await Promise.all([
          ws.getWorldAssetSummary(headers, worldId, 'character'),
          ws.getWorldAssetSummary(headers, worldId, 'scene'),
          ws.getWorldAssetSummary(headers, worldId, 'prop'),
        ]);
        return { characters, scenes, props };
      },
    }),

    list_characters: tool({
      description:
        'List all characters with id, name, and description. Use this when user asks about character details or full list.',
      inputSchema: z.object({
        query: z.string().optional().describe('Filter by name'),
      }),
      outputSchema: z.any(),
      execute: async ({ query }) => {
        const page = await ws.getWorldAssetPage(
          headers,
          requireWorldId(),
          'character',
          { page: 1, pageSize: 100, name: query },
        );
        return {
          total: Number(page.totalCount ?? page.total ?? 0),
          characters: (page.list ?? []).map((item) => ({
            id: String(item.id ?? ''),
            name: String(item.name ?? ''),
            description: String(item.description ?? ''),
          })),
        };
      },
    }),

    list_scenes: tool({
      description:
        'List all scenes with id, name, and description. Use this when user asks about scene details or full list.',
      inputSchema: z.object({
        query: z.string().optional().describe('Filter by name'),
      }),
      outputSchema: z.any(),
      execute: async ({ query }) => {
        const page = await ws.getWorldAssetPage(
          headers,
          requireWorldId(),
          'scene',
          { page: 1, pageSize: 100, name: query },
        );
        return {
          total: Number(page.totalCount ?? page.total ?? 0),
          scenes: (page.list ?? []).map((item) => ({
            id: String(item.id ?? ''),
            name: String(item.name ?? ''),
            description: String(item.description ?? ''),
          })),
        };
      },
    }),

    list_props: tool({
      description:
        'List all props with id, name, and description. Use this when user asks about prop details or full list.',
      inputSchema: z.object({
        query: z.string().optional().describe('Filter by name'),
      }),
      outputSchema: z.any(),
      execute: async ({ query }) => {
        const page = await ws.getWorldAssetPage(
          headers,
          requireWorldId(),
          'prop',
          { page: 1, pageSize: 100, name: query },
        );
        return {
          total: Number(page.totalCount ?? page.total ?? 0),
          props: (page.list ?? []).map((item) => ({
            id: String(item.id ?? ''),
            name: String(item.name ?? ''),
            description: String(item.description ?? ''),
          })),
        };
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
