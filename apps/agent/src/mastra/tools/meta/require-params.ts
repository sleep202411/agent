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
    "When the user wants to start creating (analyze material / generate characters / write scripts / build storyboards / kick off the main flow) but the project's core params (aspect ratio / per-episode length / art style / dialogue language) aren't all set yet, call this tool to open a params form. After confirmed:true the frontend forwards the confirmed params + onConfirmWorkflow to Nest, which persists the params and starts the declared workflow directly (no extra LLM round-trip). Only call when the user has clearly expressed creation intent; do NOT call for read-only or discussion-only requests. If analyze_brief just ran, forward its suggestedParams object into this tool's suggestedParams input. If you already know which workflow to start next, you **must** also pass onConfirmWorkflow.",
  inputSchema: z.object({
    reason: z
      .string()
      .optional()
      .describe("One-sentence reason why params are needed now (for logs)"),
    suggestedParams: SuggestedParamsSchema.optional().describe(
      "Recommended params from analyze_brief. Frontend uses these to pre-fill the form and display the recommendation rationale. Omit if unsure."
    ),
    onConfirmWorkflow: OnConfirmWorkflowSchema.optional().describe(
      "Workflow to start automatically after the user confirms (workflowName + optional inputData). Including this lets the system dispatch without another LLM round-trip, so responses are faster. Omit when intent is unclear."
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
