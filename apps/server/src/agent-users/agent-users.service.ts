import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  AgentActionStatus,
  AgentMemoryStatus,
  AgentMemoryType,
  AgentRunStatus,
  AgentUserIdentityStatus,
  AgentUserStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import type {
  CompleteAgentRunInput,
  CreateAdminAgentUserInput,
  CreateAgentActionInput,
  CreateAgentRunInput,
  ListAdminAgentUsersQuery,
  ListAgentActionsQuery,
  ListAgentMemoriesQuery,
  ListAgentRunsQuery,
  ListInternalAgentUsersQuery,
  UpdateAgentMemoryInput,
  UpdateAdminAgentUserInput,
  UpsertAgentMemoryInput,
} from './dto';

const agentUserListInclude = {
  runs: {
    orderBy: { createdAt: 'desc' },
    take: 1,
  },
  _count: {
    select: {
      runs: true,
      actions: true,
      memories: true,
    },
  },
} satisfies Prisma.AgentUserInclude;

const agentUserDetailInclude = {
  runs: {
    orderBy: { createdAt: 'desc' },
    take: 5,
  },
  actions: {
    orderBy: { createdAt: 'desc' },
    take: 10,
  },
  memories: {
    where: { status: AgentMemoryStatus.active },
    orderBy: { updatedAt: 'desc' },
    take: 20,
  },
  _count: {
    select: {
      runs: true,
      actions: true,
      memories: true,
    },
  },
} satisfies Prisma.AgentUserInclude;

type AgentUserListRow = Prisma.AgentUserGetPayload<{
  include: typeof agentUserListInclude;
}>;

type AgentUserDetailRow = Prisma.AgentUserGetPayload<{
  include: typeof agentUserDetailInclude;
}>;

@Injectable()
export class AgentUsersService {
  constructor(private readonly prisma: PrismaService) {}

  async listAdmin(query: ListAdminAgentUsersQuery) {
    const where = this.buildAdminWhere(query);
    const skip = (query.page - 1) * query.pageSize;
    const [
      total,
      items,
      activeCount,
      pausedCount,
      disabledCount,
      shadowCount,
      boundCount,
    ] = await Promise.all([
      this.prisma.agentUser.count({ where }),
      this.prisma.agentUser.findMany({
        where,
        include: agentUserListInclude,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: query.pageSize,
      }),
      this.prisma.agentUser.count({
        where: { status: AgentUserStatus.active },
      }),
      this.prisma.agentUser.count({
        where: { status: AgentUserStatus.paused },
      }),
      this.prisma.agentUser.count({
        where: { status: AgentUserStatus.disabled },
      }),
      this.prisma.agentUser.count({
        where: { identityStatus: AgentUserIdentityStatus.shadow },
      }),
      this.prisma.agentUser.count({
        where: { identityStatus: AgentUserIdentityStatus.bound },
      }),
    ]);
    return {
      items: items.map((item) => this.toAgentUserListDto(item)),
      page: query.page,
      pageSize: query.pageSize,
      total,
      stats: {
        activeCount,
        pausedCount,
        disabledCount,
        shadowCount,
        boundCount,
      },
    };
  }

  async listInternal(query: ListInternalAgentUsersQuery) {
    const where: Prisma.AgentUserWhereInput = {
      status: AgentUserStatus.active,
      ...(query.locale ? { locale: query.locale } : {}),
      ...(query.region ? { region: query.region } : {}),
    };
    const agents = await this.prisma.agentUser.findMany({
      where,
      orderBy: [{ lastRunAt: 'asc' }, { updatedAt: 'desc' }],
      take: query.limit,
    });
    return { items: agents.map((agent) => this.toAgentUserDto(agent)) };
  }

  async getAdmin(agentUserId: string) {
    const agent = await this.prisma.agentUser.findUnique({
      where: { id: agentUserId },
      include: agentUserDetailInclude,
    });
    if (!agent) {
      throw new NotFoundException({
        code: 'AGENT_USER_NOT_FOUND',
        msg: 'Agent 用户不存在。',
      });
    }
    return this.toAgentUserDetailDto(agent);
  }

  async ensureRunnable(agentUserId: string) {
    const agent = await this.findAgentUser(agentUserId);
    if (agent.status !== AgentUserStatus.active) {
      throw new BadRequestException({
        code: 'AGENT_USER_NOT_RUNNABLE',
        msg: 'Agent 用户不是 active 状态，不能执行行为。',
      });
    }
    return this.toAgentUserDto(agent);
  }

  async createAdmin(input: CreateAdminAgentUserInput, adminId: string) {
    this.assertIdentityBinding(input.identityStatus, input.platformUserId);
    const now = new Date();
    try {
      const agent = await this.prisma.agentUser.create({
        data: {
          handle: input.handle,
          displayName: input.displayName,
          avatarUrl: input.avatarUrl ?? null,
          status: input.status as AgentUserStatus,
          identityStatus: input.identityStatus as AgentUserIdentityStatus,
          platformUserId: input.platformUserId ?? null,
          simulatedEmail: input.simulatedEmail ?? null,
          locale: input.locale,
          region: input.region ?? null,
          timezone: input.timezone,
          persona: json(input.persona),
          schedule: json(input.schedule),
          policy: json(input.policy),
          notes: input.notes ?? null,
          createdByAdminId: adminId,
          updatedByAdminId: adminId,
          disabledAt: input.status === 'disabled' ? now : null,
        },
        include: agentUserDetailInclude,
      });
      return this.toAgentUserDetailDto(agent);
    } catch (error) {
      this.throwUniqueConflict(error);
      throw error;
    }
  }

  async updateAdmin(
    agentUserId: string,
    input: UpdateAdminAgentUserInput,
    adminId: string,
  ) {
    const existing = await this.findAgentUser(agentUserId);
    const nextIdentityStatus =
      input.identityStatus ??
      (input.platformUserId === undefined
        ? existing.identityStatus
        : input.platformUserId
          ? AgentUserIdentityStatus.bound
          : AgentUserIdentityStatus.shadow);
    const nextPlatformUserId =
      input.platformUserId === undefined
        ? existing.platformUserId
        : input.platformUserId;
    this.assertIdentityBinding(nextIdentityStatus, nextPlatformUserId);

    const nextStatus = input.status ?? existing.status;
    const data: Prisma.AgentUserUpdateInput = {
      updatedByAdminId: adminId,
      ...(input.displayName !== undefined
        ? { displayName: input.displayName }
        : {}),
      ...(input.avatarUrl !== undefined
        ? { avatarUrl: input.avatarUrl ?? null }
        : {}),
      ...(input.status !== undefined
        ? { status: input.status as AgentUserStatus }
        : {}),
      ...(nextIdentityStatus !== existing.identityStatus ||
      input.identityStatus !== undefined
        ? { identityStatus: nextIdentityStatus }
        : {}),
      ...(input.platformUserId !== undefined
        ? { platformUserId: input.platformUserId ?? null }
        : {}),
      ...(input.simulatedEmail !== undefined
        ? { simulatedEmail: input.simulatedEmail ?? null }
        : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.region !== undefined ? { region: input.region ?? null } : {}),
      ...(input.timezone !== undefined ? { timezone: input.timezone } : {}),
      ...(input.persona !== undefined ? { persona: json(input.persona) } : {}),
      ...(input.schedule !== undefined
        ? { schedule: json(input.schedule) }
        : {}),
      ...(input.policy !== undefined ? { policy: json(input.policy) } : {}),
      ...(input.notes !== undefined ? { notes: input.notes ?? null } : {}),
      disabledAt:
        nextStatus === AgentUserStatus.disabled
          ? (existing.disabledAt ?? new Date())
          : null,
    };

    try {
      const agent = await this.prisma.agentUser.update({
        where: { id: agentUserId },
        data,
        include: agentUserDetailInclude,
      });
      return this.toAgentUserDetailDto(agent);
    } catch (error) {
      this.throwUniqueConflict(error);
      throw error;
    }
  }

  async listRuns(agentUserId: string, query: ListAgentRunsQuery) {
    await this.findAgentUser(agentUserId);
    const where: Prisma.AgentRunWhereInput = {
      agentUserId,
      ...(query.status ? { status: query.status as AgentRunStatus } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, items] = await Promise.all([
      this.prisma.agentRun.count({ where }),
      this.prisma.agentRun.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: query.pageSize,
        include: { _count: { select: { actions: true } } },
      }),
    ]);
    return {
      items: items.map((item) => ({
        ...this.toAgentRunDto(item),
        actionCount: item._count.actions,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async listActions(agentUserId: string, query: ListAgentActionsQuery) {
    await this.findAgentUser(agentUserId);
    const where: Prisma.AgentActionWhereInput = {
      agentUserId,
      ...(query.runId ? { runId: query.runId } : {}),
      ...(query.status ? { status: query.status as AgentActionStatus } : {}),
      ...(query.actionType ? { actionType: query.actionType } : {}),
      ...(query.targetType ? { targetType: query.targetType } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, items] = await Promise.all([
      this.prisma.agentAction.count({ where }),
      this.prisma.agentAction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }],
        skip,
        take: query.pageSize,
      }),
    ]);
    return {
      items: items.map((item) => this.toAgentActionDto(item)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async listMemories(agentUserId: string, query: ListAgentMemoriesQuery) {
    await this.findAgentUser(agentUserId);
    const where: Prisma.AgentMemoryWhereInput = {
      agentUserId,
      ...(query.type ? { type: query.type as AgentMemoryType } : {}),
      ...(query.status ? { status: query.status as AgentMemoryStatus } : {}),
      ...(query.scopeType ? { scopeType: query.scopeType } : {}),
      ...(query.scopeId ? { scopeId: query.scopeId } : {}),
    };
    const skip = (query.page - 1) * query.pageSize;
    const [total, items] = await Promise.all([
      this.prisma.agentMemory.count({ where }),
      this.prisma.agentMemory.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
        skip,
        take: query.pageSize,
      }),
    ]);
    return {
      items: items.map((item) => this.toAgentMemoryDto(item)),
      page: query.page,
      pageSize: query.pageSize,
      total,
    };
  }

  async createRun(agentUserId: string, input: CreateAgentRunInput) {
    await this.ensureRunnable(agentUserId);
    const now = new Date();
    const run = await this.prisma.$transaction(async (tx) => {
      const created = await tx.agentRun.create({
        data: {
          agentUserId,
          trigger: input.trigger,
          status: input.status as AgentRunStatus,
          objective: input.objective ?? null,
          metadata: json(input.metadata),
          startedAt: input.status === 'running' ? now : null,
        },
      });
      await tx.agentUser.update({
        where: { id: agentUserId },
        data: { lastRunAt: now },
      });
      return created;
    });
    return this.toAgentRunDto(run);
  }

  async completeRun(runId: string, input: CompleteAgentRunInput) {
    const existing = await this.prisma.agentRun.findUnique({
      where: { id: runId },
      select: { id: true, agentUserId: true, status: true, startedAt: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'AGENT_RUN_NOT_FOUND',
        msg: 'Agent 运行记录不存在。',
      });
    }
    if (isTerminalRunStatus(existing.status)) {
      throw new BadRequestException({
        code: 'AGENT_RUN_ALREADY_TERMINAL',
        msg: 'Agent 运行记录已结束，不能重复完成。',
      });
    }
    const now = new Date();
    const run = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.agentRun.update({
        where: { id: runId },
        data: {
          status: input.status as AgentRunStatus,
          summary: input.summary ?? null,
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
          metrics: json(input.metrics),
          metadata: json(input.metadata),
          startedAt: existing.startedAt ?? now,
          completedAt: now,
        },
      });
      await tx.agentUser.update({
        where: { id: existing.agentUserId },
        data: { lastRunAt: now },
      });
      return updated;
    });
    return this.toAgentRunDto(run);
  }

  async createAction(agentUserId: string, input: CreateAgentActionInput) {
    await this.findAgentUser(agentUserId);
    if (input.idempotencyKey) {
      const existing = await this.prisma.agentAction.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
      });
      if (existing) return this.toAgentActionDto(existing);
    }
    if (input.runId) {
      const run = await this.prisma.agentRun.findUnique({
        where: { id: input.runId },
        select: { agentUserId: true },
      });
      if (!run || run.agentUserId !== agentUserId) {
        throw new BadRequestException({
          code: 'AGENT_RUN_AGENT_MISMATCH',
          msg: 'Agent 动作不能写入其他 Agent 的运行记录。',
        });
      }
    }
    const now = new Date();
    try {
      const action = await this.prisma.agentAction.create({
        data: {
          agentUserId,
          runId: input.runId ?? null,
          actionType: input.actionType,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          status: input.status as AgentActionStatus,
          idempotencyKey: input.idempotencyKey ?? null,
          decision: json(input.decision),
          input: json(input.input),
          result: json(input.result),
          metadata: json(input.metadata),
          errorCode: input.errorCode ?? null,
          errorMessage: input.errorMessage ?? null,
          startedAt: input.status === 'planned' ? null : now,
          completedAt: isTerminalActionStatus(input.status) ? now : null,
        },
      });
      return this.toAgentActionDto(action);
    } catch (error) {
      if (isUniqueConflict(error) && input.idempotencyKey) {
        const existing = await this.prisma.agentAction.findUniqueOrThrow({
          where: { idempotencyKey: input.idempotencyKey },
        });
        return this.toAgentActionDto(existing);
      }
      throw error;
    }
  }

  async upsertMemory(agentUserId: string, input: UpsertAgentMemoryInput) {
    await this.findAgentUser(agentUserId);
    const sourceActionIds = uniqueStrings(input.sourceActionIds);
    await this.assertActionOwnership(agentUserId, sourceActionIds);

    const now = new Date();
    const status = input.status as AgentMemoryStatus;
    const createData = {
      agentUserId,
      memoryKey: input.memoryKey ?? null,
      type: input.type as AgentMemoryType,
      status,
      scopeType: input.scopeType ?? null,
      scopeId: input.scopeId ?? null,
      summary: input.summary,
      content: json(input.content),
      confidence: input.confidence,
      weight: input.weight,
      sourceActionIds,
      lastReinforcedAt: now,
      archivedAt: status === AgentMemoryStatus.archived ? now : null,
    };
    const updateData: Prisma.AgentMemoryUpdateInput = {
      type: input.type as AgentMemoryType,
      status,
      scopeType: input.scopeType ?? null,
      scopeId: input.scopeId ?? null,
      summary: input.summary,
      content: json(input.content),
      confidence: input.confidence,
      weight: input.weight,
      sourceActionIds: { set: sourceActionIds },
      lastReinforcedAt: now,
      archivedAt: status === AgentMemoryStatus.archived ? now : null,
    };

    const memory = input.memoryKey
      ? await this.prisma.agentMemory.upsert({
          where: {
            agentUserMemoryKey: {
              agentUserId,
              memoryKey: input.memoryKey,
            },
          },
          create: createData,
          update: updateData,
        })
      : await this.prisma.agentMemory.create({ data: createData });

    return this.toAgentMemoryDto(memory);
  }

  async updateMemory(
    agentUserId: string,
    memoryId: string,
    input: UpdateAgentMemoryInput,
  ) {
    const existing = await this.findMemory(agentUserId, memoryId);
    const sourceActionIds =
      input.sourceActionIds !== undefined
        ? uniqueStrings(input.sourceActionIds)
        : undefined;
    if (sourceActionIds) {
      await this.assertActionOwnership(agentUserId, sourceActionIds);
    }

    const nextStatus = input.status
      ? (input.status as AgentMemoryStatus)
      : existing.status;
    const data: Prisma.AgentMemoryUpdateInput = {
      ...(input.status !== undefined
        ? {
            status: nextStatus,
            archivedAt:
              nextStatus === AgentMemoryStatus.archived
                ? (existing.archivedAt ?? new Date())
                : null,
          }
        : {}),
      ...(input.summary !== undefined ? { summary: input.summary } : {}),
      ...(input.content !== undefined ? { content: json(input.content) } : {}),
      ...(input.confidence !== undefined
        ? { confidence: input.confidence }
        : {}),
      ...(input.weight !== undefined ? { weight: input.weight } : {}),
      ...(sourceActionIds !== undefined
        ? { sourceActionIds: { set: sourceActionIds } }
        : {}),
    };
    const memory = await this.prisma.agentMemory.update({
      where: { id: existing.id },
      data,
    });
    return this.toAgentMemoryDto(memory);
  }

  private buildAdminWhere(
    query: ListAdminAgentUsersQuery,
  ): Prisma.AgentUserWhereInput {
    const where: Prisma.AgentUserWhereInput = {
      ...(query.status ? { status: query.status as AgentUserStatus } : {}),
      ...(query.identityStatus
        ? { identityStatus: query.identityStatus as AgentUserIdentityStatus }
        : {}),
      ...(query.locale ? { locale: query.locale } : {}),
      ...(query.region ? { region: query.region } : {}),
    };
    if (query.q) {
      where.OR = [
        { handle: { contains: query.q, mode: 'insensitive' } },
        { displayName: { contains: query.q, mode: 'insensitive' } },
        { simulatedEmail: { contains: query.q, mode: 'insensitive' } },
        { platformUserId: { contains: query.q, mode: 'insensitive' } },
      ];
    }
    return where;
  }

  private async findAgentUser(agentUserId: string) {
    const agent = await this.prisma.agentUser.findUnique({
      where: { id: agentUserId },
    });
    if (!agent) {
      throw new NotFoundException({
        code: 'AGENT_USER_NOT_FOUND',
        msg: 'Agent 用户不存在。',
      });
    }
    return agent;
  }

  private async findMemory(agentUserId: string, memoryId: string) {
    const memory = await this.prisma.agentMemory.findFirst({
      where: { id: memoryId, agentUserId },
    });
    if (!memory) {
      throw new NotFoundException({
        code: 'AGENT_MEMORY_NOT_FOUND',
        msg: 'Agent 记忆不存在。',
      });
    }
    return memory;
  }

  private async assertActionOwnership(
    agentUserId: string,
    actionIds: string[],
  ) {
    if (!actionIds.length) return;
    const ownedCount = await this.prisma.agentAction.count({
      where: { agentUserId, id: { in: actionIds } },
    });
    if (ownedCount !== actionIds.length) {
      throw new BadRequestException({
        code: 'AGENT_MEMORY_SOURCE_ACTION_MISMATCH',
        msg: 'Agent 记忆不能引用其他 Agent 的动作记录。',
      });
    }
  }

  private assertIdentityBinding(
    identityStatus: AgentUserIdentityStatus,
    platformUserId?: string | null,
  ) {
    if (identityStatus === AgentUserIdentityStatus.bound && !platformUserId) {
      throw new BadRequestException({
        code: 'AGENT_USER_BOUND_REQUIRES_PLATFORM_USER',
        msg: '绑定态 Agent 用户必须先写入 platformUserId。',
      });
    }
    if (identityStatus === AgentUserIdentityStatus.shadow && platformUserId) {
      throw new BadRequestException({
        code: 'AGENT_USER_SHADOW_FORBIDS_PLATFORM_USER',
        msg: '影子态 Agent 用户不能保留 platformUserId。',
      });
    }
  }

  private throwUniqueConflict(error: unknown): never | void {
    if (!isUniqueConflict(error)) return;
    const targetMeta = error.meta?.target;
    const target = Array.isArray(targetMeta)
      ? targetMeta
          .filter((value): value is string => typeof value === 'string')
          .join(',')
      : typeof targetMeta === 'string'
        ? targetMeta
        : '';
    if (target.includes('handle')) {
      throw new ConflictException({
        code: 'AGENT_USER_HANDLE_EXISTS',
        msg: 'Agent handle 已存在。',
      });
    }
    if (target.includes('platform_user_id')) {
      throw new ConflictException({
        code: 'AGENT_USER_PLATFORM_USER_EXISTS',
        msg: 'platformUserId 已绑定到另一个 Agent 用户。',
      });
    }
    if (target.includes('simulated_email')) {
      throw new ConflictException({
        code: 'AGENT_USER_SIMULATED_EMAIL_EXISTS',
        msg: '模拟邮箱已绑定到另一个 Agent 用户。',
      });
    }
    throw new ConflictException({
      code: 'AGENT_USER_UNIQUE_CONFLICT',
      msg: 'Agent 用户唯一键冲突。',
    });
  }

  private toAgentUserListDto(agent: AgentUserListRow) {
    return {
      ...this.toAgentUserDto(agent),
      runCount: agent._count.runs,
      actionCount: agent._count.actions,
      memoryCount: agent._count.memories,
      latestRun: agent.runs[0] ? this.toAgentRunDto(agent.runs[0]) : null,
    };
  }

  private toAgentUserDetailDto(agent: AgentUserDetailRow) {
    return {
      ...this.toAgentUserDto(agent),
      runCount: agent._count.runs,
      actionCount: agent._count.actions,
      memoryCount: agent._count.memories,
      recentRuns: agent.runs.map((run) => this.toAgentRunDto(run)),
      recentActions: agent.actions.map((action) =>
        this.toAgentActionDto(action),
      ),
      recentMemories: agent.memories.map((memory) =>
        this.toAgentMemoryDto(memory),
      ),
    };
  }

  private toAgentUserDto(agent: Prisma.AgentUserGetPayload<object>) {
    return {
      id: agent.id,
      handle: agent.handle,
      displayName: agent.displayName,
      avatarUrl: agent.avatarUrl,
      status: agent.status,
      identityStatus: agent.identityStatus,
      platformUserId: agent.platformUserId,
      simulatedEmail: agent.simulatedEmail,
      locale: agent.locale,
      region: agent.region,
      timezone: agent.timezone,
      persona: agent.persona,
      schedule: agent.schedule,
      policy: agent.policy,
      notes: agent.notes,
      createdByAdminId: agent.createdByAdminId,
      updatedByAdminId: agent.updatedByAdminId,
      lastRunAt: iso(agent.lastRunAt),
      createdAt: iso(agent.createdAt),
      updatedAt: iso(agent.updatedAt),
      disabledAt: iso(agent.disabledAt),
    };
  }

  private toAgentRunDto(
    run: Prisma.AgentRunGetPayload<object> & { _count?: { actions: number } },
  ) {
    return {
      id: run.id,
      agentUserId: run.agentUserId,
      status: run.status,
      trigger: run.trigger,
      objective: run.objective,
      summary: run.summary,
      errorCode: run.errorCode,
      errorMessage: run.errorMessage,
      metrics: run.metrics,
      metadata: run.metadata,
      queuedAt: iso(run.queuedAt),
      startedAt: iso(run.startedAt),
      completedAt: iso(run.completedAt),
      createdAt: iso(run.createdAt),
      updatedAt: iso(run.updatedAt),
      ...(run._count ? { actionCount: run._count.actions } : {}),
    };
  }

  private toAgentActionDto(action: Prisma.AgentActionGetPayload<object>) {
    return {
      id: action.id,
      agentUserId: action.agentUserId,
      runId: action.runId,
      actionType: action.actionType,
      targetType: action.targetType,
      targetId: action.targetId,
      status: action.status,
      idempotencyKey: action.idempotencyKey,
      decision: action.decision,
      input: action.input,
      result: action.result,
      metadata: action.metadata,
      errorCode: action.errorCode,
      errorMessage: action.errorMessage,
      plannedAt: iso(action.plannedAt),
      startedAt: iso(action.startedAt),
      completedAt: iso(action.completedAt),
      createdAt: iso(action.createdAt),
      updatedAt: iso(action.updatedAt),
    };
  }

  private toAgentMemoryDto(memory: Prisma.AgentMemoryGetPayload<object>) {
    return {
      id: memory.id,
      agentUserId: memory.agentUserId,
      memoryKey: memory.memoryKey,
      type: memory.type,
      status: memory.status,
      scopeType: memory.scopeType,
      scopeId: memory.scopeId,
      summary: memory.summary,
      content: memory.content,
      confidence: memory.confidence,
      weight: memory.weight,
      sourceActionIds: memory.sourceActionIds,
      lastReinforcedAt: iso(memory.lastReinforcedAt),
      createdAt: iso(memory.createdAt),
      updatedAt: iso(memory.updatedAt),
      archivedAt: iso(memory.archivedAt),
    };
  }
}

function json(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function iso(value: Date | null): string | null {
  return value ? value.toISOString() : null;
}

function isTerminalRunStatus(status: AgentRunStatus): boolean {
  return new Set<AgentRunStatus>([
    AgentRunStatus.succeeded,
    AgentRunStatus.failed,
    AgentRunStatus.cancelled,
  ]).has(status);
}

function isTerminalActionStatus(status: AgentActionStatus): boolean {
  return new Set<AgentActionStatus>([
    AgentActionStatus.succeeded,
    AgentActionStatus.failed,
    AgentActionStatus.skipped,
  ]).has(status);
}

function isUniqueConflict(
  error: unknown,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  );
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values));
}
