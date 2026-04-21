import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * Generic "let the user pick from a list" UI tool. Supervisor calls this
 * when a decision is legitimately the user's to make (not the LLM's) —
 * typically when there's a **fork in the flow** with material trade-offs:
 *
 *   - script-or-novel upload: 快速出分镜 vs 完整流程
 *   - cost / latency trade-offs the user should see
 *   - N-way branching where the supervisor can't confidently pick
 *
 * Execution semantics: no `execute` — this is a client-side HITL tool
 * just like `require_project_params`. The frontend's `ToolOptionsCard`
 * renders from the tool-call input, waits for the user to click, and
 * posts back the selectedIds via `applyToolResult`. Supervisor sees
 * the selection on the replay and routes accordingly.
 *
 * Input / output shapes are pinned to the frontend contract at
 * `apps/web/src/types/assistant-contracts.ts` — changing either side
 * without the other breaks rendering.
 *
 * WHEN NOT to call: if the user's intent is unambiguous. The supervisor
 * prompt lists keywords that bypass this tool and go straight to
 * `invoke_workflow`.
 */
export const showOptions = createTool({
  id: "show_options",
  description:
    '让用户从一组选项里挑一个（或多个），仅在用户意图确实模糊、且不同选项有实质不同的成本/结果时才调。用户措辞明确（"只要分镜" / "完整流程"）就跳过这个工具直接 invoke_workflow。典型场景：上传剧本后要不要做完整角色/场景资产、多个 workflow 分叉。返回 {selectedIds: [...]}; single-select 时数组只有 1 个元素。',
  inputSchema: z.object({
    title: z.string().describe("标题，5-15 字。例：'想怎么处理这份剧本？'"),
    description: z.string().optional().describe("副标题说明一句话（≤ 50 字），解释为什么要选"),
    options: z
      .array(
        z.object({
          id: z
            .string()
            .describe(
              "选项内部 id，英文小写+下划线。你会在下一轮拿到这个 id，用来 invoke 对应的 workflow"
            ),
          label: z.string().describe("按钮上显示的主文案，8-15 字"),
          description: z
            .string()
            .optional()
            .describe("按钮下方灰色补充说明（≤ 40 字），可带预估积分"),
        })
      )
      .min(2)
      .max(6),
    multiple: z.boolean().optional().describe("默认 false 单选；true 多选"),
  }),
  outputSchema: z.object({
    selectedIds: z.array(z.string()),
    notes: z.string().optional(),
  }),
  // Intentionally NO `execute` — this is a client-side interactive tool.
  // Frontend's chat-composer.tsx renders ToolOptionsCard from the tool's
  // input; user click posts back via applyToolResult; supervisor sees
  // the result on the next turn. Same pattern as require_project_params.
});
