import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import type { AuthUser } from '../auth';
import {
  AgentOsWorkerClient,
  type AgentOsWorkerRunResponse,
} from './agent-os-worker.client';
import type {
  AgentOsApprovalBody,
  AgentOsStartRunBody,
} from './agent-os-gateway.dto';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';

@Injectable()
export class AgentOsGatewayService {
  constructor(
    private readonly worker: AgentOsWorkerClient,
    private readonly permissions: StoryPermissionService,
    private readonly config: AgentOsGatewayConfigService,
  ) {}

  async health() {
    const worker = await this.worker.health();
    return {
      ok: worker.ok,
      product: 'FizzDragon Agent Platform',
      codename: 'Agent OS',
      billing: this.config.value.billing,
      rateLimit: this.config.value.rateLimit,
      workerBaseUrl: this.config.value.workerBaseUrl,
      worker,
    };
  }

  async startRun(
    user: AuthUser,
    body: AgentOsStartRunBody,
  ): Promise<AgentOsWorkerRunResponse> {
    // Phase 1 free / no rate limit — still require project write access.
    await this.permissions.requireProject(
      user.userId,
      body.projectId,
      'story.edit',
    );

    const conversationId = body.conversationId ?? randomUUID();
    return this.worker.startRun({
      projectId: body.projectId,
      conversationId,
      actorId: user.userId,
      message: body.message,
      modelProfileId: body.modelProfileId,
      scriptText: body.scriptText,
    });
  }

  async resolveApproval(
    user: AuthUser,
    runId: string,
    body: AgentOsApprovalBody,
  ): Promise<AgentOsWorkerRunResponse> {
    await this.permissions.requireProject(
      user.userId,
      body.projectId,
      'story.edit',
    );

    return this.worker.resolveApproval({
      runId,
      decision: body.decision,
      projectId: body.projectId,
      actorId: user.userId,
      conversationId: body.conversationId,
      modelProfileId: body.modelProfileId,
    });
  }

  async listEvents(
    user: AuthUser,
    runId: string,
    projectId: string,
    after = 0,
  ) {
    await this.permissions.requireProject(user.userId, projectId, 'story.read');
    return this.worker.listEvents(runId, after);
  }
}
