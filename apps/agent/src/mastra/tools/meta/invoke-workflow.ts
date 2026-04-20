import { createTool } from "@mastra/core/tools";
import {
  getMissingProjectParams,
  isGenerativeWorkflow,
  type ProjectParamsDetail,
} from "@repo/shared/project-params";
import { z } from "zod";
import { WORKFLOW_NAMES, type WorkflowName } from "../../lib/redis-keys";
import { getRedis } from "../../lib/redis-client";
import { getContext, javaRequest } from "../../lib/workspace-client";
import { startWorkflow } from "../../workflows/engine";

/**
 * Recursively resolve attachment references embedded in the tool inputData.
 *
 * The NestJS preprocess caches large attachment text in Redis under
 * `attachment:<ref>` and asks the agent to pass `{textRef: "att_xxx"}` instead
 * of copying the text into the tool call (which would blow up the JSON). Here
 * we swap any `*Ref` field whose value starts with `att_` for the cached text
 * under the corresponding bare field name (e.g. textRef → text).
 */
async function resolveAttachmentRefs(value: unknown): Promise<unknown> {
  if (Array.isArray(value)) {
    return Promise.all(value.map(resolveAttachmentRefs));
  }
  if (value === null || typeof value !== "object") return value;

  const src = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  const redis = getRedis();
  for (const [key, v] of Object.entries(src)) {
    if (key.endsWith("Ref") && key.length > 3 && typeof v === "string" && v.startsWith("att_")) {
      const raw = await redis.get(`attachment:${v}`);
      if (!raw) {
        throw new Error(`Attachment ref not found or expired: ${v}`);
      }
      const parsed = JSON.parse(raw) as { text?: string };
      if (typeof parsed.text !== "string") {
        throw new Error(`Attachment ${v} has no text field`);
      }
      const bareKey = key.slice(0, -"Ref".length);
      out[bareKey] = parsed.text;
    } else {
      out[key] = await resolveAttachmentRefs(v);
    }
  }
  return out;
}

export const invokeWorkflow = createTool({
  id: "invoke_workflow",
  description:
    '启动一个后台 workflow（如 role_design / script_writing / storyboard_gen）。立刻返回 runId，然后由 worker 异步执行。对任何可能 > 30 秒或涉及批量生成/写入的意图，必须通过这个工具调用，不要自己用文本回复"生成"出内容。如用户消息中出现 [附件「…」] 带 att_xxx 引用, 请在 inputData 中用 textRef: "att_xxx" 传递, 不要复制正文。',
  inputSchema: z.object({
    workflowName: z.enum(WORKFLOW_NAMES),
    inputData: z
      .unknown()
      .describe(
        'Workflow-specific input payload. Must match the target workflow\'s inputSchema. For large text fields, pass the attachment ref as "<field>Ref": "att_xxx" (e.g. textRef); the server replaces it with the cached text before enqueueing.'
      ),
  }),
  outputSchema: z.union([
    z.object({
      runId: z.string(),
      workflowName: z.enum(WORKFLOW_NAMES),
      message: z.string(),
    }),
    z.object({
      error: z.literal("PROJECT_PARAMS_INCOMPLETE"),
      message: z.string(),
      missing: z.array(z.string()),
    }),
  ]),
  execute: async ({ workflowName, inputData }, execCtx) => {
    const ctx = getContext(execCtx?.requestContext);

    // Preflight: generative workflows require project params to be set. The
    // supervisor prompt tells the LLM to call `require_project_params` first,
    // but we don't rely on that — the LLM sometimes skips it. Hard-block here
    // so a missing-param case always surfaces as a structured error.
    if (isGenerativeWorkflow(workflowName as WorkflowName)) {
      const detail = await javaRequest<ProjectParamsDetail>(
        ctx,
        `/api/user/project/detail/${ctx.projectId}`
      ).catch(() => null);
      const missing = getMissingProjectParams(detail);
      if (missing.length > 0) {
        return {
          error: "PROJECT_PARAMS_INCOMPLETE" as const,
          message:
            "项目核心参数未齐（影片尺寸/单集时长/画风）。请立即调用 require_project_params 让用户补齐，收到 {confirmed:true} 后用相同的 workflowName 和 inputData 重新 invoke_workflow。",
          missing,
        };
      }
    }

    const resolvedInput = await resolveAttachmentRefs(inputData);

    // Supervisor doesn't see projectId / worldId (they live in requestContext),
    // so inject them automatically before the workflow validates its input.
    // Preserve anything the LLM explicitly passed — don't clobber overrides.
    const injected =
      resolvedInput && typeof resolvedInput === "object" && !Array.isArray(resolvedInput)
        ? {
            projectId: ctx.projectId,
            ...(ctx.worldId ? { worldId: ctx.worldId } : {}),
            ...(ctx.episodeId ? { episodeId: ctx.episodeId } : {}),
            ...(resolvedInput as Record<string, unknown>),
          }
        : {
            projectId: ctx.projectId,
            ...(ctx.worldId ? { worldId: ctx.worldId } : {}),
            ...(ctx.episodeId ? { episodeId: ctx.episodeId } : {}),
          };

    const { runId } = await startWorkflow({
      workflowName: workflowName as WorkflowName,
      inputData: injected,
      ctx,
    });
    return {
      runId,
      workflowName: workflowName as WorkflowName,
      message: `已启动 workflow "${workflowName}"，runId=${runId}。任务在后台运行，前端会通过任务卡片显示进度。`,
    };
  },
});
