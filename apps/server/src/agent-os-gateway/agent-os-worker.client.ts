import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';

export interface AgentOsWorkerRunRequest {
  projectId: string;
  conversationId: string;
  actorId: string;
  message: string;
  modelProfileId: string;
  attachmentIds?: string[];
  permissionMode?: 'ask' | 'smart' | 'full';
  surface?: 'storyboard' | 'canvas' | 'brief';
  skillIds?: string[];
  projectDefaultSkillIds?: string[];
}

export interface AgentOsWorkerRunResponse {
  runId: string;
  status: string;
  pendingApproval?: unknown;
  events?: unknown[];
  assistantText?: string;
  characters?: unknown[];
  error?: { code: string; message: string };
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
    return this.postJson('/v1/agent-os/runs', body);
  }

  async resolveApproval(input: {
    runId: string;
    decision: 'approve' | 'reject';
    projectId: string;
    actorId: string;
    conversationId: string;
    modelProfileId: string;
    permissionMode?: 'ask' | 'smart' | 'full';
  }): Promise<AgentOsWorkerRunResponse> {
    return this.postJson(`/v1/agent-os/runs/${input.runId}/approvals`, {
      decision: input.decision,
      projectId: input.projectId,
      actorId: input.actorId,
      conversationId: input.conversationId,
      modelProfileId: input.modelProfileId,
      permissionMode: input.permissionMode,
    });
  }

  async listEvents(runId: string, after = 0): Promise<unknown> {
    const url = new URL(
      `${this.config.value.workerBaseUrl}/v1/agent-os/runs/${runId}/events`,
    );
    url.searchParams.set('after', String(after));
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(15_000),
    });
    return res.json();
  }

  async cancelRun(
    runId: string,
    reason?: string,
  ): Promise<AgentOsWorkerRunResponse> {
    return this.postJson(`/v1/agent-os/runs/${runId}/cancel`, {
      reason: reason ?? 'Stopped by user',
    });
  }

  private async postJson(
    path: string,
    body: unknown,
  ): Promise<AgentOsWorkerRunResponse> {
    let res: Response;
    try {
      res = await fetch(`${this.config.value.workerBaseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10 * 60_000),
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
