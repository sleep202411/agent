/**
 * Workflow HITL client — talks to the Nest proxies at /aurora/workflow/* and
 * /aurora/drafts/*, which forward to Mastra.
 *
 * The types below mirror the canonical shapes in `packages/shared` +
 * `apps/agent/src/mastra/lib/drafts.ts`. The web app deliberately doesn't
 * import `@repo/shared` to keep the dev-build boundary tight.
 */

// ─── Types ─────────────────────────────────────────────────────────────

export type WorkflowName =
  | "role_design"
  | "scene_design"
  | "prop_design"
  | "batch_create_asset"
  | "script_edit"
  | "story_outline"
  | "parse_script"
  | "role_phase"
  | "role_image_phase"
  | "scene_phase"
  | "scene_image_phase"
  | "prop_phase"
  | "prop_image_phase"
  | "episode_phase"
  | "script_phase"
  | "storyboard_phase"
  | "produce_script_pipeline"
  | "produce_step1_episodes"
  | "produce_step2_assets";

export type WorkflowProgress = {
  current: number;
  total: number;
  label?: string;
};

export type DraftEntityType = "role" | "scene" | "prop" | "episode" | "script" | "storyboard";

export type DraftStatus = "pending" | "committing" | "committed" | "failed" | "discarded";

export type Draft<T = unknown> = {
  clientRefId: string;
  runId: string;
  entityType: DraftEntityType;
  status: DraftStatus;
  data: T;
  serverId?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
  updatedBy?: string;
};

export type ConfirmPayload = {
  approved: boolean;
  feedback?: string;
  acceptedClientRefIds?: string[];
};

// ─── Error helper ──────────────────────────────────────────────────────

class WorkflowApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
    this.name = "WorkflowApiError";
  }
}

async function readError(response: Response): Promise<string> {
  try {
    const data = (await response.json()) as { message?: string };
    return data.message ?? `HTTP ${response.status}`;
  } catch {
    return `HTTP ${response.status}`;
  }
}

// ─── Fetch wrappers ────────────────────────────────────────────────────

/**
 * Patch a pending draft's `data` fields — shallow-merged server-side.
 * Used by DraftDetailDialog to persist inline prompt edits (e.g. the
 * Seedance 2.0 wrapper) so the workflow's resume picks them up.
 */
export async function updateDraftData(
  runId: string,
  clientRefId: string,
  projectId: string,
  data: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Draft> {
  const qs = new URLSearchParams({ projectId });
  const url = `/aurora/drafts/${encodeURIComponent(runId)}/${encodeURIComponent(
    clientRefId
  )}?${qs.toString()}`;
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
    signal,
  });
  if (!response.ok) throw new WorkflowApiError(response.status, await readError(response));
  const body = (await response.json()) as { draft: Draft };
  return body.draft;
}

/**
 * HITL approval button — commit drafts or reject them.
 * approved=true → commit drafts and resume.
 * approved=false + feedback → loop back to generation step with guidance.
 */
export async function confirmWorkflow(
  runId: string,
  projectId: string,
  payload: ConfirmPayload
): Promise<{ ok: true }> {
  const url = `/aurora/workflow/${encodeURIComponent(runId)}/confirm`;
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, ...payload }),
  });
  if (!response.ok) throw new WorkflowApiError(response.status, await readError(response));
  return (await response.json()) as { ok: true };
}

/**
 * Deterministic workflow dispatch — bypasses the supervisor LLM entirely.
 * Used by "continue" / retry buttons that know exactly which workflow to run
 * next. The LLM-routed path (invoke_workflow tool inside the supervisor) is
 * still used for freeform natural-language requests typed by the user.
 */
export async function startWorkflow(payload: {
  projectId: string;
  worldId?: string;
  workflowName: WorkflowName;
  inputData?: Record<string, unknown>;
}): Promise<{ runId: string; workflowName: WorkflowName }> {
  const response = await fetch("/aurora/workflow/start", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!response.ok) throw new WorkflowApiError(response.status, await readError(response));
  return (await response.json()) as { runId: string; workflowName: WorkflowName };
}

export async function cancelWorkflow(runId: string, projectId: string): Promise<{ ok: true }> {
  const url = `/aurora/workflow/${encodeURIComponent(runId)}/cancel`;
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  });
  if (!response.ok) throw new WorkflowApiError(response.status, await readError(response));
  return (await response.json()) as { ok: true };
}
