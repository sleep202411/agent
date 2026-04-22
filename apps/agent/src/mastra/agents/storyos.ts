import { Agent } from "@mastra/core/agent";
import {
  addShot,
  analyzeBrief,
  applyPhaseDrafts,
  batchUpdateStoryboardRows,
  cancelWorkflowTool,
  configureParams,
  deleteEpisode,
  deleteShot,
  evaluateDrafts,
  explainCurrentState,
  exportScripts,
  generateProjectCover,
  invokeWorkflow,
  listActiveWorkflows,
  listAssets,
  markProjectParamsUpdated,
  queryContext,
  requireProjectParams,
  saveProjectMeta,
  showDrafts,
  showOptions,
  updateEpisode,
  updateProject,
  updateStoryboardRow,
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
  // System prompt as an array so we can attach provider-specific options.
  // `providerOptions.anthropic.cacheControl` marks this block as cacheable
  // on Claude — cuts ~8k input tokens per turn down to the 10% cached price
  // and, crucially, removes them from TPM so Tier 2 (80k ITPM) can keep up
  // with 500 concurrent users. Non-Anthropic providers ignore the key.
  instructions: [
    {
      role: "system" as const,
      content: storyosInstructions,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" as const } },
      },
    },
  ],
  // Resolved per-request so startup succeeds even if the API key is injected
  // later (e.g. via Mastra Studio settings UI or a secrets-loader middleware).
  model: () => defaultRouterModel(),
  tools: {
    // Workflow orchestration (heavy tasks — batch / HITL / DB commit)
    invoke_workflow: invokeWorkflow,
    cancel_workflow: cancelWorkflowTool,
    list_active_workflows: listActiveWorkflows,
    explain_current_state: explainCurrentState,
    // HITL commit/discard — every HITL phase (scene/role/prop/episode/
    // script/storyboard) emits drafts and ends. User confirm/revise goes
    // through this tool; Nest button short-circuit also calls it via
    // /workflow/:runId/confirm → phase-specific apply helper.
    apply_phase_drafts: applyPhaseDrafts,
    // Preflight UI gate — legacy Java-backed param form. Kept registered
    // for back-compat but the prompt now drives `configure_params` instead.
    require_project_params: requireProjectParams,
    // New pattern: generation-time params collected via a generic multi-
    // field form, values live only in conversation context — no Java write,
    // no workspaceContext plumbing. Supervisor passes the collected values
    // into subsequent invoke_workflow inputData.
    configure_params: configureParams,
    // Generic "user picks from a list" HITL. Supervisor calls it when intent
    // is legitimately ambiguous (not when the supervisor just wants to avoid
    // committing). See storyos.ts prompt for when-to-call rules.
    show_options: showOptions,
    // UI ack — renders "✓ 更新项目参数" after <PROJECT_PARAMS_CONFIRMED />.
    mark_project_params_updated: markProjectParamsUpdated,
    // Auto cover generation via Replicate (no user credits).
    generate_project_cover: generateProjectCover,
    // Quick one-shot brief extraction (name, description, core, param
    // suggestions) to seed a new project with user material. Used BEFORE
    // require_project_params on a fresh project.
    analyze_brief: analyzeBrief,
    // Silent writer for project header + world world-building fields.
    // Callable right after analyze_brief — only fills empty slots.
    save_project_meta: saveProjectMeta,
    // State reads + quality review
    query_context: queryContext,
    list_assets: listAssets,
    show_drafts: showDrafts,
    evaluate: evaluateDrafts,
    // Fine-grained direct writes — atomic CRUD the LLM orchestrates itself.
    // Big structural regenerates still go through invoke_workflow.
    update_project: updateProject,
    update_episode: updateEpisode,
    delete_episode: deleteEpisode,
    update_storyboard_row: updateStoryboardRow,
    batch_update_storyboard_rows: batchUpdateStoryboardRows,
    delete_shot: deleteShot,
    add_shot: addShot,
    export_scripts: exportScripts,
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
