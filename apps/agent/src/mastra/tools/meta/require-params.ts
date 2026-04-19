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
 */
export const requireProjectParams = createTool({
  id: "require_project_params",
  description:
    "当用户想开始创作（分析素材 / 生成角色 / 写剧本 / 出分镜 / 主流程）但项目的核心参数（影片尺寸 / 单集时长 / 画风 / 对白语言）尚未设好时，先调用此工具弹出参数表单。返回 confirmed:true 之后再 invoke_workflow。只在用户明确创作意图时调用；只读问题或讨论类请求不要调用。",
  inputSchema: z.object({
    reason: z.string().optional().describe("为什么需要让用户现在设置参数，一句话即可（用于日志）"),
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
