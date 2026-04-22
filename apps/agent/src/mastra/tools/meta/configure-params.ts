import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Generic "ask user for some params" HITL. Used by the supervisor when it
 * needs concrete generation settings (episode count, shot count per episode,
 * style, dialogue language, episode length) before kicking off a pipeline —
 * replaces the legacy `require_project_params` flow that persisted to the
 * Java project table.
 *
 * **Values are conversation-scoped**: no Redis, no Java write-back. The
 * supervisor holds onto them via its own chat history, then passes them
 * into subsequent `invoke_workflow` calls as inputData fields. See the
 * storyos prompt's "配置参数" section for the canonical 5-field shape.
 *
 * Execution: no `execute` — frontend `ToolParamsCard` renders the form,
 * user submits, result is replayed to Mastra via `applyToolResult`. The
 * supervisor sees `{confirmed: true, values: {...}}` on the next turn.
 */
export const configureParams = createTool({
  id: "configure_params",
  description:
    '让用户填一个多字段表单，用来收集本次创作的生成参数（剧集数 / 单集时长 / 每集分镜数 / 画风 / 对白语言 这 5 个）。**不**写入 Java 项目，**不**走 workspaceContext——纯会话级。用户提交后你在后续 `invoke_workflow` 的 inputData 里把这 5 个字段一起带上（targetEpisodeCount / chapterLength / shotsPerEpisode / stylePainting / dialogLanguage），各 phase workflow 自己消费。新项目启动时（分析素材后 / 用户要开始跑生成前）调一次即可；用户之后想改任一参数，重新调这个工具或让用户自然语言说"把画风换成 X"，你也可以当场再调一次。',
  inputSchema: z.object({
    title: z.string().describe("标题，5-15 字。例：'创作参数'"),
    description: z.string().optional().describe("副标题一句话（≤ 50 字），解释为什么要这些参数"),
    fields: z
      .array(
        z.object({
          key: z
            .string()
            .describe(
              "字段 id。约定用 targetEpisodeCount / chapterLength / shotsPerEpisode / stylePainting / dialogLanguage，下游 workflow 按这些 key 读 inputData"
            ),
          label: z.string().describe("人读字段名，5-8 字"),
          type: z.enum(["number", "text", "select"]),
          defaultValue: z.union([z.string(), z.number()]).describe("初始值"),
          options: z
            .array(z.object({ label: z.string(), value: z.string() }))
            .optional()
            .describe("type=select 时的选项"),
          min: z.number().optional(),
          max: z.number().optional(),
          suffix: z.string().optional().describe("单位后缀，如 '集' / '分钟'"),
        })
      )
      .min(1)
      .max(8),
  }),
  outputSchema: z.object({
    confirmed: z.boolean(),
    /**
     * 用户填的值。key 跟 fields[].key 对应。supervisor 在后续
     * invoke_workflow 的 inputData 里带上这些值（key 原样即可）。
     */
    values: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  }),
  // No execute — client-side HITL. Frontend's ToolParamsCard renders the
  // form; user submission posts back via applyToolResult, which re-streams
  // the conversation with `{confirmed: true, values: {...}}`.
});
