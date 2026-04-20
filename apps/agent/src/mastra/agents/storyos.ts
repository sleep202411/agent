import { Agent } from "@mastra/core/agent";
import {
  cancelWorkflowTool,
  evaluateDrafts,
  explainCurrentState,
  generateProjectCover,
  invokeWorkflow,
  listActiveWorkflows,
  markProjectParamsUpdated,
  queryContext,
  requireProjectParams,
  resumeWorkflowTool,
  showDrafts,
} from "../tools/meta";
import {
  askArtDirector,
  askCharacterDesigner,
  askEpisodePlanner,
  askSceneDesigner,
  askScriptwriter,
  askStoryboardDesigner,
} from "../tools/personas";
import { storyosInstructions } from "../prompts/storyos";
import { defaultRouterModel } from "../lib/models";

/**
 * Supervisor agent — the only agent surface the user talks to. Plans the
 * creation flow, routes work into background workflows, and observes their
 * outputs to decide the next step. Holds only meta-tools; all generation
 * lives inside workflows invoked via `invoke_workflow`.
 *
 * Differs from the original "router" design in that it is allowed (and
 * expected) to reason about user intent, chain related phases when safe,
 * and ask clarifying questions when ambiguous — see prompts/storyos.ts.
 */
export const storyosAgent = new Agent({
  id: "storyos",
  name: "StoryOS",
  description:
    "FizzSpace StoryOS supervisor — plans the creation flow, dispatches work into workflows, and coordinates HITL with the user.",
  instructions: storyosInstructions,
  // Resolved per-request so startup succeeds even if the API key is injected
  // later (e.g. via Mastra Studio settings UI or a secrets-loader middleware).
  model: () => defaultRouterModel(),
  tools: {
    // Workflow orchestration (heavy tasks — batch / HITL / DB commit)
    invoke_workflow: invokeWorkflow,
    cancel_workflow: cancelWorkflowTool,
    list_active_workflows: listActiveWorkflows,
    explain_current_state: explainCurrentState,
    // HITL resume — called on <CONFIRM_WORKFLOW> marker in user message.
    resume_workflow: resumeWorkflowTool,
    // Preflight UI gate — checks the 4 core project params are set before
    // any generative workflow. Frontend renders the form.
    require_project_params: requireProjectParams,
    // UI ack — renders "✓ 更新项目参数" after <PROJECT_PARAMS_CONFIRMED />.
    mark_project_params_updated: markProjectParamsUpdated,
    // Auto cover generation via Replicate (no user credits).
    generate_project_cover: generateProjectCover,
    // State reads + quality review
    query_context: queryContext,
    show_drafts: showDrafts,
    evaluate: evaluateDrafts,
    // Direct-call persona consultations (light tasks — single-turn reply,
    // no DB write, no HITL). See tools/personas/ask-tools.ts.
    ask_scriptwriter: askScriptwriter,
    ask_character_designer: askCharacterDesigner,
    ask_scene_designer: askSceneDesigner,
    ask_art_director: askArtDirector,
    ask_storyboard_designer: askStoryboardDesigner,
    ask_episode_planner: askEpisodePlanner,
  },
});
