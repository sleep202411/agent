import { tool } from 'ai';
import { z } from 'zod/v4';
import {
  confirmResultSchema,
  optionsResultSchema,
  configureParamsResultSchema,
} from './shared';

export function createUiTools() {
  return {
    show_options: tool({
      description: '向用户展示一组选项，由前端渲染为可点击卡片。',
      inputSchema: z.object({
        title: z.string(),
        description: z.string().optional(),
        options: z.array(
          z.object({
            id: z.string(),
            label: z.string(),
            description: z.string().optional(),
          }),
        ),
        multiple: z.boolean().optional(),
      }),
      outputSchema: optionsResultSchema,
    }),

    confirm_action: tool({
      description: '向用户请求一次确认，用于高风险或覆盖类操作。',
      inputSchema: z.object({
        title: z.string(),
        description: z.string(),
        confirmLabel: z.string().optional(),
        cancelLabel: z.string().optional(),
      }),
      outputSchema: confirmResultSchema,
    }),

    configure_params: tool({
      description:
        '向用户展示一组可编辑的参数表单，让用户调整后确认。用于需要用户指定数值参数的场景，如拆解剧本时的集数、时长、镜头数等。',
      inputSchema: z.object({
        title: z.string().describe('表单标题'),
        description: z.string().optional().describe('表单说明'),
        fields: z.array(
          z.object({
            key: z.string().describe('参数键名'),
            label: z.string().describe('参数显示名称'),
            type: z.enum(['number', 'text', 'select']).describe('输入类型'),
            defaultValue: z.union([z.string(), z.number()]).describe('默认值'),
            options: z
              .array(z.object({ label: z.string(), value: z.string() }))
              .optional()
              .describe('select 类型的选项列表'),
            min: z.number().optional().describe('number 类型的最小值'),
            max: z.number().optional().describe('number 类型的最大值'),
            suffix: z.string().optional().describe('后缀文字，如"集"、"分钟"'),
          }),
        ),
      }),
      outputSchema: configureParamsResultSchema,
    }),
  };
}
