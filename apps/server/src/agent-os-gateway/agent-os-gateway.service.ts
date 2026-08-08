import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, ProjectMemberRole } from '@prisma/client';
import { randomUUID } from 'crypto';
import {
  getSkill,
  listInvocableSkills,
  listSkills,
  toSkillPublicMeta,
} from '@repo/agent-skills';
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
import { AgentOsDomainService } from './agent-os-domain.service';
import { AgentOsRunJournalService } from './agent-os-run-journal.service';
import { AgentOsAblyTokenIssuer } from './agent-os.realtime';

@Injectable()
export class AgentOsGatewayService {
  constructor(
    private readonly worker: AgentOsWorkerClient,
    private readonly storyPermissions: StoryPermissionService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly prisma: PrismaService,
    private readonly config: AgentOsGatewayConfigService,
    private readonly journal: AgentOsRunJournalService,
    private readonly domain: AgentOsDomainService,
    private readonly realtimeTokens: AgentOsAblyTokenIssuer,
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
    const projectDefaults =
      body.projectDefaultSkillIds ??
      (await this.readProjectDefaultSkillIds(body.projectId));
    return this.worker.startRun({
      projectId: body.projectId,
      conversationId,
      actorId: user.userId,
      message: body.message,
      modelProfileId: body.modelProfileId,
      attachmentIds: body.attachmentIds,
      permissionMode: body.permissionMode,
      surface: body.surface ?? 'storyboard',
      skillIds: body.skillIds,
      projectDefaultSkillIds: projectDefaults,
    });
  }

  listSkills(surface?: string) {
    const all = listSkills().map(toSkillPublicMeta);
    const invocable = listInvocableSkills(surface);
    return {
      skills: all,
      invocable,
      surface: surface ?? null,
    };
  }

  async getProjectSkills(user: AuthUser, projectId: string) {
    await this.requireProjectRead(user.userId, projectId);
    const defaults = await this.readProjectDefaultSkillIds(projectId);
    return {
      projectId,
      defaultSkillIds: defaults,
      invocable: listInvocableSkills(),
    };
  }

  async setProjectDefaultSkills(
    user: AuthUser,
    projectId: string,
    defaultSkillIds: string[],
  ) {
    await this.requireProjectWrite(user.userId, projectId);
    const unique = [
      ...new Set(defaultSkillIds.map((id) => id.trim()).filter(Boolean)),
    ];
    for (const id of unique) {
      const skill = getSkill(id);
      if (!skill) {
        throw new BadRequestException({
          code: 'AGENT_OS_UNKNOWN_SKILL',
          message: `Unknown skill: ${id}`,
        });
      }
      if (!skill.userInvocable) {
        throw new BadRequestException({
          code: 'AGENT_OS_SKILL_NOT_INVOCABLE',
          message: `Skill ${id} is not selectable as a project default.`,
        });
      }
    }

    const project = await this.prisma.platformProject.findFirst({
      where: { id: projectId, deletedAt: null },
      select: { id: true, workspaceId: true },
    });
    if (!project) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        message: 'Platform project not found.',
      });
    }

    await this.prisma.agentOsProjectState.upsert({
      where: { projectId },
      create: {
        projectId: project.id,
        workspaceId: project.workspaceId,
        revision: 0,
        characters: [],
        scriptSections: [],
        shots: [],
        defaultSkillIds: unique as unknown as Prisma.InputJsonValue,
        updatedByUserId: user.userId,
      },
      update: {
        defaultSkillIds: unique as unknown as Prisma.InputJsonValue,
        updatedByUserId: user.userId,
      },
    });

    return { projectId, defaultSkillIds: unique };
  }

  private async readProjectDefaultSkillIds(
    projectId: string,
  ): Promise<string[]> {
    const state = await this.prisma.agentOsProjectState.findUnique({
      where: { projectId },
      select: { defaultSkillIds: true },
    });
    return parseSkillIdArray(state?.defaultSkillIds);
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
      permissionMode: body.permissionMode,
    });
  }

  async cancelRun(
    user: AuthUser,
    runId: string,
    projectId: string,
    reason?: string,
  ): Promise<AgentOsWorkerRunResponse> {
    await this.requireProjectWrite(user.userId, projectId);
    return this.worker.cancelRun(runId, reason);
  }

  /**
   * Durable transcript for reopen / refresh — Postgres journal is authoritative.
   */
  async getConversationHistory(
    user: AuthUser,
    projectId: string,
    conversationId?: string,
  ) {
    await this.requireProjectRead(user.userId, projectId);
    return this.journal.getConversationHistory({
      projectId,
      actorId: user.userId,
      conversationId,
    });
  }

  /**
   * Mint a short-lived Ably token for one conversation channel.
   * Re-checks project read on every mint (token refresh).
   */
  async issueRealtimeToken(
    user: AuthUser,
    projectId: string,
    conversationId: string,
  ) {
    await this.requireProjectRead(user.userId, projectId);
    return this.realtimeTokens.issueConversationToken(
      conversationId,
      user.userId,
    );
  }

  async listEvents(
    user: AuthUser,
    runId: string,
    projectId: string,
    after = 0,
  ) {
    await this.requireProjectRead(user.userId, projectId);
    // Live worker first while the turn is open — MessageDelta must be low-latency
    // for smooth streaming. Durable journal is for reconnect / completed runs.
    let live: Record<string, unknown> | null = null;
    try {
      live = (await this.worker.listEvents(runId, after)) as Record<
        string,
        unknown
      >;
    } catch {
      live = null;
    }
    const liveStatus =
      typeof live?.status === 'string' ? (live.status as string) : '';
    if (
      live &&
      (liveStatus === 'running' ||
        liveStatus === 'queued' ||
        liveStatus === 'paused' ||
        liveStatus === 'waiting_for_approval')
    ) {
      return { ...live, source: 'worker' as const };
    }

    const durable = await this.journal.getEventsAfter(runId, after);
    if (durable) {
      return {
        runId: durable.runId,
        status: durable.status,
        events: durable.events,
        pendingApproval: durable.pendingApproval,
        assistantText: durable.assistantText,
        source: 'postgres' as const,
      };
    }
    if (live) {
      return { ...live, source: 'worker' as const };
    }
    return {
      runId,
      status: 'failed',
      events: [],
      source: 'none' as const,
    };
  }

  async listProjectCharacters(user: AuthUser, projectId: string) {
    await this.requireProjectRead(user.userId, projectId);
    const result = await this.domain.execute({
      toolId: 'characters.list',
      actorId: user.userId,
      projectId,
      idempotencyKey: `list:${projectId}:${user.userId}:${Date.now()}`,
      arguments: {},
    });
    if (!result.ok) {
      throw new NotFoundException({
        code: result.code,
        message: result.message,
      });
    }
    return result.data;
  }

  async listProjectShots(user: AuthUser, projectId: string) {
    await this.requireProjectRead(user.userId, projectId);
    const result = await this.domain.execute({
      toolId: 'storyboard.listShots',
      actorId: user.userId,
      projectId,
      idempotencyKey: `shots:${projectId}:${user.userId}:${Date.now()}`,
      arguments: {},
    });
    if (!result.ok) {
      throw new NotFoundException({
        code: result.code,
        message: result.message,
      });
    }
    return result.data;
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

function parseSkillIdArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (id): id is string => typeof id === 'string' && id.trim().length > 0,
  );
}
