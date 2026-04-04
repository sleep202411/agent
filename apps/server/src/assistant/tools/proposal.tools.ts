import { tool } from 'ai';
import { z } from 'zod/v4';
import {
  roleProposalSchema,
  roleProposalDecisionSchema,
  sceneProposalSchema,
  sceneProposalDecisionSchema,
  propProposalSchema,
  propProposalDecisionSchema,
  storyboardProposalSchema,
  storyboardProposalDecisionSchema,
} from './shared';

export function createProposalTools() {
  return {
    propose_characters: tool({
      description:
        '批量提议多个角色方案。当需要一次生成多个角色时先使用此工具，不要直接逐个写库。',
      inputSchema: z.object({
        summary: z.string(),
        items: z.array(roleProposalSchema).min(1),
      }),
      outputSchema: roleProposalDecisionSchema,
    }),

    propose_scenes: tool({
      description:
        '批量提议多个场景方案。用户接受后再调用 batch_create_scenes。',
      inputSchema: z.object({
        summary: z.string(),
        items: z.array(sceneProposalSchema).min(1),
      }),
      outputSchema: sceneProposalDecisionSchema,
    }),

    propose_props: tool({
      description:
        '批量提议多个道具方案。用户接受后再调用 batch_create_props。',
      inputSchema: z.object({
        summary: z.string(),
        items: z.array(propProposalSchema).min(1),
      }),
      outputSchema: propProposalDecisionSchema,
    }),

    propose_storyboard_patch: tool({
      description:
        '提议一版分镜表草稿或局部 patch，由用户确认后再保存到当前剧集。',
      inputSchema: storyboardProposalSchema,
      outputSchema: storyboardProposalDecisionSchema,
    }),
  };
}
