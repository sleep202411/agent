/**
 * Shared project-param checks. Single source of truth for:
 *   - which workflows require params to be set before they can run
 *   - whether a given project's ProjectDetail payload has all required params
 *
 * Used by the web form (ProjectParamsForm.isProjectParamsComplete) and the
 * agent's invoke_workflow tool (runtime guard against supervisor skipping
 * the require_project_params preflight).
 */
import type { WorkflowName } from "./workflow.js";

/**
 * Subset of Java's `/api/user/project/detail/:id` response relevant to
 * preflight. Kept loose so both Web and Agent can pass their full detail
 * object without a conversion step.
 */
export interface ProjectParamsDetail {
  aspectRatioType?: string | null;
  chapterLength?: number | null;
  stylePainting?: string | null;
  dialogLanguage?: string | null;
}

/** Param keys the UI form collects. `dialogLanguage` currently not persisted. */
export type ProjectParamKey = "aspectRatioType" | "chapterLength" | "stylePainting";

/**
 * Workflows that mutate the project / generate bulk content. These require
 * params; read-only / discussion / edit-single tools (batch_create_asset,
 * script_edit, ask_*) do not.
 */
export const GENERATIVE_WORKFLOWS: ReadonlySet<WorkflowName> = new Set<WorkflowName>([
  "main_flow",
  "story_outline",
  "role_design",
  "scene_design",
  "prop_design",
  "role_phase",
  "role_image_phase",
  "scene_phase",
  "scene_image_phase",
  "prop_phase",
  "prop_image_phase",
  "episode_phase",
  "script_phase",
  "storyboard_phase",
]);

export function isGenerativeWorkflow(name: WorkflowName): boolean {
  return GENERATIVE_WORKFLOWS.has(name);
}

/**
 * Returns which required params are still unset on the given project. Empty
 * array = project is ready to run generative workflows.
 */
export function getMissingProjectParams(
  detail: ProjectParamsDetail | null | undefined
): ProjectParamKey[] {
  if (!detail) return ["aspectRatioType", "chapterLength", "stylePainting"];
  const missing: ProjectParamKey[] = [];
  if (!detail.aspectRatioType) missing.push("aspectRatioType");
  if (typeof detail.chapterLength !== "number" || detail.chapterLength <= 0) {
    missing.push("chapterLength");
  }
  if (!detail.stylePainting) missing.push("stylePainting");
  return missing;
}

export function isProjectParamsComplete(detail: ProjectParamsDetail | null | undefined): boolean {
  return getMissingProjectParams(detail).length === 0;
}
