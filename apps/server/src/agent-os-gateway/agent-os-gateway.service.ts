import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  getModeDefinition,
  type AgentProjectKind,
} from '@repo/agent-capabilities';
import {
  listInvocableSkills,
  listSkills,
  toSkillPublicMeta,
} from '@repo/agent-skills';
import type { AuthUser } from '../auth';
import type {
  AgentOsApprovalBody,
  AgentOsStartRunBody,
} from './agent-os-gateway.dto';
import { AgentOsAttachmentService } from './agent-os-attachment.service';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';
import {
  AgentOsWorkerClient,
  type AgentOsWorkerRunResponse,
} from './agent-os-worker.client';
import { AgentOsDomainService } from './agent-os-domain.service';
import { AgentOsProjectContextService } from './agent-os-project-context.service';
import { AgentOsRunJournalService } from './agent-os-run-journal.service';
import { AgentOsAblyTokenIssuer } from './agent-os.realtime';
import { ProjectSkillsResolver } from '../project-skills';

@Injectable()
export class AgentOsGatewayService {
  constructor(
    private readonly worker: AgentOsWorkerClient,
    private readonly projects: AgentOsProjectContextService,
    private readonly config: AgentOsGatewayConfigService,
    private readonly journal: AgentOsRunJournalService,
    private readonly domain: AgentOsDomainService,
    private readonly realtimeTokens: AgentOsAblyTokenIssuer,
    private readonly attachments: AgentOsAttachmentService,
    private readonly projectSkills: ProjectSkillsResolver,
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
    const project = await this.requireProjectWrite(user.userId, body.projectId);
    this.requireWorkbenchMode(project.projectKind, body.workbenchMode);
    const workbenchContext = await this.resolveWorkbenchContext(
      project.projectKind,
      project.projectId,
      body.workbenchMode,
      body.workbenchContext,
    );
    const attachmentIds = await this.attachments.validateForRun(
      project.projectKind,
      project.projectId,
      body.attachmentIds,
    );

    const conversationId = body.conversationId ?? randomUUID();
    // conversationId becomes the LangGraph thread id, so submitting someone
    // else's would resume THEIR checkpointed history as context for this turn —
    // and the reply could read it straight back out.
    if (
      body.conversationId &&
      (await this.journal.conversationConflictsWith({
        conversationId,
        projectId: body.projectId,
        actorId: user.userId,
      }))
    ) {
      throw new NotFoundException({
        code: 'AGENT_OS_CONVERSATION_NOT_FOUND',
        message: 'Conversation not found for this project.',
      });
    }
    const allowedSystemSkills = new Set(
      listInvocableSkills({
        projectKind: project.projectKind,
        workbenchMode: body.workbenchMode,
      }).map((skill) => skill.id),
    );
    for (const skillId of body.skillIds ?? []) {
      if (!allowedSystemSkills.has(skillId)) {
        throw new BadRequestException({
          code: 'AGENT_OS_SKILL_NOT_INVOCABLE',
          message: `Skill ${skillId} is not selectable in this workbench.`,
        });
      }
    }
    const skillMountSnapshot = await this.projectSkills.resolve({
      ownerKind: project.projectKind,
      projectId: project.projectId,
      scope: 'agent_prompt',
      workbenchMode: body.workbenchMode,
      sourceSurface: `agent_os:${body.workbenchMode}`,
      selection: {
        includeInstallationIds: body.projectSkillInstallationIds,
        excludeInstallationIds: body.disabledDefaultSkillInstallationIds,
      },
    });
    return this.worker.startRun({
      projectId: body.projectId,
      conversationId,
      actorId: user.userId,
      message: body.message,
      modelProfileId: body.modelProfileId,
      attachmentIds,
      permissionMode: body.permissionMode,
      projectKind: project.projectKind,
      workbenchMode: body.workbenchMode,
      workbenchContext,
      skillIds: body.skillIds,
      skillMountSnapshot,
    });
  }

  /** Relay of the worker's model list — no auth beyond the session guard: it
   *  names models, not projects. */
  async listModels() {
    return this.worker.listModels();
  }

  async listSkills(user: AuthUser, projectId: string, workbenchMode: string) {
    const project = await this.projects.requireRead(user.userId, projectId);
    this.requireWorkbenchMode(project.projectKind, workbenchMode);
    const all = listSkills().map(toSkillPublicMeta);
    const invocable = listInvocableSkills({
      projectKind: project.projectKind,
      workbenchMode,
    });
    return {
      skills: all,
      invocable,
      projectKind: project.projectKind,
      workbenchMode,
    };
  }

  async resolveApproval(
    user: AuthUser,
    runId: string,
    body: AgentOsApprovalBody,
  ): Promise<AgentOsWorkerRunResponse> {
    const run = await this.requireRunAccess(
      user,
      runId,
      body.projectId,
      'write',
    );

    return this.worker.resolveApproval({
      runId,
      decision: body.decision,
      // The run's OWN identity goes downstream, never the client's copy: the
      // worker feeds these into the resumed graph's tool context, so a
      // mismatched pair would execute the pending write somewhere else.
      projectId: run.projectId,
      actorId: user.userId,
      conversationId: run.conversationId,
      modelProfileId: body.modelProfileId,
      projectKind: run.projectKind,
      workbenchMode: run.workbenchMode,
      workbenchContext: run.workbenchContext,
      permissionMode: body.permissionMode,
    });
  }

  async cancelRun(
    user: AuthUser,
    runId: string,
    projectId: string,
    reason?: string,
  ): Promise<AgentOsWorkerRunResponse> {
    await this.requireRunAccess(user, runId, projectId, 'write');
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
    // The channel name is a pure function of conversationId, so minting for an
    // id the caller does not own hands them another tenant's live transcript.
    // A conversation with no runs yet is unclaimed — the client mints its token
    // before the first turn exists.
    if (
      await this.journal.conversationConflictsWith({
        conversationId,
        projectId,
        actorId: user.userId,
      })
    ) {
      throw new NotFoundException({
        code: 'AGENT_OS_CONVERSATION_NOT_FOUND',
        message: 'Conversation not found for this project.',
      });
    }
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
    await this.requireRunAccess(user, runId, projectId, 'read');
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
    const liveStatus = typeof live?.status === 'string' ? live.status : '';
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
      // This read endpoint is not an Agent turn. Use an explicit no-Skill
      // provenance marker instead of weakening the Domain contract.
      skillResolutionId: '00000000-0000-4000-8000-000000000000',
      skillVersionIds: [],
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

  /**
   * Resolve a run and prove the caller may act on it.
   *
   * The client sends a runId and a projectId side by side, and they are
   * unrelated ids — authorizing the projectId says nothing about the run. Load
   * the run, authorize against the project it actually belongs to, and refuse a
   * mismatch. Without this a run UUID is a bearer token: any member of any
   * project can read another tenant's transcript, cancel their turn, or resolve
   * their pending write.
   *
   * Access is project-scoped, not actor-scoped: a project's editors can already
   * perform these writes themselves, so they may also act on its runs.
   */
  private async requireRunAccess(
    user: AuthUser,
    runId: string,
    claimedProjectId: string,
    access: 'read' | 'write',
  ): Promise<{
    projectId: string;
    actorId: string;
    conversationId: string;
    projectKind: AgentProjectKind;
    workbenchMode: string;
    workbenchContext?: Readonly<Record<string, string>>;
  }> {
    const run = await this.journal.getRunOwnership(runId);
    // Same response for "no such run" and "not yours": existence is itself
    // information about another tenant.
    if (!run || run.projectId !== claimedProjectId) {
      throw new NotFoundException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: 'Run not found for this project.',
      });
    }
    const project =
      access === 'write'
        ? await this.requireProjectWrite(user.userId, run.projectId)
        : await this.requireProjectRead(user.userId, run.projectId);
    if (run.projectKind && run.projectKind !== project.projectKind) {
      throw new NotFoundException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: 'Run not found for this Agent OS protocol version.',
      });
    }
    if (!run.workbenchMode) {
      throw new NotFoundException({
        code: 'AGENT_OS_RUN_NOT_FOUND',
        message: 'Run not found for this Agent OS protocol version.',
      });
    }
    this.requireWorkbenchMode(project.projectKind, run.workbenchMode);
    const workbenchContext = await this.resolveWorkbenchContext(
      project.projectKind,
      project.projectId,
      run.workbenchMode,
      run.workbenchContext ?? undefined,
    );
    return {
      ...run,
      projectKind: project.projectKind,
      workbenchMode: run.workbenchMode,
      workbenchContext,
    };
  }

  private async requireProjectWrite(userId: string, projectId: string) {
    return this.projects.requireWrite(userId, projectId);
  }

  private async requireProjectRead(userId: string, projectId: string) {
    return this.projects.requireRead(userId, projectId);
  }

  private requireWorkbenchMode(
    projectKind: AgentProjectKind,
    workbenchMode: string,
  ) {
    const definition = getModeDefinition(projectKind, workbenchMode);
    if (!definition) {
      throw new BadRequestException({
        code: 'AGENT_OS_WORKBENCH_MODE_UNSUPPORTED',
        message: `Workbench mode ${workbenchMode} is not available for ${projectKind} projects.`,
      });
    }
    return definition;
  }

  private async resolveWorkbenchContext(
    projectKind: AgentProjectKind,
    projectId: string,
    workbenchMode: string,
    context: Readonly<Record<string, string>> | undefined,
  ): Promise<Readonly<Record<string, string>> | undefined> {
    if (projectKind === 'story') {
      const chapterId = context?.chapterId;
      return this.projects.requireStoryWorkbenchContext(
        projectId,
        typeof chapterId === 'string' ? { chapterId } : undefined,
      );
    }
    if (workbenchMode === 'canvas' || workbenchMode === 'storyboard') {
      const sectionId = context?.sectionId;
      return this.projects.requirePlatformWorkbenchContext(
        projectId,
        typeof sectionId === 'string' ? { sectionId } : undefined,
      );
    }
    if (context) {
      throw new BadRequestException({
        code: 'AGENT_OS_WORKBENCH_CONTEXT_UNSUPPORTED',
        message: 'This workbench mode does not accept a scoped context.',
      });
    }
    return undefined;
  }
}
