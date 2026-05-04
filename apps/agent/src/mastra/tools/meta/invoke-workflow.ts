import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { WORKFLOW_NAMES, type WorkflowName } from "../../lib/redis-keys";
import { getContext, type StoryosContext } from "../../lib/workspace-client";
import { resolveAttachmentRefs } from "../../lib/attachment-resolve";
import { startWorkflow } from "../../workflows/engine";
import { estimateWorkflowCost, getUserBalance } from "../../lib/billing";

export const invokeWorkflow = createTool({
  id: "invoke_workflow",
  description:
    'Start a background workflow (e.g. role_design / script_writing / storyboard_gen). Returns a runId immediately; the worker runs asynchronously. **Any intent that might take > 30s or involves batch generation / writes must go through this tool — never "generate" content yourself in a text reply.** If the user message contains an [attachment "..."] block with an att_xxx ref, pass it via inputData as textRef: "att_xxx" rather than copying the raw text.',
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

    const resolvedInput = await resolveAttachmentRefs(inputData, { projectId: baseCtx.projectId });
    const resolvedObj =
      resolvedInput && typeof resolvedInput === "object" && !Array.isArray(resolvedInput)
        ? (resolvedInput as Record<string, unknown>)
        : {};

    // Chat-history-as-source-of-truth: the 5 generation-time params
    // (targetEpisodeCount / shotsPerEpisode / stylePainting / dialogLanguage,
    // plus chapterLength which doesn't ride on ctx) live in chat history
    // (`Params set: {JSON}` user message), are read by the web client into
    // `workspaceContext`, forwarded as `x-storyos-context`, and seed
    // `requestContext` for this turn — so `baseCtx` already has the
    // canonical values. The LLM is asked to echo them in inputData but
    // historically miscopies (e.g. user picked 11, LLM passes 10 from
    // schema-example priming). Treat ctx as authoritative: strip these
    // params from `resolvedObj` and re-inject from ctx below.
    const llmOverrides = extractGenParamOverrides(resolvedObj);
    const sanitizedResolvedObj: Record<string, unknown> = { ...resolvedObj };
    delete sanitizedResolvedObj.targetEpisodeCount;
    delete sanitizedResolvedObj.shotsPerEpisode;
    delete sanitizedResolvedObj.stylePainting;
    delete sanitizedResolvedObj.dialogLanguage;
    // ctx values from chat history win over anything the LLM passed.
    // Fall back to LLM's value only when ctx doesn't have one (rare path,
    // e.g. very first invoke before configure_params is submitted).
    const ctx: StoryosContext = {
      ...baseCtx,
      targetEpisodeCount: baseCtx.targetEpisodeCount ?? llmOverrides.targetEpisodeCount,
      shotsPerEpisode: baseCtx.shotsPerEpisode ?? llmOverrides.shotsPerEpisode,
      stylePainting: baseCtx.stylePainting ?? llmOverrides.stylePainting,
      dialogLanguage: baseCtx.dialogLanguage ?? llmOverrides.dialogLanguage,
    };
    if (
      typeof llmOverrides.targetEpisodeCount === "number" &&
      typeof baseCtx.targetEpisodeCount === "number" &&
      llmOverrides.targetEpisodeCount !== baseCtx.targetEpisodeCount
    ) {
      // eslint-disable-next-line no-console
      console.warn(
        `[invoke_workflow] ${workflowName} inputData.targetEpisodeCount=${llmOverrides.targetEpisodeCount} but ctx (from chat history)=${baseCtx.targetEpisodeCount}; ctx wins.`
      );
    }

    // Credit preflight: estimate cost + check balance. Uses ctx (chat-history
    // canonical) so the estimate matches what will actually be planned.
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

    // Re-inject the 5 gen params from ctx into inputData. Spread AFTER
    // sanitizedResolvedObj so ctx wins. Phase workflows that read
    // `inputData.targetEpisodeCount` (episode_phase / parse_script) thus
    // see the chat-history value, not the LLM's.
    const needsEpisodeCount = workflowName === "episode_phase" || workflowName === "parse_script";
    const ctxInjections: Record<string, unknown> = {};
    if (needsEpisodeCount) {
      const TARGET_EPISODE_COUNT_DEFAULT = 10;
      let resolvedEpisodeCount: number;
      if (typeof ctx.targetEpisodeCount === "number" && ctx.targetEpisodeCount > 0) {
        resolvedEpisodeCount = ctx.targetEpisodeCount;
      } else if (
        typeof llmOverrides.targetEpisodeCount === "number" &&
        llmOverrides.targetEpisodeCount > 0
      ) {
        resolvedEpisodeCount = llmOverrides.targetEpisodeCount;
      } else {
        // Fallback: neither chat-history ctx nor LLM-supplied value is
        // usable. Happens when the `tool-require_project_params` message
        // is missing from chat history (LRU eviction, never-submitted,
        // partial-streaming state, etc.) AND the supervisor LLM didn't
        // echo the value into inputData. Don't fail the workflow — pick
        // the same default analyze-brief uses and log loudly so we can
        // investigate which arm of the upstream chain dropped the value.
        resolvedEpisodeCount = TARGET_EPISODE_COUNT_DEFAULT;
        console.warn(
          `[invoke_workflow] DEFAULT_TARGET_EPISODE_COUNT used: workflow=${workflowName} projectId=${ctx.projectId} userId=${ctx.userId} fallback=${resolvedEpisodeCount} ` +
            `ctx.targetEpisodeCount=${JSON.stringify(ctx.targetEpisodeCount)} ` +
            `llm.targetEpisodeCount=${JSON.stringify(llmOverrides.targetEpisodeCount)} ` +
            `ctx.shotsPerEpisode=${JSON.stringify(ctx.shotsPerEpisode)} ` +
            `ctx.dialogLanguage=${JSON.stringify(ctx.dialogLanguage)} ` +
            `ctx.stylePainting=${JSON.stringify(ctx.stylePainting)} ` +
            `inputDataKeys=${JSON.stringify(Object.keys(resolvedObj))}`
        );
      }
      ctxInjections.targetEpisodeCount = resolvedEpisodeCount;
    }

    // Supervisor doesn't see projectId / worldId (they live in requestContext),
    // so inject them automatically before the workflow validates its input.
    const injected = {
      projectId: ctx.projectId,
      ...(ctx.worldId ? { worldId: ctx.worldId } : {}),
      ...(ctx.episodeId ? { episodeId: ctx.episodeId } : {}),
      ...sanitizedResolvedObj,
      ...ctxInjections,
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
