/**
 * Workflow HITL client — talks to the Nest proxies at /aurora/workflow/* and
 * /aurora/drafts/*, which forward to Mastra.
 *
 * We don't import from @repo/shared here (web app doesn't depend on it); the
 * types below mirror the canonical shapes in `packages/shared/src/workflow.ts`
 * and `apps/agent/src/mastra/lib/drafts.ts`.
 */

// ─── Types (mirror apps/agent + shared) ────────────────────────────────

export type WorkflowStatus =
  | "queued"
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled";

export type WorkflowName =
  | "main_flow"
  | "role_design"
  | "batch_create_asset"
  | "script_edit"
  | "story_outline"
  | "role_phase"
  | "role_image_phase"
  | "episode_phase"
  | "script_phase"
  | "storyboard_phase";

/** Mirrors packages/shared/src/error-classification.ts — keep in sync. */
export type ErrorClassification =
  | "upstream_rate_limit"
  | "upstream_timeout"
  | "upstream_auth"
  | "content_policy"
  | "invalid_input"
  | "server_error"
  | "network"
  | "unknown";

export type WorkflowProgress = {
  current: number;
  total: number;
  label?: string;
};

export type WorkflowEventType =
  | "enqueued"
  | "started"
  | "step.started"
  | "step.completed"
  | "step.failed"
  | "progress"
  | "narrate"
  | "suspended"
  | "resumed"
  | "completed"
  | "failed"
  | "cancelled";

export type NarrateEventData = {
  persona?: string;
  text: string;
};

export type WorkflowEvent = {
  id?: string;
  runId: string;
  timestamp: number;
  type: WorkflowEventType;
  data?: unknown;
};

export type WorkflowStatusResponse = {
  runId: string;
  workflowName: WorkflowName;
  workspaceId: string;
  userId: string;
  status: WorkflowStatus;
  currentStep?: string;
  progress?: WorkflowProgress;
  startedAt: number;
  updatedAt: number;
  completedAt?: number;
  error?: string;
  errorClassification?: ErrorClassification;
  suspendPayload?: unknown;
  result?: unknown;
  recentEvents?: WorkflowEvent[];
};

/**
 * Short friendly label per classification. Caller wraps in t() under the
 * "workflowError" namespace (see apps/web/messages/*.json).
 */
export function workflowErrorLabelKey(c: ErrorClassification | undefined): string {
  if (!c) return "workflowError.unknown";
  return `workflowError.${c}`;
}

/**
 * Whether the failure is worth showing a "retry" button vs telling the
 * user they need to adjust something first. Mirrors isAutoRetryable in
 * packages/shared/src/error-classification.ts.
 */
export function isErrorRetryable(c: ErrorClassification | undefined): boolean {
  return c !== "content_policy" && c !== "invalid_input" && c !== "upstream_auth";
}

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

export type DraftsResponse = {
  runId: string;
  drafts: Draft[];
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

export async function getWorkflowStatus(
  runId: string,
  projectId: string,
  signal?: AbortSignal
): Promise<WorkflowStatusResponse> {
  const url = `/aurora/workflow/${encodeURIComponent(runId)}/status?projectId=${encodeURIComponent(projectId)}`;
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) throw new WorkflowApiError(response.status, await readError(response));
  return (await response.json()) as WorkflowStatusResponse;
}

export async function getWorkflowDrafts(
  runId: string,
  projectId: string,
  entityType?: DraftEntityType,
  signal?: AbortSignal
): Promise<DraftsResponse> {
  const qs = new URLSearchParams({ projectId });
  if (entityType) qs.set("entityType", entityType);
  const url = `/aurora/drafts/${encodeURIComponent(runId)}?${qs.toString()}`;
  const response = await fetch(url, { credentials: "include", signal });
  if (!response.ok) throw new WorkflowApiError(response.status, await readError(response));
  return (await response.json()) as DraftsResponse;
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

// ─── Status helpers ────────────────────────────────────────────────────

export function isTerminal(status: WorkflowStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export function isAwaitingUser(status: WorkflowStatus): boolean {
  return status === "suspended";
}
