import { tool } from 'ai';
import { z } from 'zod/v4';
import { confirmResultSchema, optionsResultSchema } from './shared';

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
  };
}
