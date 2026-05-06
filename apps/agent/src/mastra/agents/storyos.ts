import { Agent } from "@mastra/core/agent";
import {
  addShot,
  analyzeBrief,
  batchCreateCharacter,
  batchCreateEpisode,
  batchCreateProp,
  batchCreateScene,
  batchSaveEpisodeScripts,
  batchUpdateStoryboardRows,
  generateCharacterImage,
  generatePropImage,
  generateSceneImage,
  configureParams,
  deleteEpisode,
  deleteShot,
  evaluateDrafts,
  explainCurrentState,
  exportScripts,
  generateProjectCover,
  listAssets,
  markProjectParamsUpdated,
  queryContext,
  queryStoryboardRows,
  requireProjectParams,
  saveEpisodeScript,
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
  askPropDesigner,
  askSceneDesigner,
  askScriptwriter,
  askStoryboardDesigner,
} from "../tools/personas";
import { storyosInstructions } from "../prompts/storyos";
import { defaultRouterModel } from "../lib/models";

/**
 * Supervisor agent — the only agent surface the user talks to.
 *
 * **Workflow engine removed (2026-05-05).** The supervisor no longer
 * dispatches background phase workflows; it consults persona agents
 * via `ask_*` for drafts and commits results via direct CRUD tools.
 * The Mastra workflow registration, `invoke_workflow` /
 * `cancel_workflow` / `list_active_workflows` / `apply_phase_drafts`
 * tools, and the prereq-checking phase guards have all been
 * unregistered from this agent — files remain in the repo for now in
 * case we revisit, but the LLM cannot reach them.
 */
export const storyosAgent = new Agent({
  id: "storyos",
  name: "StoryOS",
  description:
    "FizzSpace StoryOS supervisor — consults specialist personas, commits results via direct CRUD, and coordinates HITL with the user.",
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
    // ─── Persona consultations ─────────────────────────
    // Each `ask_*` calls a specialist agent with structured output
    // ({summary, fields}). No DB writes, no HITL pause, no queue —
    // just synchronous LLM consult that returns drafts the supervisor
    // can pipe straight into the matching commit tool below.
    ask_scriptwriter: askScriptwriter,
    ask_character_designer: askCharacterDesigner,
    ask_scene_designer: askSceneDesigner,
    ask_prop_designer: askPropDesigner,
    ask_art_director: askArtDirector,
    ask_storyboard_designer: askStoryboardDesigner,
    ask_episode_planner: askEpisodePlanner,

    // ─── Direct CRUD commits ───────────────────────────
    // Supervisor takes the {fields} from an ask_* reply (or builds
    // its own payload after a chat with the user) and calls these
    // to persist to Java.
    batch_create_character: batchCreateCharacter,
    batch_create_scene: batchCreateScene,
    batch_create_prop: batchCreateProp,
    batch_create_episode: batchCreateEpisode,
    update_project: updateProject,
    update_episode: updateEpisode,
    delete_episode: deleteEpisode,
    update_storyboard_row: updateStoryboardRow,
    batch_update_storyboard_rows: batchUpdateStoryboardRows,
    delete_shot: deleteShot,
    add_shot: addShot,
    save_episode_script: saveEpisodeScript,
    batch_save_episode_scripts: batchSaveEpisodeScripts,

    // ─── Image generation ──────────────────────────────
    // Atomic single-image calls — blocking 5–30s per asset. For bulk
    // regenerates the supervisor pipelines these in series / batch
    // explicitly; there's no "phase" wrapper anymore.
    generate_character_image: generateCharacterImage,
    generate_scene_image: generateSceneImage,
    generate_prop_image: generatePropImage,
    generate_project_cover: generateProjectCover,

    // ─── Project setup helpers ─────────────────────────
    analyze_brief: analyzeBrief,
    save_project_meta: saveProjectMeta,
    require_project_params: requireProjectParams,
    configure_params: configureParams,
    mark_project_params_updated: markProjectParamsUpdated,

    // ─── HITL primitives ───────────────────────────────
    show_options: showOptions,

    // ─── State reads / review ──────────────────────────
    explain_current_state: explainCurrentState,
    query_context: queryContext,
    query_storyboard_rows: queryStoryboardRows,
    list_assets: listAssets,
    show_drafts: showDrafts,
    evaluate: evaluateDrafts,
    export_scripts: exportScripts,
  },
});
