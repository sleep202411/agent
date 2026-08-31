import { AgentEventEnvelopeSchema, type AgentEventEnvelope } from "@repo/agent-protocol";
import type { AgentProjectKind } from "@repo/agent-capabilities";
import type {
  StoryProductionContinuationPlan,
  StoryProductionTargetStage,
} from "@repo/agent-tools";
import {
  verifyProjectSkillSnapshot,
  type ProjectSkillResolutionSnapshot,
} from "@repo/agent-skills";

export class AgentOsJournalReportError extends Error {
  constructor(
    readonly runId: string,
    readonly status: number,
    detail?: string
  ) {
    super(
      `Gateway rejected Agent OS journal ${runId} with HTTP ${status}${detail ? `: ${detail}` : ""}`
    );
    this.name = "AgentOsJournalReportError";
  }
}

export type StartExecutionProof = {
  executionToken: string;
  executionAttemptId: string;
  executionEpoch: number;
  executionOwnerId: string;
  checkpointId?: string;
  checkpointNamespace?: string;
  checkpointThreadId?: string;
  checkpointMessageId?: string;
};

export type ContinuationExecutionProof = {
  executionToken: string;
  executionAttemptId: string;
  executionEpoch: number;
  executionOwnerId: string;
  checkpointId?: string;
  checkpointNamespace?: string;
  checkpointThreadId?: string;
};

export type ContinuationCommand =
  | {
      kind: "approval";
      runId: string;
      turnId: string;
      responseId: string;
      approvalId: string;
      decision: "approve" | "reject";
      projectId: string;
      conversationId: string;
      actorId: string;
      modelProfileId: string;
      projectKind: AgentProjectKind;
      workbenchMode: string;
      workbenchContext?: Readonly<Record<string, string>>;
      permissionMode: "ask" | "smart" | "full";
      skillMountSnapshot: ProjectSkillResolutionSnapshot;
    }
  | {
      kind: "user_input";
      runId: string;
      turnId: string;
      responseId: string;
      requestId: string;
      answers: Record<string, string>;
      projectId: string;
      conversationId: string;
      actorId: string;
      modelProfileId: string;
      projectKind: AgentProjectKind;
      workbenchMode: string;
      workbenchContext?: Readonly<Record<string, string>>;
      permissionMode: "ask" | "smart" | "full";
      skillMountSnapshot: ProjectSkillResolutionSnapshot;
    }
  | {
      kind: "external_result";
      runId: string;
      turnId: string;
      responseId: string;
      externalJobId: string;
      toolCallId: string;
      toolId: string;
      resultMessageId: string;
      phase: "apply";
      outcome: "completed";
      storyContinuation?: {
        locale: "en-US" | "zh-CN" | "zh-HK";
        plan: StoryProductionContinuationPlan;
        completedStage?: StoryProductionTargetStage;
        mediaBatchCompleted?: boolean;
      };
      projectId: string;
      conversationId: string;
      actorId: string;
      modelProfileId: string;
      projectKind: AgentProjectKind;
      workbenchMode: string;
      workbenchContext?: Readonly<Record<string, string>>;
      permissionMode: "ask" | "smart" | "full";
      skillMountSnapshot: ProjectSkillResolutionSnapshot;
    };

export type JournalReportReceipt = {
  startExecutionDisposition?: "granted" | "accepted";
  continuationExecutionDisposition?: "granted" | "accepted";
};

/**
 * Push the full event journal snapshot to Nest for durable storage.
 *
 * Once a Gateway is configured, persistence is fail-closed: callers must not
 * expose a user-input acknowledgement or paused/terminal state that PostgreSQL
 * has not accepted. The run service decides whether to fail the HTTP action or
 * keep retrying a state that can no longer safely be abandoned.
 */
export async function reportJournalToNest(input: {
  runId: string;
  projectId: string;
  conversationId: string;
  actorId: string;
  modelProfileId: string;
  status: string;
  /** Tail included in this full snapshot; Gateway rejects stale regressions. */
  lastSequence: number;
  events: readonly AgentEventEnvelope[];
  pendingApproval?: unknown;
  pendingUserInput?: unknown;
  pendingExternal?: unknown;
  assistantText?: string | null;
  projectKind?: AgentProjectKind;
  workbenchMode?: string;
  workbenchContext?: Readonly<Record<string, string>>;
  skillMountSnapshot?: ProjectSkillResolutionSnapshot;
  startExecution?: StartExecutionProof;
  continuationCommand?: ContinuationCommand;
  continuationExecution?: ContinuationExecutionProof;
}): Promise<JournalReportReceipt> {
  const baseUrl = process.env.AGENT_OS_DOMAIN_URL?.trim();
  const token = process.env.AGENT_OS_INTERNAL_TOKEN?.trim();
  if (!baseUrl || !token) return {};

  const url = `${baseUrl.replace(/\/$/, "")}/internal/agent-os/runs/${encodeURIComponent(input.runId)}/journal`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-agent-os-internal-token": token,
      },
      body: JSON.stringify({
        projectId: input.projectId,
        conversationId: input.conversationId,
        actorId: input.actorId,
        modelProfileId: input.modelProfileId,
        status: input.status,
        lastSequence: input.lastSequence,
        events: input.events,
        pendingApproval: input.pendingApproval ?? null,
        pendingUserInput: input.pendingUserInput ?? null,
        pendingExternal: input.pendingExternal ?? null,
        assistantText: input.assistantText ?? null,
        projectKind: input.projectKind,
        workbenchMode: input.workbenchMode,
        workbenchContext: input.workbenchContext,
        skillMountSnapshot: input.skillMountSnapshot,
        startExecution: input.startExecution,
        continuationCommand: input.continuationCommand,
        continuationExecution: input.continuationExecution,
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const detail = (await res.text()).trim().slice(0, 2_000);
      throw new AgentOsJournalReportError(input.runId, res.status, detail || undefined);
    }
    const responseText = await res.text();
    if (!responseText.trim()) return {};
    const receipt = JSON.parse(responseText) as {
      startExecutionDisposition?: unknown;
      continuationExecutionDisposition?: unknown;
    };
    return {
      ...(receipt.startExecutionDisposition === "granted" ||
      receipt.startExecutionDisposition === "accepted"
        ? { startExecutionDisposition: receipt.startExecutionDisposition }
        : {}),
      ...(receipt.continuationExecutionDisposition === "granted" ||
      receipt.continuationExecutionDisposition === "accepted"
        ? {
            continuationExecutionDisposition: receipt.continuationExecutionDisposition,
          }
        : {}),
    };
  } catch (error) {
    process.stderr.write(
      `${JSON.stringify({
        level: "warn",
        msg: "agent-os.journal.report_error",
        runId: input.runId,
        error: error instanceof Error ? error.message : String(error),
      })}\n`
    );
    throw error;
  }
}

/**
 * Read a run's durable journal back from Nest.
 *
 * Used when a worker restarts mid-run: the in-process journal is gone, and
 * appending from sequence 1 would make the next full-snapshot persist overwrite
 * the stored transcript with a shorter one. Returns null when the gateway is
 * not configured or does not know the run.
 */
export type DurableAgentRunJournal = {
  status: string;
  events: AgentEventEnvelope[];
  pendingApproval: unknown;
  pendingUserInput: unknown;
  pendingExternal: unknown;
  assistantText: string | null;
  projectKind: AgentProjectKind | null;
  workbenchMode: string | null;
  workbenchContext: Readonly<Record<string, string>> | null;
  skillMountSnapshot: ProjectSkillResolutionSnapshot | null;
  startExecutionPending: boolean;
  startExecutionCheckpointId: string | null;
  startExecutionCheckpointNamespace: string | null;
  startExecutionCheckpointThreadId: string | null;
  startExecutionCheckpointMessageId: string | null;
  continuationExecutionPending: boolean;
  continuationExecutionCheckpointId: string | null;
  continuationExecutionCheckpointNamespace: string | null;
  continuationExecutionCheckpointThreadId: string | null;
};

export async function fetchJournalFromNest(
  runId: string,
  options: { requireExisting?: boolean } = {}
): Promise<DurableAgentRunJournal | null> {
  const baseUrl = process.env.AGENT_OS_DOMAIN_URL?.trim();
  const token = process.env.AGENT_OS_INTERNAL_TOKEN?.trim();
  if (!baseUrl || !token) return null;

  const url = `${baseUrl.replace(/\/$/, "")}/internal/agent-os/runs/${encodeURIComponent(runId)}/journal`;
  try {
    const res = await fetch(url, {
      headers: { "x-agent-os-internal-token": token },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      throw new Error(`Gateway journal read ${runId} failed with HTTP ${res.status}`);
    }
    const body = (await res.json()) as {
      ok?: boolean;
      status?: string;
      events?: AgentEventEnvelope[];
      pendingApproval?: unknown;
      pendingUserInput?: unknown;
      pendingExternal?: unknown;
      assistantText?: string | null;
      projectKind?: AgentProjectKind | null;
      workbenchMode?: string | null;
      workbenchContext?: Readonly<Record<string, string>> | null;
      skillMountSnapshot?: unknown;
      startExecutionPending?: unknown;
      startExecutionCheckpointId?: unknown;
      startExecutionCheckpointNamespace?: unknown;
      startExecutionCheckpointThreadId?: unknown;
      startExecutionCheckpointMessageId?: unknown;
      continuationExecutionPending?: unknown;
      continuationExecutionCheckpointId?: unknown;
      continuationExecutionCheckpointNamespace?: unknown;
      continuationExecutionCheckpointThreadId?: unknown;
    };
    if (!body.ok) {
      if (options.requireExisting) {
        throw new Error(`Gateway has no durable reservation for Agent OS run ${runId}`);
      }
      return null;
    }
    const events = AgentEventEnvelopeSchema.array().safeParse(body.events);
    if (!events.success) {
      throw new Error(`Gateway returned a malformed durable journal for Agent OS run ${runId}`);
    }
    const skillMountSnapshot = verifyProjectSkillSnapshot(body.skillMountSnapshot);
    return {
      status: typeof body.status === "string" ? body.status : "running",
      events: events.data,
      pendingApproval: body.pendingApproval ?? null,
      pendingUserInput: body.pendingUserInput ?? null,
      pendingExternal: body.pendingExternal ?? null,
      assistantText: body.assistantText ?? null,
      projectKind:
        body.projectKind === "platform" || body.projectKind === "story" ? body.projectKind : null,
      workbenchMode: typeof body.workbenchMode === "string" ? body.workbenchMode : null,
      workbenchContext:
        body.workbenchContext && typeof body.workbenchContext === "object"
          ? body.workbenchContext
          : null,
      skillMountSnapshot,
      startExecutionPending: body.startExecutionPending === true,
      startExecutionCheckpointId:
        typeof body.startExecutionCheckpointId === "string"
          ? body.startExecutionCheckpointId
          : null,
      startExecutionCheckpointNamespace:
        typeof body.startExecutionCheckpointNamespace === "string"
          ? body.startExecutionCheckpointNamespace
          : null,
      startExecutionCheckpointThreadId:
        typeof body.startExecutionCheckpointThreadId === "string"
          ? body.startExecutionCheckpointThreadId
          : null,
      startExecutionCheckpointMessageId:
        typeof body.startExecutionCheckpointMessageId === "string"
          ? body.startExecutionCheckpointMessageId
          : null,
      continuationExecutionPending: body.continuationExecutionPending === true,
      continuationExecutionCheckpointId:
        typeof body.continuationExecutionCheckpointId === "string"
          ? body.continuationExecutionCheckpointId
          : null,
      continuationExecutionCheckpointNamespace:
        typeof body.continuationExecutionCheckpointNamespace === "string"
          ? body.continuationExecutionCheckpointNamespace
          : null,
      continuationExecutionCheckpointThreadId:
        typeof body.continuationExecutionCheckpointThreadId === "string"
          ? body.continuationExecutionCheckpointThreadId
          : null,
    };
  } catch (error) {
    if (options.requireExisting) throw error;
    return null;
  }
}
