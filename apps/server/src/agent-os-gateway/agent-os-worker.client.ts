import { ViewerAssistanceResponseSchema } from '@repo/agent-protocol';
import { z } from 'zod';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AgentProjectKind } from '@repo/agent-capabilities';
import type { ProjectSkillResolutionSnapshot } from '@repo/agent-skills';
import type { AgentOsContinuationCommand } from '../agent-os-journal/agent-os-journal.schemas';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';

export interface AgentOsWorkerRunRequest {
  /** Stable id allocated and durably reserved by Gateway before dispatch. */
  runId: string;
  clientSubmissionId: string;
  turnId: string;
  messageId: string;
  /** Durable semantic execution owner plus one leased dispatch attempt fence. */
  startExecutionToken: string;
  startExecutionAttemptId: string;
  startExecutionEpoch: number;
  projectId: string;
  conversationId: string;
  actorId: string;
  message: string;
  /** Trusted Nest-resolved product state for model reasoning, never transcript UI. */
  modelContext?: string;
  modelProfileId: string;
  attachments?: Array<{ id: string; filename: string }>;
  permissionMode?: 'ask' | 'smart' | 'full';
  projectKind: AgentProjectKind;
  workbenchMode: string;
  workbenchContext?: Readonly<Record<string, string>>;
  skillIds?: string[];
  skillMountSnapshot?: ProjectSkillResolutionSnapshot;
}

export interface AgentOsWorkerRunResponse {
  runId: string;
  status: string;
  pendingApproval?: unknown;
  pendingUserInput?: unknown;
  pendingExternal?: unknown;
  events?: unknown[];
  assistantText?: string;
  characters?: unknown[];
  error?: { code: string; message: string };
  startDisposition?: 'scheduled' | 'already_scheduled' | 'replayed';
}

@Injectable()
export class AgentOsWorkerClient {
  private readonly logger = new Logger(AgentOsWorkerClient.name);

  constructor(private readonly config: AgentOsGatewayConfigService) {}

  async health(): Promise<{ ok: boolean; raw?: unknown }> {
    try {
      const res = await fetch(`${this.config.value.workerBaseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(5_000),
      });
      const raw = (await res.json()) as unknown;
      return { ok: res.ok, raw };
    } catch (error) {
      this.logger.warn(
        `Agent OS worker health failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      return { ok: false };
    }
  }

  async startRun(
    body: AgentOsWorkerRunRequest,
  ): Promise<AgentOsWorkerRunResponse> {
    // Admission holds a cross-pod conversation lock. Worker start is designed
    // to acknowledge immediately and stream in the background, so a slow
    // acknowledgement is an availability failure rather than a ten-minute job.
    return this.postJson('/v1/agent-os/runs', body, 15_000);
  }

  async resumeContinuation(
    body: AgentOsContinuationCommand & {
      continuationExecutionToken: string;
      continuationExecutionAttemptId: string;
      continuationExecutionEpoch: number;
    },
  ): Promise<AgentOsWorkerRunResponse> {
    return this.postJson(
      `/v1/agent-os/runs/${body.runId}/continuations`,
      body,
      15_000,
    );
  }

  async resolveApproval(input: {
    runId: string;
    approvalId: string;
    responseId: string;
    decision: 'approve' | 'reject';
    responseText: string;
    locale: 'en-US' | 'zh-CN' | 'zh-HK';
    projectId: string;
    actorId: string;
    conversationId: string;
    modelProfileId: string;
    projectKind: AgentProjectKind;
    workbenchMode: string;
    workbenchContext?: Readonly<Record<string, string>>;
    permissionMode?: 'ask' | 'smart' | 'full';
  }): Promise<AgentOsWorkerRunResponse> {
    return this.postJson(`/v1/agent-os/runs/${input.runId}/approvals`, {
      approvalId: input.approvalId,
      responseId: input.responseId,
      decision: input.decision,
      responseText: input.responseText,
      locale: input.locale,
      projectId: input.projectId,
      actorId: input.actorId,
      conversationId: input.conversationId,
      modelProfileId: input.modelProfileId,
      projectKind: input.projectKind,
      workbenchMode: input.workbenchMode,
      workbenchContext: input.workbenchContext,
      permissionMode: input.permissionMode,
    });
  }

  async resolveUserInput(input: {
    runId: string;
    requestId: string;
    responseId: string;
    answers: Record<string, string>;
    projectId: string;
    actorId: string;
    conversationId: string;
    modelProfileId: string;
    projectKind: AgentProjectKind;
    workbenchMode: string;
    workbenchContext?: Readonly<Record<string, string>>;
    permissionMode?: 'ask' | 'smart' | 'full';
  }): Promise<AgentOsWorkerRunResponse> {
    // Resume acknowledges only after UserInputResolved + the assistant
    // acknowledgement are durable, then continues inference in background.
    // Keep this below Gateway's response-claim lease so a timed-out dispatch
    // cannot overlap a second lease owner.
    return this.postJson(
      `/v1/agent-os/runs/${input.runId}/user-input`,
      {
        requestId: input.requestId,
        responseId: input.responseId,
        answers: input.answers,
        projectId: input.projectId,
        actorId: input.actorId,
        conversationId: input.conversationId,
        modelProfileId: input.modelProfileId,
        projectKind: input.projectKind,
        workbenchMode: input.workbenchMode,
        workbenchContext: input.workbenchContext,
        permissionMode: input.permissionMode,
      },
      20_000,
    );
  }

  /**
   * The shared secret the worker checks on every /v1 route. It is the only
   * boundary between that process's privileged domain writes and its network,
   * so it travels in both directions, not just worker→Nest.
   */
  private internalHeaders(): Record<string, string> {
    return { 'x-agent-os-internal-token': this.config.value.internalToken };
  }

  /** Model profiles the worker can drive — the picker's source of truth. */
  async listModels(): Promise<unknown> {
    let res: Response;
    try {
      res = await fetch(
        `${this.config.value.workerBaseUrl}/v1/agent-os/models`,
        {
          headers: this.internalHeaders(),
          signal: AbortSignal.timeout(10_000),
        },
      );
    } catch (error) {
      // A dead or unreachable worker must surface as 503, not an unhandled
      // fetch rejection turned into a generic 500; keep the cause in the log
      // so timeout / DNS / refused stay distinguishable during an incident.
      this.logger.warn(
        `Agent OS worker models fetch failed: ${error instanceof Error ? error.message : String(error)}`,
      );
      throw new ServiceUnavailableException({
        code: 'AGENT_OS_WORKER_UNAVAILABLE',
        message: 'Could not reach the Agent OS worker.',
      });
    }
    if (!res.ok) {
      throw new ServiceUnavailableException({
        code: 'AGENT_OS_WORKER_UNAVAILABLE',
        message: 'Could not reach the Agent OS worker.',
      });
    }
    return res.json();
  }

  async listEvents(runId: string, after = 0): Promise<unknown> {
    const url = new URL(
      `${this.config.value.workerBaseUrl}/v1/agent-os/runs/${runId}/events`,
    );
    url.searchParams.set('after', String(after));
    const res = await fetch(url, {
      method: 'GET',
      headers: this.internalHeaders(),
      signal: AbortSignal.timeout(15_000),
    });
    return res.json();
  }

  async cancelRun(
    runId: string,
    reason?: string,
  ): Promise<AgentOsWorkerRunResponse> {
    return this.postJson(
      `/v1/agent-os/runs/${runId}/cancel`,
      {
        reason: reason ?? 'Stopped by user',
      },
      10_000,
    );
  }

  async recommendViewing(body: unknown, signal: AbortSignal) {
    const response = await fetch(
      `${this.config.value.workerBaseUrl}/v1/agent-os/viewer-assistance`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.internalHeaders(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(35_000)]),
      },
    );
    const json: unknown = await response.json();
    if (!response.ok) {
      const failure = z
        .object({ error: z.object({ code: z.string(), message: z.string() }) })
        .safeParse(json);
      throw new ServiceUnavailableException(
        failure.success
          ? failure.data.error
          : {
              code: 'VIEWER_WORKER_ERROR',
              message: `Viewing assistance worker returned HTTP ${response.status}`,
            },
      );
    }
    return ViewerAssistanceResponseSchema.parse(json);
  }

  private async postJson(
    path: string,
    body: unknown,
    timeoutMs = 10 * 60_000,
  ): Promise<AgentOsWorkerRunResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.config.value.workerBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...this.internalHeaders(),
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new ServiceUnavailableException({
        code: 'AGENT_OS_WORKER_UNAVAILABLE',
        message:
          error instanceof Error
            ? error.message
            : 'Agent OS worker is unreachable',
      });
    }

    const json = (await res.json()) as AgentOsWorkerRunResponse;
    if (!res.ok) {
      throw new ServiceUnavailableException({
        code: json.error?.code ?? 'AGENT_OS_WORKER_ERROR',
        message: json.error?.message ?? `Worker returned HTTP ${res.status}`,
      });
    }
    return json;
  }
}
