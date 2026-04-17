import { Agent } from "@mastra/core/agent";
import {
  cancelWorkflowTool,
  explainCurrentState,
  invokeWorkflow,
  listActiveWorkflows,
  queryContext,
  showDrafts,
} from "../tools/meta";
import { storyosInstructions } from "../prompts/storyos";
import { defaultRouterModel } from "../lib/models";

/**
 * The router agent — the only agent surface the user talks to. Holds only
 * meta-tools; all business logic (generate, write, commit) lives inside
 * workflows invoked via `invoke_workflow`. See `docs/storyos-v2/phase-2-design.md`
 * §8 for the rationale.
 */
export const storyosAgent = new Agent({
  id: "storyos",
  name: "StoryOS",
  description: "FizzSpace StoryOS router agent — translates user intent into workflow invocations.",
  instructions: storyosInstructions,
  // Resolved per-request so startup succeeds even if the API key is injected
  // later (e.g. via Mastra Studio settings UI or a secrets-loader middleware).
  model: () => defaultRouterModel(),
  tools: {
    invoke_workflow: invokeWorkflow,
    cancel_workflow: cancelWorkflowTool,
    query_context: queryContext,
    show_drafts: showDrafts,
    list_active_workflows: listActiveWorkflows,
    explain_current_state: explainCurrentState,
  },
});
