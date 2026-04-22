import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * UI-only signal tool. Supervisor calls this when the user's intent is to
 * start creating (analyze / batch generate / make a series) but the project's
 * 4 core params (aspectRatioType / chapterLength / stylePainting /
 * dialogLanguage) aren't all set.
 *
 * Execution semantics: the placeholder `execute` returns `{confirmed:false}`
 * so the model treats the call as pending. The frontend intercepts the tool
 * call, renders `ProjectParamsForm`, waits for the user, then replays the
 * conversation with `{confirmed:true}` via `applyToolResult`. Supervisor sees
 * confirmed:true on the replay and proceeds to `invoke_workflow`.
 *
 * Optional `suggestedParams` input: when the supervisor has just run
 * `analyze_brief` on fresh user material, it forwards the recommended
 * values here. The frontend uses them as form defaults + renders a one-
 * line "recommended because…" banner above the form. When omitted, the
 * form falls back to localStorage / hardcoded defaults.
 */
const SuggestedParamsSchema = z.object({
  stylePainting: z.string(),
  chapterLength: z.number().int(),
  targetEpisodeCount: z.number().int(),
  dialogLanguage: z.enum(["zh-CN", "zh-HK", "en-US"]),
  aspectRatioType: z.enum(["_16_9", "_9_16", "_1_1", "_4_3", "_21_9", "_3_4"]),
  reasoning: z.string(),
});

/**
 * Encodes the "what to do after the form is confirmed" intent. Supervisor
 * passes this when it already knows (e.g. user clearly said "做 10 集短剧"
 * or picked a show_options entry). Frontend stashes it with form state,
 * sends it back with confirmProjectParams, Nest short-circuits start.
 *
 * When omitted (intent still fuzzy), Nest skips the auto-continue — the
 * supervisor will decide on the next user message.
 */
const OnConfirmWorkflowSchema = z.object({
  workflowName: z.string(),
  inputData: z.record(z.string(), z.unknown()).optional(),
});

export const requireProjectParams = createTool({
  id: "require_project_params",
  description:
    "当用户想开始创作（分析素材 / 生成角色 / 写剧本 / 出分镜 / 主流程）但项目的核心参数（影片尺寸 / 单集时长 / 画风 / 对白语言）尚未设好时，先调用此工具弹出参数表单。返回 confirmed:true 之后前端会直接把确认的参数 + onConfirmWorkflow 发给 Nest，Nest 存参数后直接启动你声明的 workflow（完全不走 LLM 再绕一轮）。只在用户明确创作意图时调用；只读问题或讨论类请求不要调用。如果刚调完 analyze_brief，把返回的 suggestedParams 对象透传给此工具的 suggestedParams 入参。如果你已经知道用户接下来要跑哪个 workflow，**务必**把 onConfirmWorkflow 也带上。",
  inputSchema: z.object({
    reason: z.string().optional().describe("为什么需要让用户现在设置参数，一句话即可（用于日志）"),
    suggestedParams: SuggestedParamsSchema.optional().describe(
      "从 analyze_brief 拿到的推荐参数。前端用来预填表单 + 显示推荐理由。不确定时不要传。"
    ),
    onConfirmWorkflow: OnConfirmWorkflowSchema.optional().describe(
      "用户确认参数后要直接启动的 workflow（workflowName + 可选 inputData）。带上这个，系统就能跳过 LLM 直接派发，响应更快。意图不明确时不传。"
    ),
  }),
  outputSchema: z.object({
    confirmed: z.boolean(),
  }),
  // Intentionally no `execute` — this is a client-side ("human-in-the-loop")
  // tool. Mastra/AI SDK should emit the tool call and end the stream with
  // it in a pending state; the browser then renders ProjectParamsForm and
  // the user's submission is posted back via `applyToolResult`, which
  // re-streams the conversation with the real `{confirmed: true}` result.
});
