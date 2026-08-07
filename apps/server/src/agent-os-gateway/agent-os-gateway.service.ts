import { Injectable, NotFoundException } from '@nestjs/common';
import { ProjectMemberRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import type {
  AgentOsApprovalBody,
  AgentOsStartRunBody,
} from './agent-os-gateway.dto';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';
import {
  AgentOsWorkerClient,
  type AgentOsWorkerRunResponse,
} from './agent-os-worker.client';

@Injectable()
export class AgentOsGatewayService {
  constructor(
    private readonly worker: AgentOsWorkerClient,
    private readonly storyPermissions: StoryPermissionService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly prisma: PrismaService,
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
    await this.requireProjectWrite(user.userId, body.projectId);

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
    await this.requireProjectWrite(user.userId, body.projectId);

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
    await this.requireProjectRead(user.userId, projectId);
    return this.worker.listEvents(runId, after);
  }

  private async requireProjectWrite(userId: string, projectId: string) {
    const platform = await this.prisma.platformProject.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true },
    });
    if (platform) {
      await this.workspacePermissions.requireProjectRole(
        userId,
        projectId,
        ProjectMemberRole.editor,
      );
      return;
    }
    const story = await this.prisma.storyProject.findFirst({
      where: { id: projectId },
      select: { id: true },
    });
    if (story) {
      await this.storyPermissions.requireProject(
        userId,
        projectId,
        'story.edit',
      );
      return;
    }
    throw new NotFoundException({
      code: 'PROJECT_NOT_FOUND',
      message: 'Project not found.',
    });
  }

  private async requireProjectRead(userId: string, projectId: string) {
    const platform = await this.prisma.platformProject.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true },
    });
    if (platform) {
      await this.workspacePermissions.requireProjectRole(
        userId,
        projectId,
        ProjectMemberRole.viewer,
      );
      return;
    }
    await this.storyPermissions.requireProject(userId, projectId, 'story.read');
  }
}
