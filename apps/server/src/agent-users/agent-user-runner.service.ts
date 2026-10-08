import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { createAlibaba } from '@ai-sdk/alibaba';
import { generateObject } from 'ai';
import { AgentActionStatus, AgentMemoryStatus } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../infra/db/db.module';
import { backgroundTasksEnabled } from '../common/background-tasks';
import { IpCommerceService } from '../ip-commerce/ip-commerce.service';
import { AgentUsersService } from './agent-users.service';

const RunnerActionSchema = z.object({
  ipId: z.string().uuid(),
  action: z.enum(['view', 'like', 'collect', 'skip']),
  reason: z.string().trim().max(300).default(''),
  memorySummary: z.string().trim().max(500).nullable().optional(),
});

const RunnerMemorySchema = z.object({
  memoryKey: z.string().trim().min(1).max(180),
  type: z
    .enum([
      'preference',
      'content_affinity',
      'negative_signal',
      'relationship',
      'summary',
      'fact',
    ])
    .default('content_affinity'),
  scopeIpId: z.string().uuid().nullable().optional(),
  summary: z.string().trim().min(1).max(500),
  confidence: z.number().int().min(0).max(100).default(60),
  weight: z.number().int().min(0).max(10000).default(100),
});

const RunnerDecisionSchema = z.object({
  runSummary: z.string().trim().max(1000).default(''),
  actions: z.array(RunnerActionSchema).min(1).max(5),
  memories: z.array(RunnerMemorySchema).max(5).default([]),
});

const PUBLIC_GENRE_CODES = new Set([
  'sci_fi',
  'fantasy',
  'mystery',
  'romance',
  'adventure',
  'action',
  'comedy',
  'drama',
  'horror',
  'children',
  'education',
  'documentary',
]);

type RunnerDecision = z.infer<typeof RunnerDecisionSchema>;
type RunnerAction = z.infer<typeof RunnerActionSchema>;
type JsonRecord = Record<string, unknown>;

type CandidateIp = {
  id: string;
  title: string;
  summary: string;
  genres: string[];
  tags: string[];
  region: string | null;
  viewCount: number;
  likeCount: number;
  collectionCount: number;
};

type CandidateIpSource = {
  items: unknown[];
};

@Injectable()
export class AgentUserRunnerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(AgentUserRunnerService.name);
  private readonly config = loadRunnerConfig();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentUsers: AgentUsersService,
    private readonly ipCommerce: IpCommerceService,
  ) {}

  onModuleInit() {
    const backgroundEnabled = backgroundTasksEnabled();
    if (!this.config.enabled) {
      this.logger.log('Agent User runner disabled.');
      return;
    }
    if (!process.env.ALIBABA_API_KEY?.trim()) {
      throw new Error(
        'AGENT_USER_RUNNER_ENABLED=true requires ALIBABA_API_KEY.',
      );
    }
    if (!backgroundEnabled) return;
    this.timer = setInterval(
      () => void this.runTick({ trigger: 'scheduler' }),
      this.config.intervalMs,
    );
    this.timer.unref?.();
    this.logger.log(
      `Agent User runner enabled: interval=${this.config.intervalMs}ms model=${this.config.modelId}`,
    );
    if (this.config.runOnBoot) {
      setTimeout(() => void this.runTick({ trigger: 'boot' }), 1000).unref?.();
    }
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async runTick(input: { trigger: string; agentUserId?: string }) {
    if (!backgroundTasksEnabled()) {
      return { skipped: true, reason: 'background_tasks_disabled' };
    }
    if (this.ticking) {
      return { skipped: true, reason: 'runner_busy' };
    }
    this.ticking = true;
    const startedAt = new Date();
    try {
      const dueAgents = await this.loadDueAgents(input.agentUserId);
      const results: Array<{
        agentUserId: string;
        status: string;
        reason?: string;
        runId?: string;
      }> = [];
      let startedAgents = 0;

      for (const agent of dueAgents) {
        if (!input.agentUserId) {
          const schedule = scheduleGate(agent.schedule, agent.timezone);
          if (!schedule.ok) {
            results.push({
              agentUserId: agent.id,
              status: 'skipped',
              reason: schedule.reason,
            });
            continue;
          }
        }
        // Manual execution may bypass the calendar, never quotas or the
        // cross-process claim used by scheduled execution.
        const budget = await this.budgetGate(agent);
        if (!budget.ok) {
          results.push({
            agentUserId: agent.id,
            status: 'skipped',
            reason: budget.reason,
          });
          continue;
        }
        if (startedAgents >= this.config.maxAgentsPerTick) break;
        const claimed = await this.claimAgent(agent.id);
        if (!claimed) {
          results.push({
            agentUserId: agent.id,
            status: 'skipped',
            reason: 'already_claimed',
          });
          continue;
        }
        startedAgents += 1;

        const result = await this.runOneAgent(agent.id, input.trigger);
        results.push(result);
      }

      return {
        skipped: false,
        trigger: input.trigger,
        startedAt: startedAt.toISOString(),
        completedAt: new Date().toISOString(),
        results,
      };
    } finally {
      this.ticking = false;
    }
  }

  private async loadDueAgents(agentUserId?: string) {
    const spacingCutoff = new Date(
      Date.now() - this.config.minRunSpacingMinutes * 60_000,
    );
    return this.prisma.agentUser.findMany({
      where: {
        status: 'active',
        ...(agentUserId
          ? { id: agentUserId }
          : {
              OR: [{ lastRunAt: null }, { lastRunAt: { lt: spacingCutoff } }],
            }),
      },
      orderBy: [{ lastRunAt: 'asc' }, { updatedAt: 'desc' }],
      take: agentUserId ? 1 : this.config.maxAgentsPerTick * 3,
    });
  }

  private async claimAgent(agentUserId: string) {
    const spacingCutoff = new Date(
      Date.now() - this.config.minRunSpacingMinutes * 60_000,
    );
    const result = await this.prisma.agentUser.updateMany({
      where: {
        id: agentUserId,
        status: 'active',
        OR: [{ lastRunAt: null }, { lastRunAt: { lt: spacingCutoff } }],
      },
      data: { lastRunAt: new Date() },
    });
    return result.count === 1;
  }

  private async budgetGate(
    agent: {
      id: string;
      schedule: unknown;
    },
    requiredActions = 1,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const schedule = asRecord(agent.schedule);
    const dailyBudget = positiveInt(schedule.dailyActionBudget, 30);
    const hourlyBudget = positiveInt(schedule.hourlyActionBudget, 6);
    const [dailyCount, hourlyCount] = await Promise.all([
      this.prisma.agentAction.count({
        where: {
          agentUserId: agent.id,
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60_000) },
          status: { in: budgetedActionStatuses() },
        },
      }),
      this.prisma.agentAction.count({
        where: {
          agentUserId: agent.id,
          createdAt: { gte: new Date(Date.now() - 60 * 60_000) },
          status: { in: budgetedActionStatuses() },
        },
      }),
    ]);
    if (dailyCount + requiredActions > dailyBudget)
      return { ok: false, reason: 'daily_budget' };
    if (hourlyCount + requiredActions > hourlyBudget)
      return { ok: false, reason: 'hourly_budget' };
    return { ok: true };
  }

  private async runOneAgent(agentUserId: string, trigger: string) {
    const agent = await this.prisma.agentUser.findUnique({
      where: { id: agentUserId },
      include: {
        memories: {
          where: { status: AgentMemoryStatus.active },
          orderBy: [{ updatedAt: 'desc' }],
          take: 20,
        },
      },
    });
    if (!agent || agent.status !== 'active') {
      return { agentUserId, status: 'skipped', reason: 'not_active' };
    }

    const run = await this.agentUsers.createRun(agentUserId, {
      trigger,
      status: 'running',
      objective: 'Autonomous IP plaza engagement.',
      metadata: {
        runner: 'agent_user_runner',
        model: this.config.modelId,
      },
    });

    try {
      const candidates = await this.loadCandidateIps(agent);
      if (candidates.length === 0) {
        await this.agentUsers.completeRun(run.id, {
          status: 'succeeded',
          summary: 'No public IP candidates available.',
          metrics: { candidates: 0, executedActions: 0 },
          metadata: { runner: 'agent_user_runner' },
        });
        return { agentUserId, status: 'succeeded', runId: run.id };
      }

      const decision = await this.decide(agent, candidates);
      const execution = await this.executeDecision({
        agentUserId,
        runId: run.id,
        decision,
        candidates,
        policy: asRecord(agent.policy),
      });

      await this.persistDecisionMemories({
        agentUserId,
        runId: run.id,
        decision,
        executedActionIds: execution.actionIds,
      });

      await this.agentUsers.completeRun(run.id, {
        status: 'succeeded',
        summary:
          decision.runSummary ||
          `Executed ${execution.executedCount} autonomous IP actions.`,
        metrics: {
          candidates: candidates.length,
          requestedActions: decision.actions.length,
          executedActions: execution.executedCount,
          skippedActions: execution.skippedCount,
        },
        metadata: {
          runner: 'agent_user_runner',
          model: this.config.modelId,
        },
      });
      return { agentUserId, status: 'succeeded', runId: run.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Agent runner failed for ${agentUserId}: ${message}`,
        error instanceof Error ? error.stack : undefined,
      );
      await this.agentUsers.completeRun(run.id, {
        status: 'failed',
        summary: 'Agent runner failed.',
        errorCode: 'AGENT_RUNNER_FAILED',
        errorMessage: message,
        metrics: {},
        metadata: {
          runner: 'agent_user_runner',
          model: this.config.modelId,
        },
      });
      return { agentUserId, status: 'failed', reason: message, runId: run.id };
    }
  }

  private async loadCandidateIps(agent: {
    locale: string;
    region: string | null;
    persona: unknown;
  }): Promise<CandidateIp[]> {
    const persona = asRecord(agent.persona);
    const interests = stringArray(persona.interests);
    const taxonomyCodes = interests
      .map((value) => value.toLowerCase().replaceAll(' ', '-'))
      .filter((value) => /^[a-z0-9][a-z0-9_-]*$/.test(value))
      .slice(0, 6);
    const genreCodes = taxonomyCodes.filter((code) =>
      PUBLIC_GENRE_CODES.has(code),
    );
    const tagCodes = taxonomyCodes.filter(
      (code) => !PUBLIC_GENRE_CODES.has(code),
    );
    const locale = supportedLocale(agent.locale);
    const withRegion = agent.region
      ? toCandidateIpSource(
          await this.ipCommerce.listPublicIps({
            genreCodes: [],
            tagCodes: [],
            regions: [agent.region],
            locale,
            limit: this.config.candidateLimit,
          }),
        )
      : { items: [] };
    const source =
      withRegion.items.length > 0
        ? withRegion
        : toCandidateIpSource(
            await this.ipCommerce.listPublicIps({
              genreCodes,
              tagCodes,
              regions: [],
              locale,
              limit: this.config.candidateLimit,
            }),
          );
    return source.items.map(candidateIpFromPayload).filter(hasCandidateId);
  }

  private async decide(
    agent: {
      handle: string;
      displayName: string;
      locale: string;
      region: string | null;
      timezone: string;
      persona: unknown;
      schedule: unknown;
      policy: unknown;
      memories: Array<{
        type: string;
        scopeType: string | null;
        scopeId: string | null;
        summary: string;
        confidence: number;
        weight: number;
      }>;
    },
    candidates: CandidateIp[],
  ): Promise<RunnerDecision> {
    const alibaba = createAlibaba({
      apiKey: requireEnv('ALIBABA_API_KEY'),
      ...(process.env.ALIBABA_BASE_URL?.trim()
        ? { baseURL: process.env.ALIBABA_BASE_URL.trim() }
        : {}),
    });
    const { object } = await generateObject({
      model: alibaba(this.config.modelId),
      schema: RunnerDecisionSchema,
      schemaName: 'AgentUserIpEngagementDecision',
      schemaDescription:
        'A bounded set of IP plaza engagement actions for one synthetic user.',
      maxRetries: 2,
      system: [
        'You drive one synthetic FizzDragon user. Choose realistic, low-volume IP plaza behavior.',
        'Respect the persona, policy, memories, and candidate list. Do not invent IP ids.',
        'Prefer view-only for weak matches; like or collect only when the persona has a clear reason.',
        'Return structured JSON only.',
      ].join('\n'),
      prompt: JSON.stringify(
        {
          agent: {
            handle: agent.handle,
            displayName: agent.displayName,
            locale: agent.locale,
            region: agent.region,
            timezone: agent.timezone,
            persona: agent.persona,
            schedule: agent.schedule,
            policy: agent.policy,
          },
          memories: agent.memories.map((memory) => ({
            type: memory.type,
            scopeType: memory.scopeType,
            scopeId: memory.scopeId,
            summary: memory.summary,
            confidence: memory.confidence,
            weight: memory.weight,
          })),
          actionBudget: {
            maxActions: this.config.maxActionsPerRun,
            allowedActions: ['view', 'like', 'collect', 'skip'],
          },
          candidates,
          instruction:
            'Choose 1-3 actions. Use each ipId from candidates only. Include concise reasons and any memory worth persisting.',
        },
        null,
        2,
      ),
    });
    return object;
  }

  private async executeDecision(input: {
    agentUserId: string;
    runId: string;
    decision: RunnerDecision;
    candidates: CandidateIp[];
    policy: JsonRecord;
  }) {
    const candidateIds = new Set(
      input.candidates.map((candidate) => candidate.id),
    );
    const capabilities = asRecord(input.policy.capabilities);
    const actionIds: string[] = [];
    let executedCount = 0;
    let skippedCount = 0;

    for (const action of input.decision.actions.slice(
      0,
      this.config.maxActionsPerRun,
    )) {
      if (!candidateIds.has(action.ipId)) {
        skippedCount += 1;
        continue;
      }
      let allowed = actionAllowed(action, capabilities);
      if (allowed.ok && action.action !== 'skip') {
        const current = await this.prisma.agentUser.findUnique({
          where: { id: input.agentUserId },
          select: { id: true, status: true, schedule: true, policy: true },
        });
        if (!current || current.status !== 'active') {
          allowed = { ok: false, reason: 'not_active' };
        } else {
          // A plan is not permission to use capabilities revoked while it ran.
          allowed = actionAllowed(
            action,
            asRecord(asRecord(current.policy).capabilities),
          );
          if (allowed.ok) {
            // A like/collection also records a view. Admit both or neither.
            allowed = await this.budgetGate(
              current,
              action.action === 'view' ? 1 : 2,
            );
          }
        }
      }
      if (!allowed.ok) {
        const skipped = await this.agentUsers.createAction(input.agentUserId, {
          runId: input.runId,
          actionType: `ip.${action.action}`,
          targetType: 'ip',
          targetId: action.ipId,
          status: 'skipped',
          decision: decisionPayload(action),
          input: {},
          result: { reason: allowed.reason },
          metadata: { runner: 'agent_user_runner' },
        });
        actionIds.push(skipped.id);
        skippedCount += 1;
        continue;
      }

      const created = await this.executeAction(input, action);
      actionIds.push(...created);
      executedCount += created.length;
    }
    return { actionIds, executedCount, skippedCount };
  }

  private async executeAction(
    input: {
      agentUserId: string;
      runId: string;
    },
    action: RunnerAction,
  ) {
    const ids: string[] = [];
    if (action.action === 'skip') {
      const skipped = await this.agentUsers.createAction(input.agentUserId, {
        runId: input.runId,
        actionType: 'ip.skip',
        targetType: 'ip',
        targetId: action.ipId,
        status: 'skipped',
        decision: decisionPayload(action),
        input: {},
        result: {},
        metadata: { runner: 'agent_user_runner' },
      });
      return [skipped.id];
    }

    const viewResult = await this.ipCommerce.recordAgentIpView(
      input.agentUserId,
      action.ipId,
      {
        source: 'agent_runner',
        idempotencyKey: `${input.runId}:${action.ipId}:view`,
      },
    );
    const viewAction = await this.agentUsers.createAction(input.agentUserId, {
      runId: input.runId,
      actionType: 'ip.view',
      targetType: 'ip',
      targetId: action.ipId,
      status: viewResult.recorded ? 'succeeded' : 'skipped',
      idempotencyKey: `agent:${input.agentUserId}:run:${input.runId}:ip.view:${action.ipId}`,
      decision: decisionPayload(action),
      input: { source: 'agent_runner' },
      result: viewResult,
      metadata: { runner: 'agent_user_runner' },
    });
    ids.push(viewAction.id);

    if (action.action === 'like') {
      const result = await this.ipCommerce.likeAgentIp(
        input.agentUserId,
        action.ipId,
      );
      const likeAction = await this.agentUsers.createAction(input.agentUserId, {
        runId: input.runId,
        actionType: 'ip.like',
        targetType: 'ip',
        targetId: action.ipId,
        status: 'succeeded',
        idempotencyKey: `agent:${input.agentUserId}:run:${input.runId}:ip.like:${action.ipId}`,
        decision: decisionPayload(action),
        input: {},
        result,
        metadata: { runner: 'agent_user_runner' },
      });
      ids.push(likeAction.id);
    }

    if (action.action === 'collect') {
      const result = await this.ipCommerce.saveAgentCollectionItem(
        input.agentUserId,
        action.ipId,
      );
      const collectAction = await this.agentUsers.createAction(
        input.agentUserId,
        {
          runId: input.runId,
          actionType: 'ip.collect',
          targetType: 'ip',
          targetId: action.ipId,
          status: 'succeeded',
          idempotencyKey: `agent:${input.agentUserId}:run:${input.runId}:ip.collect:${action.ipId}`,
          decision: decisionPayload(action),
          input: {},
          result,
          metadata: { runner: 'agent_user_runner' },
        },
      );
      ids.push(collectAction.id);
    }

    return ids;
  }

  private async persistDecisionMemories(input: {
    agentUserId: string;
    runId: string;
    decision: RunnerDecision;
    executedActionIds: string[];
  }) {
    for (const action of input.decision.actions) {
      const summary = action.memorySummary || action.reason;
      if (!summary || action.action === 'skip') continue;
      await this.agentUsers.upsertMemory(input.agentUserId, {
        memoryKey: `ip:${action.ipId}:${action.action}`,
        type: action.action === 'view' ? 'content_affinity' : 'preference',
        status: 'active',
        scopeType: 'ip',
        scopeId: action.ipId,
        summary,
        content: {
          source: 'agent_user_runner',
          runId: input.runId,
          action: action.action,
        },
        confidence: action.action === 'view' ? 45 : 65,
        weight: action.action === 'collect' ? 140 : 100,
        sourceActionIds: input.executedActionIds,
      });
    }

    for (const memory of input.decision.memories) {
      await this.agentUsers.upsertMemory(input.agentUserId, {
        memoryKey: memory.memoryKey,
        type: memory.type,
        status: 'active',
        scopeType: memory.scopeIpId ? 'ip' : null,
        scopeId: memory.scopeIpId ?? null,
        summary: memory.summary,
        content: {
          source: 'agent_user_runner',
          runId: input.runId,
        },
        confidence: memory.confidence,
        weight: memory.weight,
        sourceActionIds: input.executedActionIds,
      });
    }
  }
}

function loadRunnerConfig() {
  return {
    enabled: boolEnv('AGENT_USER_RUNNER_ENABLED', false),
    runOnBoot: boolEnv('AGENT_USER_RUNNER_RUN_ON_BOOT', false),
    intervalMs: intEnv('AGENT_USER_RUNNER_INTERVAL_MS', 5 * 60_000, {
      min: 60_000,
      max: 24 * 60 * 60_000,
    }),
    minRunSpacingMinutes: intEnv(
      'AGENT_USER_RUNNER_MIN_RUN_SPACING_MINUTES',
      60,
      { min: 5, max: 24 * 60 },
    ),
    maxAgentsPerTick: intEnv('AGENT_USER_RUNNER_MAX_AGENTS_PER_TICK', 3, {
      min: 1,
      max: 50,
    }),
    maxActionsPerRun: intEnv('AGENT_USER_RUNNER_MAX_ACTIONS_PER_RUN', 3, {
      min: 1,
      max: 5,
    }),
    candidateLimit: intEnv('AGENT_USER_RUNNER_CANDIDATE_LIMIT', 12, {
      min: 3,
      max: 50,
    }),
    modelId: process.env.AGENT_USER_RUNNER_MODEL?.trim() || 'qwen3.6-plus',
  };
}

function scheduleGate(
  rawSchedule: unknown,
  timezone: string,
): { ok: true } | { ok: false; reason: string } {
  const schedule = asRecord(rawSchedule);
  if (stringValue(schedule.mode, 'scheduled') === 'manual') {
    return { ok: false, reason: 'manual_mode' };
  }
  const local = localTimeParts(new Date(), timezone);
  const activeDays = numberArray(schedule.activeDays, [1, 2, 3, 4, 5]);
  if (!activeDays.includes(local.day)) {
    return { ok: false, reason: 'inactive_day' };
  }
  const window = asRecord(schedule.activeWindow);
  const start = parseMinutes(stringValue(window.start, '09:00'));
  const end = parseMinutes(stringValue(window.end, '23:00'));
  if (!timeInWindow(local.minutes, start, end)) {
    return { ok: false, reason: 'inactive_window' };
  }
  return { ok: true };
}

function actionAllowed(
  action: RunnerAction,
  capabilities: JsonRecord,
): { ok: true } | { ok: false; reason: string } {
  if (action.action === 'skip') return { ok: true };
  // Every engagement action records a view before its other side effects.
  if (capabilities.viewIp === false) {
    return { ok: false, reason: 'view_disabled' };
  }
  if (action.action === 'like' && capabilities.likeIp === false) {
    return { ok: false, reason: 'like_disabled' };
  }
  if (action.action === 'collect' && capabilities.collectIp === false) {
    return { ok: false, reason: 'collect_disabled' };
  }
  return { ok: true };
}

function budgetedActionStatuses() {
  return [
    AgentActionStatus.planned,
    AgentActionStatus.running,
    AgentActionStatus.succeeded,
  ];
}

function decisionPayload(action: RunnerAction): JsonRecord {
  return {
    action: action.action,
    reason: action.reason,
    memorySummary: action.memorySummary ?? null,
  };
}

function toCandidateIpSource(value: unknown): CandidateIpSource {
  const record = asRecord(value);
  return {
    items: Array.isArray(record.items) ? record.items : [],
  };
}

function candidateIpFromPayload(value: unknown): CandidateIp {
  const record = asRecord(value);
  const engagement = asRecord(record.engagement);
  return {
    id: stringValue(record.id, ''),
    title: stringValue(record.title, 'Untitled IP'),
    summary: stringValue(record.summary, ''),
    genres: stringArray(record.genres),
    tags: stringArray(record.tags),
    region: nullableString(record.region),
    viewCount: positiveInt(
      engagement.viewCount,
      positiveInt(record.viewCount, 0),
    ),
    likeCount: positiveInt(
      engagement.likeCount,
      positiveInt(record.likeCount, 0),
    ),
    collectionCount: positiveInt(
      engagement.collectionCount,
      positiveInt(record.collectionCount, 0),
    ),
  };
}

function hasCandidateId(candidate: CandidateIp): boolean {
  return candidate.id.length > 0;
}

function requireEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is not set.`);
  return value;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const value = process.env[name]?.trim().toLowerCase();
  if (!value) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value);
}

function intEnv(
  name: string,
  fallback: number,
  bounds: { min: number; max: number },
): number {
  const value = Number(process.env[name]);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(bounds.max, Math.max(bounds.min, value));
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown, fallback: string): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveInt(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : fallback;
}

function numberArray(value: unknown, fallback: number[]): number[] {
  if (!Array.isArray(value)) return fallback;
  const parsed = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item));
  return parsed.length ? parsed : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

function localTimeParts(date: Date, timezone: string) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(date);
    const weekday =
      parts.find((part) => part.type === 'weekday')?.value ?? 'Mon';
    const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? 0);
    const minute = Number(
      parts.find((part) => part.type === 'minute')?.value ?? 0,
    );
    return {
      day:
        {
          Sun: 0,
          Mon: 1,
          Tue: 2,
          Wed: 3,
          Thu: 4,
          Fri: 5,
          Sat: 6,
        }[weekday] ?? 1,
      minutes: hour * 60 + minute,
    };
  } catch {
    const utc = new Date(date.toISOString());
    return {
      day: utc.getUTCDay(),
      minutes: utc.getUTCHours() * 60 + utc.getUTCMinutes(),
    };
  }
}

function parseMinutes(value: string): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return 0;
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const minute = Math.min(59, Math.max(0, Number(match[2])));
  return hour * 60 + minute;
}

function timeInWindow(current: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return current >= start && current <= end;
  return current >= start || current <= end;
}

function supportedLocale(locale: string): 'en-US' | 'zh-CN' | 'zh-HK' {
  return locale === 'en-US' || locale === 'zh-HK' ? locale : 'zh-CN';
}
