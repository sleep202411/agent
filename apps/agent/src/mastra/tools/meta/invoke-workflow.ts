import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { WORKFLOW_NAMES, type WorkflowName } from "../../lib/redis-keys";
import { getRedis } from "../../lib/redis-client";
import { getContext, type StoryosContext } from "../../lib/workspace-client";
import { startWorkflow } from "../../workflows/engine";
import { estimateWorkflowCost, getUserBalance } from "../../lib/billing";

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
      estimatedCost: z.number().int().nonnegative().optional(),
    }),
    z.object({
      error: z.literal("INSUFFICIENT_CREDITS"),
      message: z.string(),
      needed: z.number(),
      current: z.number(),
    }),
  ]),
  execute: async ({ workflowName, inputData }, execCtx) => {
    const baseCtx = getContext(execCtx?.requestContext);

    const resolvedInput = await resolveAttachmentRefs(inputData);
    const resolvedObj =
      resolvedInput && typeof resolvedInput === "object" && !Array.isArray(resolvedInput)
        ? (resolvedInput as Record<string, unknown>)
        : {};

    // Post-configure_params model: LLM collects generation-time settings
    // (targetEpisodeCount / chapterLength / shotsPerEpisode / stylePainting /
    // dialogLanguage) via `configure_params` tool, remembers via its own
    // chat history, passes them into each `invoke_workflow` call's inputData.
    // Lift them OUT of inputData into the request context so existing phase
    // workflows reading `ctx.stylePainting` etc. continue to work unchanged.
    const genParamOverrides = extractGenParamOverrides(resolvedObj);
    const ctx: StoryosContext = { ...baseCtx, ...genParamOverrides };

    // Credit preflight: estimate cost + check balance. Uses ctx (with
    // overrides) so LLM-declared targetEpisodeCount lands in the estimate.
    const estimated = estimateWorkflowCost(
      workflowName as WorkflowName,
      null,
      ctx.targetEpisodeCount ?? null
    );
    if (estimated > 0) {
      const balance = await getUserBalance(ctx);
      if (balance < estimated) {
        return {
          error: "INSUFFICIENT_CREDITS" as const,
          message: `Estimated cost ${estimated} credits, current balance ${balance}. Please top up and retry.`,
          needed: estimated,
          current: balance,
        };
      }
    }

    // Auto-inject targetEpisodeCount for phases that plan/slice episodes
    // if LLM omitted it but ctx has a value (from configure_params).
    const needsEpisodeCount = workflowName === "episode_phase" || workflowName === "parse_script";
    const injectedEpisodeCount =
      needsEpisodeCount &&
      !("targetEpisodeCount" in resolvedObj) &&
      typeof ctx.targetEpisodeCount === "number" &&
      ctx.targetEpisodeCount > 0
        ? { targetEpisodeCount: ctx.targetEpisodeCount }
        : {};

    // Supervisor doesn't see projectId / worldId (they live in requestContext),
    // so inject them automatically before the workflow validates its input.
    // Preserve anything the LLM explicitly passed — don't clobber overrides.
    const injected = {
      projectId: ctx.projectId,
      ...(ctx.worldId ? { worldId: ctx.worldId } : {}),
      ...(ctx.episodeId ? { episodeId: ctx.episodeId } : {}),
      ...injectedEpisodeCount,
      ...resolvedObj,
    };

    const { runId } = await startWorkflow({
      workflowName: workflowName as WorkflowName,
      inputData: injected,
      ctx,
    });
    return {
      runId,
      workflowName: workflowName as WorkflowName,
      estimatedCost: estimated,
      message: `OK. runId=${runId}. End the turn immediately — do NOT call any more tools (list_active_workflows / explain_current_state / show_drafts / anything), do NOT write any more text.`,
    };
  },
});

/**
 * Peel the 5 generation-time config values out of the inputData the LLM
 * passed, so we can override the request context before dispatch. Each
 * field is optional — LLM may omit if it's reusing the value set in an
 * earlier `configure_params` call but didn't carry it forward, in which
 * case the ctx's existing value (from prior overrides) wins.
 */
function extractGenParamOverrides(
  input: Record<string, unknown>
): Partial<
  Pick<
    StoryosContext,
    "targetEpisodeCount" | "shotsPerEpisode" | "stylePainting" | "dialogLanguage"
  >
> {
  const out: Partial<StoryosContext> = {};
  const tec = input.targetEpisodeCount;
  if (typeof tec === "number" && Number.isFinite(tec) && tec > 0) {
    out.targetEpisodeCount = tec;
  } else if (typeof tec === "string" && tec.trim()) {
    const n = Number(tec);
    if (Number.isFinite(n) && n > 0) out.targetEpisodeCount = n;
  }
  const spe = input.shotsPerEpisode;
  if (typeof spe === "number" && Number.isFinite(spe) && spe > 0) {
    out.shotsPerEpisode = spe;
  } else if (typeof spe === "string" && spe.trim()) {
    const n = Number(spe);
    if (Number.isFinite(n) && n > 0) out.shotsPerEpisode = n;
  }
  const sp = input.stylePainting;
  if (typeof sp === "string" && sp.trim()) out.stylePainting = sp;
  const dl = input.dialogLanguage;
  if (typeof dl === "string" && dl.trim()) out.dialogLanguage = dl;
  return out;
}
