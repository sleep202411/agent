/**
 * Meta-tools exposed to the router agent. Intentionally narrow: no direct
 * writes to business data, no "create_role" / "generate_image" short cuts.
 * Everything with side effects lives inside workflows.
 */
export { invokeWorkflow } from "./invoke-workflow";
export { cancelWorkflowTool } from "./cancel-workflow";
export { queryContext } from "./query-context";
export { showDrafts } from "./show-drafts";
export { listActiveWorkflows } from "./list-workflows";
export { explainCurrentState } from "./explain-state";
export { evaluateDrafts } from "./evaluate";
export { requireProjectParams } from "./require-params";
export { resumeWorkflowTool } from "./resume-workflow";
export { applyPhaseDrafts } from "./apply-phase-drafts";
export { configureParams } from "./configure-params";
export { markProjectParamsUpdated } from "./mark-project-params-updated";
export { generateProjectCover } from "./generate-project-cover";
export { analyzeBrief } from "./analyze-brief";
export { saveProjectMeta } from "./save-project-meta";
// Fine-grained direct writes — LLM-orchestrated, no HITL. For rename / quick
// edits. Big structural changes (bulk regenerate) stay in workflows.
export { updateProject } from "./update-project";
export { updateEpisode, deleteEpisode } from "./episode-crud";
export { listAssets } from "./list-assets";
export { updateStoryboardRow } from "./update-storyboard-row";
export { batchUpdateStoryboardRows } from "./batch-update-storyboard-rows";
export { deleteShot } from "./delete-shot";
export { addShot } from "./add-shot";
export { batchCreateCharacter, batchCreateScene, batchCreateProp } from "./batch-create-assets";
export {
  generateCharacterImage,
  generateSceneImage,
  generatePropImage,
} from "./generate-asset-image";
export { exportScripts } from "./export-scripts";
// Generic client-side HITL picker — supervisor calls it when the user's
// intent is genuinely ambiguous and the options have material trade-offs.
export { showOptions } from "./show-options";
