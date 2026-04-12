import { tool } from 'ai';
import { z } from 'zod/v4';
import { Logger } from '@nestjs/common';
import type { AssistantToolContext } from './types';
import {
  roleProposalSchema,
  roleProposalDecisionSchema,
  sceneProposalSchema,
  sceneProposalDecisionSchema,
  propProposalSchema,
  propProposalDecisionSchema,
  storyboardProposalSchema,
  storyboardProposalDecisionSchema,
  scriptProposalSchema,
  scriptProposalDecisionSchema,
} from './shared';

const logger = new Logger('ProposalTools');

export function createProposalTools(ctx: AssistantToolContext) {
  const { ws, headers } = ctx;
  const worldId = ctx.context.worldId ?? '';
  const episodeId = ctx.context.episodeId ?? '';

  return {
    propose_characters: tool({
      description: '批量提议多个角色方案。用户确认后自动保存到世界观。',
      inputSchema: z.object({
        summary: z.string(),
        items: z.array(roleProposalSchema).min(1),
      }),
      outputSchema: roleProposalDecisionSchema,
      execute: async (
        input,
      ): Promise<{ action: string; items?: unknown[]; notes?: string }> => {
        const items = (input.items ?? []) as Array<{
          name: string;
          description?: string;
          prompt?: string;
        }>;
        let saved = 0;
        for (const item of items) {
          try {
            await ws.createCharacter(headers, {
              worldId,
              name: item.name,
              description: item.description ?? '',
              prompt: item.prompt ?? '',
            });
            saved++;
          } catch (e) {
            logger.error(`propose_characters: failed "${item.name}": ${e}`);
          }
        }
        logger.log(
          `propose_characters: saved ${saved}/${items.length} characters`,
        );
        return { action: 'accept', notes: `Saved ${saved} characters` };
      },
    }),

    propose_scenes: tool({
      description: '批量提议多个场景方案。用户确认后自动保存到世界观。',
      inputSchema: z.object({
        summary: z.string(),
        items: z.array(sceneProposalSchema).min(1),
      }),
      outputSchema: sceneProposalDecisionSchema,
      execute: async (
        input,
      ): Promise<{ action: string; items?: unknown[]; notes?: string }> => {
        const items = (input.items ?? []) as Array<{
          name: string;
          description?: string;
          prompt?: string;
        }>;
        const datas = [
          ['name', 'description', 'prompt'],
          ...items.map((item) => [
            item.name,
            item.description ?? '',
            item.prompt ?? item.description ?? '',
          ]),
        ];
        try {
          await ws.batchCreateScenes(headers, worldId, datas);
          logger.log(`propose_scenes: saved ${items.length} scenes`);
        } catch (e) {
          logger.error(`propose_scenes: batch save failed: ${e}`);
        }
        return { action: 'accept', notes: `Saved ${items.length} scenes` };
      },
    }),

    propose_props: tool({
      description: '批量提议多个道具方案。用户确认后自动保存到世界观。',
      inputSchema: z.object({
        summary: z.string(),
        items: z.array(propProposalSchema).min(1),
      }),
      outputSchema: propProposalDecisionSchema,
      execute: async (
        input,
      ): Promise<{ action: string; items?: unknown[]; notes?: string }> => {
        const items = (input.items ?? []) as Array<{
          name: string;
          description?: string;
          prompt?: string;
        }>;
        const datas = [
          ['name', 'description'],
          ...items.map((item) => [item.name, item.description ?? '']),
        ];
        try {
          await ws.batchCreateProps(headers, worldId, datas);
          logger.log(`propose_props: saved ${items.length} props`);
        } catch (e) {
          logger.error(`propose_props: batch save failed: ${e}`);
        }
        return { action: 'accept', notes: `Saved ${items.length} props` };
      },
    }),

    propose_storyboard_patch: tool({
      description:
        '提议一版分镜表草稿或局部 patch，用户确认后自动保存到当前剧集。' +
        'headers 必须使用系统上下文中 [分镜列定义] 列出的 presetColumnKey。' +
        '对于 SINGLE_OPTION 类型的列，值必须从 options 中选择。',
      inputSchema: storyboardProposalSchema,
      outputSchema: storyboardProposalDecisionSchema,
      execute: async (
        input,
      ): Promise<{ action: string; draft?: unknown; notes?: string }> => {
        const inputHeaders = (input.headers ?? []) as string[];
        const rows = (input.rows ?? []) as string[][];
        if (!episodeId || rows.length === 0) {
          logger.warn('propose_storyboard_patch: missing episodeId or rows');
          return { action: 'accept' };
        }
        try {
          await ws.saveStoryboardDraft(headers, {
            episodeId,
            headers: inputHeaders,
            rows,
          });
          logger.log(
            `propose_storyboard_patch: saved ${rows.length} rows to episode ${episodeId}`,
          );
        } catch (e) {
          logger.error(`propose_storyboard_patch: save failed: ${e}`);
        }
        return {
          action: 'accept',
          notes: `Saved ${rows.length} storyboard rows`,
        };
      },
    }),

    propose_script: tool({
      description:
        '提议一版剧本内容，由用户预览确认后自动写入剧集。当用户要求"写剧本"、"生成剧本"时必须使用此工具。',
      inputSchema: scriptProposalSchema,
      outputSchema: scriptProposalDecisionSchema,
      execute: async (
        input,
      ): Promise<{ action: string; content?: string; notes?: string }> => {
        const epId = input.episodeId as string;
        const content = input.content as string;
        if (!epId || !content) {
          logger.warn('propose_script: missing episodeId or content');
          return { action: 'accept' };
        }
        try {
          await ws.saveEpisodeScript(headers, epId, content);
          logger.log(
            `propose_script: saved script to episode ${epId} (${content.length} chars)`,
          );
          return { action: 'accept', notes: `Saved to episode ${epId}` };
        } catch (e) {
          logger.error(`propose_script: save failed: ${e}`);
          return { action: 'accept', notes: `Save failed: ${e}` };
        }
      },
    }),
  };
}
