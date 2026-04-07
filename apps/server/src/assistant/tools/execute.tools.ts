import { tool } from 'ai';
import { z } from 'zod/v4';
import type { AssistantToolContext } from './types';
import {
  buildBatchMutationResult,
  buildMutationResult,
  mutationResultSchema,
  roleProposalSchema,
  sceneProposalSchema,
  propProposalSchema,
  storyboardProposalSchema,
  toEntityId,
} from './shared';

export function createExecuteTools({
  headers,
  ws,
  context,
  requireWorldId,
  requireEpisodeId,
}: AssistantToolContext) {
  return {
    update_project_settings: tool({
      description: '更新当前项目的基础设置。指令明确且字段齐全时可直接调用。',
      inputSchema: z.object({
        name: z.string().optional(),
        description: z.string().optional(),
        type: z.number().optional(),
        episode: z.number().optional(),
        chapterLength: z.number().optional(),
        stylePainting: z.string().optional(),
        aspectRatioType: z.string().optional(),
        imagePath: z.string().optional(),
      }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await ws.updateProject(headers, {
          id: context.projectId,
          worldId: context.worldId ?? undefined,
          ...input,
        });
        return buildMutationResult(
          'project.updated',
          '项目设置已更新',
          'project',
          context.projectId,
        );
      },
    }),

    create_episode: tool({
      description: '为当前项目创建一个剧集。',
      inputSchema: z.object({ title: z.string().min(1) }),
      outputSchema: mutationResultSchema,
      execute: async ({ title }) => {
        const createdId = await ws.createEpisode(
          headers,
          context.projectId,
          title,
        );
        return buildMutationResult(
          'episode.created',
          `剧集「${title}」已创建`,
          'episode',
          String(createdId),
        );
      },
    }),

    batch_create_episodes: tool({
      description:
        '一次性批量创建多个剧集。分集映射确认后必须使用此工具一次性创建所有剧集，禁止逐个调用 create_episode。返回值包含 episodeMap（标题→ID映射），后续 save_episode_script 必须使用此映射中的 ID。',
      inputSchema: z.object({
        titles: z.array(z.string().min(1)).min(1).describe('剧集标题数组'),
      }),
      execute: async ({ titles }) => {
        const episodeMap: Record<string, string> = {};
        const createdIds: string[] = [];
        for (const title of titles) {
          const createdId = await ws.createEpisode(
            headers,
            context.projectId,
            title,
          );
          const id = String(createdId);
          createdIds.push(id);
          episodeMap[title] = id;
        }
        return {
          ...buildBatchMutationResult(
            'episode.batch_created',
            `已创建 ${titles.length} 个剧集`,
            'episode',
            createdIds,
          ),
          episodeMap,
        };
      },
    }),

    update_episode: tool({
      description: '更新某个剧集的标题或简介。不用于写入剧本内容。',
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        introduction: z.string().optional(),
      }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await ws.updateEpisode(headers, input);
        return buildMutationResult(
          'episode.updated',
          '剧集已更新',
          'episode',
          input.id,
        );
      },
    }),

    save_episode_script: tool({
      description:
        '【仅在用户通过 propose_script 确认后调用】将剧本内容保存到指定剧集。禁止在未经 propose_script 确认的情况下直接调用此工具。',
      inputSchema: z.object({
        episodeId: z.string(),
        content: z.string().describe('剧本 HTML 内容'),
      }),
      outputSchema: mutationResultSchema,
      execute: async ({ episodeId, content }) => {
        await ws.saveEpisodeScript(headers, episodeId, content);
        return buildMutationResult(
          'episode.updated',
          '剧本已保存',
          'episode',
          episodeId,
        );
      },
    }),

    delete_episode: tool({
      description: '删除某个剧集。仅当用户明确点名要删除时调用。',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await ws.deleteEpisode(headers, id);
        return buildMutationResult(
          'episode.deleted',
          '剧集已删除',
          'episode',
          id,
        );
      },
    }),

    create_character: tool({
      description: '创建一个角色到当前世界观。',
      inputSchema: roleProposalSchema,
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        const result = (await ws.createCharacter(headers, {
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? '',
          prompt: input.prompt ?? '',
          aiPrompt: input.prompt ?? '',
          ai_prompt: input.prompt ?? '',
          imagePromptPortrait: input.prompt ?? '',
          image_prompt_portrait: input.prompt ?? '',
          promptPortrait: input.prompt ?? '',
          prompt_portrait: input.prompt ?? '',
          roleImgPath: [],
          otherImgPath: {},
          referenceImgPath: [],
          referenceImgDescription: [],
          model: '',
          voiceId: '',
        })) as Record<string, unknown>;
        return buildMutationResult(
          'character.created',
          `角色「${input.name}」已创建`,
          'character',
          toEntityId(result),
        );
      },
    }),

    batch_create_characters: tool({
      description:
        '【仅在用户通过 propose_characters 确认后调用】一次性创建多个角色。禁止在未经提案确认的情况下直接调用。',
      inputSchema: z.object({ items: z.array(roleProposalSchema).min(1) }),
      execute: async ({ items }) => {
        const createdIds: string[] = [];
        for (const item of items) {
          const result = (await ws.createCharacter(headers, {
            worldId: requireWorldId(),
            name: item.name,
            description: item.description ?? '',
            prompt: item.prompt ?? '',
            aiPrompt: item.prompt ?? '',
            ai_prompt: item.prompt ?? '',
            imagePromptPortrait: item.prompt ?? '',
            image_prompt_portrait: item.prompt ?? '',
            promptPortrait: item.prompt ?? '',
            prompt_portrait: item.prompt ?? '',
            roleImgPath: [],
            otherImgPath: {},
            referenceImgPath: [],
            referenceImgDescription: [],
            model: '',
            voiceId: '',
          })) as Record<string, unknown>;
          const entityId = toEntityId(result);
          if (entityId) createdIds.push(entityId);
        }
        return buildBatchMutationResult(
          'character.batch_created',
          `已创建 ${items.length} 个角色`,
          'character',
          createdIds,
        );
      },
    }),

    update_character: tool({
      description: '更新一个角色。',
      inputSchema: roleProposalSchema.extend({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await ws.updateCharacter(headers, {
          id: input.id,
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? '',
          prompt: input.prompt ?? '',
          aiPrompt: input.prompt ?? '',
          ai_prompt: input.prompt ?? '',
          imagePromptPortrait: input.prompt ?? '',
          image_prompt_portrait: input.prompt ?? '',
          promptPortrait: input.prompt ?? '',
          prompt_portrait: input.prompt ?? '',
          roleImgPath: [],
          otherImgPath: {},
          referenceImgPath: [],
          referenceImgDescription: [],
          model: '',
          voiceId: '',
        });
        return buildMutationResult(
          'character.updated',
          '角色已更新',
          'character',
          input.id,
        );
      },
    }),

    delete_character: tool({
      description: '删除一个角色。仅当用户明确点名要删除时调用。',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await ws.deleteCharacter(headers, id);
        return buildMutationResult(
          'character.deleted',
          '角色已删除',
          'character',
          id,
        );
      },
    }),

    create_scene: tool({
      description: '创建一个场景到当前世界观。',
      inputSchema: sceneProposalSchema,
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        const result = (await ws.createScene(headers, {
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? '',
          prompt: input.prompt ?? '',
          sceneImgPath: [],
          referenceImgPath: [],
          panoramaImagePath: '',
        })) as Record<string, unknown>;
        return buildMutationResult(
          'scene.created',
          `场景「${input.name}」已创建`,
          'scene',
          toEntityId(result),
        );
      },
    }),

    batch_create_scenes: tool({
      description:
        '【仅在用户通过 propose_scenes 确认后调用】一次性创建多个场景。禁止在未经提案确认的情况下直接调用。',
      inputSchema: z.object({ items: z.array(sceneProposalSchema).min(1) }),
      execute: async ({ items }) => {
        const createdIds: string[] = [];
        for (const item of items) {
          const result = (await ws.createScene(headers, {
            worldId: requireWorldId(),
            name: item.name,
            description: item.description ?? '',
            prompt: item.prompt ?? '',
            sceneImgPath: [],
            referenceImgPath: [],
            panoramaImagePath: '',
          })) as Record<string, unknown>;
          const entityId = toEntityId(result);
          if (entityId) createdIds.push(entityId);
        }
        return buildBatchMutationResult(
          'scene.batch_created',
          `已创建 ${items.length} 个场景`,
          'scene',
          createdIds,
        );
      },
    }),

    update_scene: tool({
      description: '更新一个场景。',
      inputSchema: sceneProposalSchema.extend({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await ws.updateScene(headers, {
          id: input.id,
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? '',
          prompt: input.prompt ?? '',
          sceneImgPath: [],
          referenceImgPath: [],
          panoramaImagePath: '',
        });
        return buildMutationResult(
          'scene.updated',
          '场景已更新',
          'scene',
          input.id,
        );
      },
    }),

    delete_scene: tool({
      description: '删除一个场景。仅当用户明确点名要删除时调用。',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await ws.deleteScene(headers, id);
        return buildMutationResult('scene.deleted', '场景已删除', 'scene', id);
      },
    }),

    create_prop: tool({
      description: '创建一个道具到当前世界观。',
      inputSchema: propProposalSchema,
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        const result = (await ws.createProp(headers, {
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? '',
          prompt: input.prompt ?? '',
          propImgPath: [],
          referenceImgPath: [],
          threeViewsImagePath: '',
        })) as Record<string, unknown>;
        return buildMutationResult(
          'prop.created',
          `道具「${input.name}」已创建`,
          'prop',
          toEntityId(result),
        );
      },
    }),

    batch_create_props: tool({
      description:
        '【仅在用户通过 propose_props 确认后调用】一次性创建多个道具。禁止在未经提案确认的情况下直接调用。',
      inputSchema: z.object({ items: z.array(propProposalSchema).min(1) }),
      execute: async ({ items }) => {
        const createdIds: string[] = [];
        for (const item of items) {
          const result = (await ws.createProp(headers, {
            worldId: requireWorldId(),
            name: item.name,
            description: item.description ?? '',
            prompt: item.prompt ?? '',
            propImgPath: [],
            referenceImgPath: [],
            threeViewsImagePath: '',
          })) as Record<string, unknown>;
          const entityId = toEntityId(result);
          if (entityId) createdIds.push(entityId);
        }
        return buildBatchMutationResult(
          'prop.batch_created',
          `已创建 ${items.length} 个道具`,
          'prop',
          createdIds,
        );
      },
    }),

    update_prop: tool({
      description: '更新一个道具。',
      inputSchema: propProposalSchema.extend({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await ws.updateProp(headers, {
          id: input.id,
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? '',
          prompt: input.prompt ?? '',
          propImgPath: [],
          referenceImgPath: [],
          threeViewsImagePath: '',
        });
        return buildMutationResult(
          'prop.updated',
          '道具已更新',
          'prop',
          input.id,
        );
      },
    }),

    delete_prop: tool({
      description: '删除一个道具。仅当用户明确点名要删除时调用。',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await ws.deleteProp(headers, id);
        return buildMutationResult('prop.deleted', '道具已删除', 'prop', id);
      },
    }),

    fill_cell: tool({
      description: '为当前剧集的某个分镜单元格写入内容。',
      inputSchema: z.object({
        shotId: z.string(),
        shotColumnId: z.string(),
        value: z.string().optional(),
        values: z.array(z.string()).optional(),
      }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await ws.fillCell(headers, input);
        return buildMutationResult(
          'storyboard.cell_filled',
          '分镜单元格已更新',
          'shot_value',
          `${input.shotId}:${input.shotColumnId}`,
        );
      },
    }),

    save_storyboard_draft: tool({
      description:
        '【仅在用户通过 propose_storyboard_patch 确认后调用】将分镜表草稿保存到当前剧集。禁止在未经 propose_storyboard_patch 确认的情况下直接调用此工具。',
      inputSchema: storyboardProposalSchema.extend({
        autoload: z.boolean().optional(),
      }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await ws.saveStoryboardDraft(headers, {
          episodeId: requireEpisodeId(),
          headers: input.headers,
          rows: input.rows,
          autoload: input.autoload ?? true,
        });
        return buildMutationResult(
          'storyboard.saved',
          '分镜草稿已写入当前剧集',
          'storyboard',
          requireEpisodeId(),
        );
      },
    }),
  };
}
