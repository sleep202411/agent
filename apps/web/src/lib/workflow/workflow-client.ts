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
  | "storyboard_phase";

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

/**
 * Liveness ping — frontend posts every ~10s while the chat is open.
 * Backend's reaper cancels runs whose heartbeats have gone stale,
 * freeing worker slots for the next user. Best-effort: errors are
 * swallowed so a transient 502 / network blip doesn't trigger UI
 * noise; the next tick will retry.
 */
export async function heartbeatWorkflow(runId: string, projectId: string): Promise<void> {
  const url = `/aurora/workflow/${encodeURIComponent(runId)}/heartbeat`;
  await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId }),
  }).catch(() => {
    /* heartbeat is best-effort; let the next tick retry */
  });
}

/**
 * Best-effort cancel emitted from `pagehide`. Uses navigator.sendBeacon
 * (the only reliable way to fire a request as the page unloads), so
 * the browser doesn't drop it on the floor like fetch typically does.
 * `projectId` rides as a query param because sendBeacon's body
 * Content-Type is unreliable across browsers.
 */
export function cancelWorkflowOnLeave(runId: string, projectId: string): void {
  if (typeof navigator === "undefined" || typeof navigator.sendBeacon !== "function") return;
  const qs = new URLSearchParams({ projectId }).toString();
  const url = `/aurora/workflow/${encodeURIComponent(runId)}/cancel-on-leave?${qs}`;
  // sendBeacon needs a non-empty payload of some kind to dispatch
  // reliably across browsers; an empty string works on most, but a
  // Blob with type text/plain is the most portable choice.
  const blob = new Blob([""], { type: "text/plain" });
  try {
    navigator.sendBeacon(url, blob);
  } catch {
    /* sendBeacon may throw on quota / scheme issues; nothing to do here */
  }
}
