import { createTool } from "@mastra/core/tools";
import { z } from "zod";

/**
 * UI-only ack tool. Supervisor calls this after <PROJECT_PARAMS_CONFIRMED />
 * flows through (Nest already persisted to Java). The frontend renders it as
 * a small green-check chip: "✓ 更新项目参数".
 *
 * Execute is a trivial `{ok: true}` — we MUST return something synchronously,
 * otherwise the streaming LLM loop terminates at `input-available` and
 * supervisor never gets to emit the follow-up tools (generate_project_cover)
 * or the narration text after this one. Learned the hard way: tools with no
 * execute kill the turn.
 */
export const markProjectParamsUpdated = createTool({
  id: "mark_project_params_updated",
  description:
    "在项目参数已被系统保存后，向用户展示一条「✓ 更新项目参数」的完成提示。只在看到 <PROJECT_PARAMS_CONFIRMED/> 标签之后调用，不要在其它场景使用。无入参。",
  inputSchema: z.object({}),
  outputSchema: z.object({ ok: z.boolean() }),
  execute: async () => ({ ok: true }),
});
