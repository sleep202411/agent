import { tool } from "ai";
import { z } from "zod/v4";
import * as workspace from "../workspace";
import type { AssistantToolContext } from "./types";
import {
  buildBatchMutationResult,
  buildMutationResult,
  mutationResultSchema,
  propProposalSchema,
  roleProposalSchema,
  sceneProposalSchema,
  storyboardProposalSchema,
  toEntityId,
} from "./shared";

const batchCreateCharactersInputSchema = z.object({
  items: z.array(roleProposalSchema).min(1),
});

const batchCreateScenesInputSchema = z.object({
  items: z.array(sceneProposalSchema).min(1),
});

const batchCreatePropsInputSchema = z.object({
  items: z.array(propProposalSchema).min(1),
});

export function createExecuteTools({
  headers,
  workspace: ctx,
  requireWorldId,
  requireEpisodeId,
}: AssistantToolContext) {
  return {
    update_project_settings: tool({
      description: "更新当前项目的基础设置。指令明确且字段齐全时可直接调用。",
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
        await workspace.updateProject(headers, {
          id: ctx.projectId,
          worldId: ctx.worldId ?? undefined,
          ...input,
        });
        return buildMutationResult("project.updated", "项目设置已更新", "project", ctx.projectId);
      },
    }),

    create_episode: tool({
      description: "为当前项目创建一个剧集。",
      inputSchema: z.object({ title: z.string().min(1) }),
      outputSchema: mutationResultSchema,
      execute: async ({ title }) => {
        const createdId = await workspace.createEpisode(headers, ctx.projectId, title);
        return buildMutationResult(
          "episode.created",
          `剧集「${title}」已创建`,
          "episode",
          String(createdId)
        );
      },
    }),

    update_episode: tool({
      description: "更新某个剧集的标题或简介。",
      inputSchema: z.object({
        id: z.string(),
        title: z.string().optional(),
        introduction: z.string().optional(),
      }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await workspace.updateEpisode(headers, input);
        return buildMutationResult("episode.updated", "剧集已更新", "episode", input.id);
      },
    }),

    delete_episode: tool({
      description: "删除某个剧集。仅当用户明确点名要删除时调用。",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await workspace.deleteEpisode(headers, id);
        return buildMutationResult("episode.deleted", "剧集已删除", "episode", id);
      },
    }),

    create_character: tool({
      description: "创建一个角色到当前世界观。",
      inputSchema: roleProposalSchema,
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        const result = (await workspace.createCharacter(headers, {
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? "",
          prompt: input.prompt ?? "",
          aiPrompt: input.prompt ?? "",
          ai_prompt: input.prompt ?? "",
          imagePromptPortrait: input.prompt ?? "",
          image_prompt_portrait: input.prompt ?? "",
          promptPortrait: input.prompt ?? "",
          prompt_portrait: input.prompt ?? "",
          roleImgPath: [],
          otherImgPath: {},
          referenceImgPath: [],
          referenceImgDescription: [],
          model: "",
          voiceId: "",
        })) as Record<string, unknown>;

        return buildMutationResult(
          "character.created",
          `角色「${input.name}」已创建`,
          "character",
          toEntityId(result)
        );
      },
    }),

    batch_create_characters: tool({
      description: "一次性创建多个角色。仅在用户接受角色提案后调用，不要在提案阶段直接使用此工具。",
      inputSchema: batchCreateCharactersInputSchema,
      // outputSchema omitted — zod v4 type inference issue with AI SDK tool()
      execute: async ({ items }) => {
        const createdIds: string[] = [];
        for (const item of items) {
          const result = (await workspace.createCharacter(headers, {
            worldId: requireWorldId(),
            name: item.name,
            description: item.description ?? "",
            prompt: item.prompt ?? "",
            aiPrompt: item.prompt ?? "",
            ai_prompt: item.prompt ?? "",
            imagePromptPortrait: item.prompt ?? "",
            image_prompt_portrait: item.prompt ?? "",
            promptPortrait: item.prompt ?? "",
            prompt_portrait: item.prompt ?? "",
            roleImgPath: [],
            otherImgPath: {},
            referenceImgPath: [],
            referenceImgDescription: [],
            model: "",
            voiceId: "",
          })) as Record<string, unknown>;
          const entityId = toEntityId(result);
          if (entityId) createdIds.push(entityId);
        }
        return buildBatchMutationResult(
          "character.batch_created",
          `已创建 ${items.length} 个角色`,
          "character",
          createdIds
        );
      },
    }),

    update_character: tool({
      description: "更新一个角色。",
      inputSchema: roleProposalSchema.extend({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await workspace.updateCharacter(headers, {
          id: input.id,
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? "",
          prompt: input.prompt ?? "",
          aiPrompt: input.prompt ?? "",
          ai_prompt: input.prompt ?? "",
          imagePromptPortrait: input.prompt ?? "",
          image_prompt_portrait: input.prompt ?? "",
          promptPortrait: input.prompt ?? "",
          prompt_portrait: input.prompt ?? "",
          roleImgPath: [],
          otherImgPath: {},
          referenceImgPath: [],
          referenceImgDescription: [],
          model: "",
          voiceId: "",
        });
        return buildMutationResult("character.updated", "角色已更新", "character", input.id);
      },
    }),

    delete_character: tool({
      description: "删除一个角色。仅当用户明确点名要删除时调用。",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await workspace.deleteCharacter(headers, id);
        return buildMutationResult("character.deleted", "角色已删除", "character", id);
      },
    }),

    create_scene: tool({
      description: "创建一个场景到当前世界观。",
      inputSchema: sceneProposalSchema,
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        const result = (await workspace.createScene(headers, {
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? "",
          prompt: input.prompt ?? "",
          sceneImgPath: [],
          referenceImgPath: [],
          panoramaImagePath: "",
        })) as Record<string, unknown>;

        return buildMutationResult(
          "scene.created",
          `场景「${input.name}」已创建`,
          "scene",
          toEntityId(result)
        );
      },
    }),

    batch_create_scenes: tool({
      description: "一次性创建多个场景。仅在用户接受场景提案后调用，不要在提案阶段直接使用此工具。",
      inputSchema: batchCreateScenesInputSchema,
      // outputSchema omitted — zod v4 type inference issue with AI SDK tool()
      execute: async ({ items }) => {
        const createdIds: string[] = [];
        for (const item of items) {
          const result = (await workspace.createScene(headers, {
            worldId: requireWorldId(),
            name: item.name,
            description: item.description ?? "",
            prompt: item.prompt ?? "",
            sceneImgPath: [],
            referenceImgPath: [],
            panoramaImagePath: "",
          })) as Record<string, unknown>;
          const entityId = toEntityId(result);
          if (entityId) createdIds.push(entityId);
        }
        return buildBatchMutationResult(
          "scene.batch_created",
          `已创建 ${items.length} 个场景`,
          "scene",
          createdIds
        );
      },
    }),

    update_scene: tool({
      description: "更新一个场景。",
      inputSchema: sceneProposalSchema.extend({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await workspace.updateScene(headers, {
          id: input.id,
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? "",
          prompt: input.prompt ?? "",
          sceneImgPath: [],
          referenceImgPath: [],
          panoramaImagePath: "",
        });
        return buildMutationResult("scene.updated", "场景已更新", "scene", input.id);
      },
    }),

    delete_scene: tool({
      description: "删除一个场景。仅当用户明确点名要删除时调用。",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await workspace.deleteScene(headers, id);
        return buildMutationResult("scene.deleted", "场景已删除", "scene", id);
      },
    }),

    create_prop: tool({
      description: "创建一个道具到当前世界观。",
      inputSchema: propProposalSchema,
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        const result = (await workspace.createProp(headers, {
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? "",
          prompt: input.prompt ?? "",
          propImgPath: [],
          referenceImgPath: [],
          threeViewsImagePath: "",
        })) as Record<string, unknown>;

        return buildMutationResult(
          "prop.created",
          `道具「${input.name}」已创建`,
          "prop",
          toEntityId(result)
        );
      },
    }),

    batch_create_props: tool({
      description: "一次性创建多个道具。仅在用户接受道具提案后调用，不要在提案阶段直接使用此工具。",
      inputSchema: batchCreatePropsInputSchema,
      // outputSchema omitted — zod v4 type inference issue with AI SDK tool()
      execute: async ({ items }) => {
        const createdIds: string[] = [];
        for (const item of items) {
          const result = (await workspace.createProp(headers, {
            worldId: requireWorldId(),
            name: item.name,
            description: item.description ?? "",
            prompt: item.prompt ?? "",
            propImgPath: [],
            referenceImgPath: [],
            threeViewsImagePath: "",
          })) as Record<string, unknown>;
          const entityId = toEntityId(result);
          if (entityId) createdIds.push(entityId);
        }
        return buildBatchMutationResult(
          "prop.batch_created",
          `已创建 ${items.length} 个道具`,
          "prop",
          createdIds
        );
      },
    }),

    update_prop: tool({
      description: "更新一个道具。",
      inputSchema: propProposalSchema.extend({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await workspace.updateProp(headers, {
          id: input.id,
          worldId: requireWorldId(),
          name: input.name,
          description: input.description ?? "",
          prompt: input.prompt ?? "",
          propImgPath: [],
          referenceImgPath: [],
          threeViewsImagePath: "",
        });
        return buildMutationResult("prop.updated", "道具已更新", "prop", input.id);
      },
    }),

    delete_prop: tool({
      description: "删除一个道具。仅当用户明确点名要删除时调用。",
      inputSchema: z.object({ id: z.string() }),
      outputSchema: mutationResultSchema,
      execute: async ({ id }) => {
        await workspace.deleteProp(headers, id);
        return buildMutationResult("prop.deleted", "道具已删除", "prop", id);
      },
    }),

    fill_cell: tool({
      description: "为当前剧集的某个分镜单元格写入内容。",
      inputSchema: z.object({
        shotId: z.string(),
        shotColumnId: z.string(),
        value: z.string().optional(),
        values: z.array(z.string()).optional(),
      }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await workspace.fillCell(headers, input);
        return buildMutationResult(
          "storyboard.cell_filled",
          "分镜单元格已更新",
          "shot_value",
          `${input.shotId}:${input.shotColumnId}`
        );
      },
    }),

    save_storyboard_draft: tool({
      description: "将用户确认后的分镜表草稿保存到当前剧集。",
      inputSchema: storyboardProposalSchema.extend({
        autoload: z.boolean().optional(),
      }),
      outputSchema: mutationResultSchema,
      execute: async (input) => {
        await workspace.saveStoryboardDraft(headers, {
          episodeId: requireEpisodeId(),
          headers: input.headers,
          rows: input.rows,
          autoload: input.autoload ?? true,
        });
        return buildMutationResult(
          "storyboard.saved",
          "分镜草稿已写入当前剧集",
          "storyboard",
          requireEpisodeId()
        );
      },
    }),
  };
}
