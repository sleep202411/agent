import {
  assistantEntityTypes,
  assistantMutationActions,
  type AssistantEntityType,
  type AssistantMutationAction,
  type AssistantMutationResult,
} from '../assistant.contracts';
import { z } from 'zod/v4';

export const roleProposalSchema = z.object({
  name: z.string().describe('角色名称'),
  role: z
    .enum(['main', 'supporting', 'extra'])
    .default('supporting')
    .describe('角色类型'),
  description: z
    .string()
    .optional()
    .describe(
      'Character biography for human readers: background, personality, story role, relationships. Can be literary and detailed.',
    ),
  appearance: z.string().optional().describe('角色外貌'),
  personality: z.string().optional().describe('角色性格'),
  prompt: z
    .string()
    .optional()
    .describe(
      'AI image generation prompt — pure visual description ONLY. Focus on: facial features, hairstyle, hair color, clothing, expression, body type, lighting, art style. Must NOT repeat the description/biography. Example: "A young Chinese man, short black hair, dark blue Tang suit, determined expression, athletic build, cinematic lighting"',
    ),
});

export const sceneProposalSchema = z.object({
  name: z.string().describe('场景名称'),
  description: z
    .string()
    .optional()
    .describe(
      'Scene description for human readers: narrative function, mood, story significance, what happens here.',
    ),
  prompt: z
    .string()
    .optional()
    .describe(
      'AI image generation prompt — pure visual description ONLY. Focus on: spatial layout, lighting, colors, objects, atmosphere, weather, time of day, art style. Must NOT repeat the description. Example: "A dimly lit ancient Chinese palace hall, red wooden pillars, golden dragon carvings, moonlight through lattice windows, cinematic wide shot"',
    ),
});

export const propProposalSchema = z.object({
  name: z.string().describe('道具名称'),
  description: z
    .string()
    .optional()
    .describe(
      'Prop description for human readers: what it is, story significance, who uses it.',
    ),
  prompt: z
    .string()
    .optional()
    .describe(
      'AI image generation prompt — pure visual description ONLY. Focus on: shape, material, color, texture, size, details. Must NOT repeat the description. Example: "An ancient bronze dagger with jade handle, intricate engravings, dark patina, studio lighting on black background"',
    ),
});

export const STORYBOARD_API_FIELDS = [
  'description',
  'video_prompt',
  'style_planting',
  'movement',
  'dialogue',
  'shot_size',
  'perspective',
  'duration',
] as const;

export const storyboardProposalSchema = z.object({
  summary: z.string().describe('这版分镜草稿的整体说明'),
  headers: z
    .array(z.string())
    .min(1)
    .describe(
      '表头，必须使用以下固定字段名（按需选用）：description（画面描述）、video_prompt（视频提示词，Seedance格式）、style_planting（风格）、movement（运镜）、dialogue（台词）、shot_size（景别）、perspective（视角）、duration（时长）',
    ),
  rows: z
    .array(z.array(z.coerce.string()))
    .describe(
      '分镜表数据行，每行的列顺序必须与 headers 一致。' +
        '其中 video_prompt 列必须使用 Seedance 多镜头格式，示例：' +
        '"镜号1（8秒）\\n\\n第一镜头：（0-3秒）\\n固定镜头，近景侧拍45度角，林墨缓缓点头，目光中满是赞叹。\\n\\n第二镜头：（3-8秒）\\n跟随镜头，中景正视，苏婉轻盈步入画面，将茶盏放在小几上。" ' +
        '每个镜号5-15秒，子镜头时间连续，必须包含运镜+景别+动作。禁止使用普通描述性句子。',
    ),
});

export const mutationResultSchema = z.object({
  success: z.boolean(),
  action: z.enum(assistantMutationActions),
  message: z.string(),
  entityId: z.string().optional(),
  entityType: z.enum(assistantEntityTypes).optional(),
});

export const optionsResultSchema = z.object({
  selectedIds: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export const confirmResultSchema = z.object({
  confirmed: z.boolean(),
  notes: z.string().optional(),
});

export const configureParamsResultSchema = z.object({
  confirmed: z.boolean(),
  values: z.record(z.string(), z.unknown()).optional(),
});

export const roleProposalDecisionSchema = z.object({
  action: z.enum(['accept', 'accept_edited', 'reject']),
  items: z.array(roleProposalSchema).optional(),
  notes: z.string().optional(),
});

export const sceneProposalDecisionSchema = z.object({
  action: z.enum(['accept', 'accept_edited', 'reject']),
  items: z.array(sceneProposalSchema).optional(),
  notes: z.string().optional(),
});

export const propProposalDecisionSchema = z.object({
  action: z.enum(['accept', 'accept_edited', 'reject']),
  items: z.array(propProposalSchema).optional(),
  notes: z.string().optional(),
});

export const storyboardProposalDecisionSchema = z.object({
  action: z.enum(['accept', 'accept_edited', 'reject']),
  draft: storyboardProposalSchema.optional(),
  notes: z.string().optional(),
});

export const scriptProposalSchema = z.object({
  episodeId: z.string().describe('要写入剧本的剧集 ID'),
  episodeTitle: z.string().describe('剧集标题，用于展示'),
  summary: z.string().describe('剧本概述'),
  content: z.string().describe('剧本正文内容（HTML 格式）'),
});

export const scriptProposalDecisionSchema = z.object({
  action: z.enum(['accept', 'accept_edited', 'reject']),
  content: z.string().optional().describe('用户编辑后的内容'),
  notes: z.string().optional(),
});

export const assetTypeSchema = z.enum(['character', 'scene', 'prop']);

export function buildMutationResult(
  action: AssistantMutationAction,
  message: string,
  entityType?: AssistantEntityType,
  entityId?: string,
): AssistantMutationResult {
  return { success: true, action, message, entityType, entityId };
}

export function buildBatchMutationResult(
  action: AssistantMutationAction,
  message: string,
  entityType: AssistantEntityType,
  entityIds: string[],
) {
  return {
    success: true,
    action,
    message,
    entityType,
    entityIds,
    count: entityIds.length,
  };
}

export function toEntityId(result: Record<string, unknown>) {
  const id = result.id;
  if (typeof id === 'string' || typeof id === 'number') return String(id);
  return undefined;
}
