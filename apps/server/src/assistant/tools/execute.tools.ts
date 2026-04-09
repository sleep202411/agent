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
      description:
        'Update current project settings. Call directly when instructions are clear.',
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
        // Fetch current project to merge with updates (API requires full object)
        const current = await ws.getProjectDetail(headers, context.projectId);
        await ws.updateProject(headers, {
          ...current,
          id: context.projectId,
          worldId: context.worldId ?? current?.worldId ?? undefined,
          ...input,
        });
        return buildMutationResult(
          'project.updated',
          'Project settings updated',
          'project',
          context.projectId,
        );
      },
    }),

    create_episode: tool({
      description: 'Create an episode for the current project.',
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
          `Episode "${title}" created`,
          'episode',
          String(createdId),
        );
      },
    }),

    batch_create_episodes: tool({
      description:
        'Batch create multiple episodes at once. Must use this instead of calling create_episode in a loop. Returns episodeMap (title→ID mapping).',
      inputSchema: z.object({
        titles: z.array(z.string().min(1)).min(1).describe('Episode titles'),
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
            `Created ${titles.length} episodes`,
            'episode',
            createdIds,
          ),
          episodeMap,
        };
      },
    }),

    update_episode: tool({
      description:
        'Update an episode title or description. Not for saving script content.',
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
          'Episode updated',
          'episode',
          input.id,
        );
      },
    }),

    save_episode_script: tool({
      description:
        'Save script content to a specific episode. Only call after user confirms via propose_script.',
      inputSchema: z.object({
        episodeId: z.string(),
        content: z.string().describe('Script HTML content'),
      }),
      outputSchema: mutationResultSchema,
      execute: async ({ episodeId, content }) => {
        await ws.saveEpisodeScript(headers, episodeId, content);
        return buildMutationResult(
          'episode.updated',
          'Script saved',
          'episode',
          episodeId,
        );
      },
    }),

    delete_episode: tool({
      description:
        'Delete an episode. Only when user explicitly requests deletion.',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await ws.deleteEpisode(headers, id);
        return buildMutationResult(
          'episode.deleted',
          'Episode deleted',
          'episode',
          id,
        );
      },
    }),

    create_character: tool({
      description: 'Create a character in the current world.',
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
          `Character "${input.name}" created`,
          'character',
          toEntityId(result),
        );
      },
    }),

    batch_create_characters: tool({
      description:
        'Batch create multiple characters. Only call after user confirms via propose_characters.',
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
          `Created ${items.length} characters`,
          'character',
          createdIds,
        );
      },
    }),

    update_character: tool({
      description: 'Update a character.',
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
          'Character updated',
          'character',
          input.id,
        );
      },
    }),

    delete_character: tool({
      description:
        'Delete a character. Only when user explicitly requests deletion.',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await ws.deleteCharacter(headers, id);
        return buildMutationResult(
          'character.deleted',
          'Character deleted',
          'character',
          id,
        );
      },
    }),

    create_scene: tool({
      description: 'Create a scene in the current world.',
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
          `Scene "${input.name}" created`,
          'scene',
          toEntityId(result),
        );
      },
    }),

    batch_create_scenes: tool({
      description:
        'Batch create multiple scenes. Only call after user confirms via propose_scenes.',
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
          `Created ${items.length} scenes`,
          'scene',
          createdIds,
        );
      },
    }),

    update_scene: tool({
      description: 'Update a scene.',
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
          'Scene updated',
          'scene',
          input.id,
        );
      },
    }),

    delete_scene: tool({
      description:
        'Delete a scene. Only when user explicitly requests deletion.',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await ws.deleteScene(headers, id);
        return buildMutationResult(
          'scene.deleted',
          'Scene deleted',
          'scene',
          id,
        );
      },
    }),

    create_prop: tool({
      description: 'Create a prop in the current world.',
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
          `Prop "${input.name}" created`,
          'prop',
          toEntityId(result),
        );
      },
    }),

    batch_create_props: tool({
      description:
        'Batch create multiple props. Only call after user confirms via propose_props.',
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
          `Created ${items.length} props`,
          'prop',
          createdIds,
        );
      },
    }),

    update_prop: tool({
      description: 'Update a prop.',
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
          'Prop updated',
          'prop',
          input.id,
        );
      },
    }),

    delete_prop: tool({
      description:
        'Delete a prop. Only when user explicitly requests deletion.',
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await ws.deleteProp(headers, id);
        return buildMutationResult('prop.deleted', 'Prop deleted', 'prop', id);
      },
    }),

    fill_cell: tool({
      description: 'Fill a storyboard cell with content.',
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
          'Storyboard cell updated',
          'shot_value',
          `${input.shotId}:${input.shotColumnId}`,
        );
      },
    }),

    save_storyboard_draft: tool({
      description:
        'Save storyboard draft to the current episode. Only call after user confirms via propose_storyboard_patch.',
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
          'Storyboard draft saved to current episode',
          'storyboard',
          requireEpisodeId(),
        );
      },
    }),
  };
}
