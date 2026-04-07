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
  description: z.string().optional().describe('角色简介'),
  appearance: z.string().optional().describe('角色外貌'),
  personality: z.string().optional().describe('角色性格'),
  prompt: z.string().optional().describe('角色 AI 提示词'),
});

export const sceneProposalSchema = z.object({
  name: z.string().describe('场景名称'),
  description: z.string().optional().describe('场景描述'),
  prompt: z.string().optional().describe('场景提示词'),
});

export const propProposalSchema = z.object({
  name: z.string().describe('道具名称'),
  description: z.string().optional().describe('道具描述'),
  prompt: z.string().optional().describe('道具提示词'),
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
      '表头，必须使用以下固定字段名（按需选用）：description（画面描述）、video_prompt（视频提示词）、style_planting（风格）、movement（运镜）、dialogue（台词）、shot_size（景别）、perspective（视角）、duration（时长）',
    ),
  rows: z
    .array(z.array(z.string()))
    .describe('分镜表数据行，每行的列顺序必须与 headers 一致'),
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
