import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import type { AgentProjectKind } from '@repo/agent-capabilities';
import type { ProjectSkillResolutionSnapshot } from '@repo/agent-skills';

export type AgentOsJournalEvent = {
  id: string;
  protocolVersion: string;
  sessionId: string;
  runId: string;
  conversationId: string;
  sequence: number;
  timestamp: string;
  type: string;
  data: Record<string, unknown>;
};

/**
 * Durable product-facing event journal for Agent OS runs.
 * PostgreSQL is authoritative for reconnect; Ably accelerates live UI.
 */
@Injectable()
export class AgentOsRunJournalService {
  constructor(private readonly prisma: PrismaService) {}

  async upsertSnapshot(input: {
    runId: string;
    projectId: string;
    conversationId: string;
    actorId: string;
    modelProfileId: string;
    status: string;
    events: AgentOsJournalEvent[];
    pendingApproval?: unknown;
    assistantText?: string | null;
    projectKind: AgentProjectKind;
    workbenchMode: string;
    workbenchContext?: Readonly<Record<string, string>>;
    skillMountSnapshot: ProjectSkillResolutionSnapshot;
  }): Promise<void> {
    const lastSequence =
      input.events.length === 0
        ? 0
        : Math.max(...input.events.map((event) => event.sequence));

    await this.prisma.agentOsRun.upsert({
      where: { id: input.runId },
      create: {
        id: input.runId,
        projectId: input.projectId,
        conversationId: input.conversationId,
        actorId: input.actorId,
        modelProfileId: input.modelProfileId,
        status: input.status,
        lastSequence,
        events: input.events as unknown as Prisma.InputJsonValue,
        pendingApproval:
          (input.pendingApproval as Prisma.InputJsonValue | undefined) ??
          Prisma.JsonNull,
        assistantText: input.assistantText ?? null,
        projectKind: input.projectKind,
        workbenchMode: input.workbenchMode,
        workbenchContext:
          (input.workbenchContext as Prisma.InputJsonValue | undefined) ??
          Prisma.JsonNull,
        skillSnapshot: input.skillMountSnapshot as Prisma.InputJsonValue,
      },
      update: {
        status: input.status,
        lastSequence,
        events: input.events as unknown as Prisma.InputJsonValue,
        pendingApproval:
          input.pendingApproval === undefined
            ? undefined
            : ((input.pendingApproval as Prisma.InputJsonValue | null) ??
              Prisma.JsonNull),
        assistantText: input.assistantText ?? null,
      },
    });
  }

  /**
   * Who a run belongs to. Callers authorize against THIS, not against a
   * projectId the client sent beside the runId — the two are unrelated ids, so
   * checking the one the caller chose proves nothing about the one they act on.
   */
  async getRunOwnership(runId: string): Promise<{
    projectId: string;
    actorId: string;
    conversationId: string;
    workbenchMode: string | null;
    workbenchContext: Readonly<Record<string, string>> | null;
    projectKind: AgentProjectKind | null;
    skillMountSnapshot: ProjectSkillResolutionSnapshot | null;
  } | null> {
    const row = await this.prisma.agentOsRun.findUnique({
      where: { id: runId },
      select: {
        projectId: true,
        actorId: true,
        conversationId: true,
        projectKind: true,
        workbenchMode: true,
        workbenchContext: true,
        skillSnapshot: true,
      },
    });
    if (!row) return null;
    return {
      projectId: row.projectId,
      actorId: row.actorId,
      conversationId: row.conversationId,
      projectKind:
        row.projectKind === 'platform' || row.projectKind === 'story'
          ? row.projectKind
          : null,
      workbenchMode: row.workbenchMode,
      workbenchContext: parseStringRecord(row.workbenchContext),
      skillMountSnapshot:
        (row.skillSnapshot as ProjectSkillResolutionSnapshot | null) ?? null,
    };
  }

  /**
   * Whether a conversation is already claimed by someone other than this
   * (project, actor). A conversation with no runs yet is unclaimed: the client
   * mints its realtime token before the first turn exists.
   */
  async conversationConflictsWith(input: {
    conversationId: string;
    projectId: string;
    actorId: string;
  }): Promise<boolean> {
    const foreign = await this.prisma.agentOsRun.findFirst({
      where: {
        conversationId: input.conversationId,
        OR: [
          { projectId: { not: input.projectId } },
          { actorId: { not: input.actorId } },
        ],
      },
      select: { id: true },
    });
    return foreign !== null;
  }

  async getEventsAfter(
    runId: string,
    afterSequence: number,
  ): Promise<{
    runId: string;
    status: string;
    events: AgentOsJournalEvent[];
    pendingApproval: unknown;
    assistantText: string | null;
    projectKind: AgentProjectKind | null;
    workbenchMode: string | null;
    workbenchContext: Readonly<Record<string, string>> | null;
    skillMountSnapshot: ProjectSkillResolutionSnapshot | null;
  } | null> {
    const row = await this.prisma.agentOsRun.findUnique({
      where: { id: runId },
    });
    if (!row) return null;
    const all = parseEvents(row.events);
    return {
      runId: row.id,
      status: row.status,
      events: all.filter((event) => event.sequence > afterSequence),
      pendingApproval: row.pendingApproval,
      assistantText: row.assistantText,
      projectKind:
        row.projectKind === 'platform' || row.projectKind === 'story'
          ? row.projectKind
          : null,
      workbenchMode: row.workbenchMode,
      workbenchContext: parseStringRecord(row.workbenchContext),
      skillMountSnapshot:
        (row.skillSnapshot as ProjectSkillResolutionSnapshot | null) ?? null,
    };
  }

  /**
   * Load one conversation's runs (oldest → newest) for transcript restore.
   * When conversationId is omitted, uses the actor's most recent conversation
   * on the project.
   */
  async getConversationHistory(input: {
    projectId: string;
    actorId: string;
    conversationId?: string;
    limit?: number;
  }): Promise<{
    conversationId: string | null;
    runs: Array<{
      runId: string;
      status: string;
      modelProfileId: string;
      events: AgentOsJournalEvent[];
      pendingApproval: unknown;
      assistantText: string | null;
      createdAt: string;
      updatedAt: string;
    }>;
  }> {
    const limit = Math.min(Math.max(input.limit ?? 40, 1), 80);
    let conversationId = input.conversationId?.trim() || null;

    if (!conversationId) {
      const latest = await this.prisma.agentOsRun.findFirst({
        where: {
          projectId: input.projectId,
          actorId: input.actorId,
        },
        orderBy: { createdAt: 'desc' },
        select: { conversationId: true },
      });
      conversationId = latest?.conversationId ?? null;
    }

    if (!conversationId) {
      return { conversationId: null, runs: [] };
    }

    const rows = await this.prisma.agentOsRun.findMany({
      where: {
        projectId: input.projectId,
        actorId: input.actorId,
        conversationId,
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    return {
      conversationId,
      runs: rows.map((row) => ({
        runId: row.id,
        status: row.status,
        modelProfileId: row.modelProfileId,
        events: parseEvents(row.events),
        pendingApproval: row.pendingApproval,
        assistantText: row.assistantText,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
      })),
    };
  }
}

function parseStringRecord(
  value: unknown,
): Readonly<Record<string, string>> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const entries = Object.entries(value);
  if (entries.some(([, item]) => typeof item !== 'string')) return null;
  return Object.fromEntries(entries) as Record<string, string>;
}

function parseEvents(value: Prisma.JsonValue): AgentOsJournalEvent[] {
  if (!Array.isArray(value)) return [];
  const out: AgentOsJournalEvent[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const row = item as Record<string, unknown>;
    if (typeof row.sequence !== 'number' || typeof row.type !== 'string') {
      continue;
    }
    out.push({
      id: typeof row.id === 'string' ? row.id : crypto.randomUUID(),
      protocolVersion:
        typeof row.protocolVersion === 'string'
          ? row.protocolVersion
          : 'fizz.agent.v1',
      sessionId: typeof row.sessionId === 'string' ? row.sessionId : '',
      runId: typeof row.runId === 'string' ? row.runId : '',
      conversationId:
        typeof row.conversationId === 'string' ? row.conversationId : '',
      sequence: row.sequence,
      timestamp:
        typeof row.timestamp === 'string'
          ? row.timestamp
          : new Date().toISOString(),
      type: row.type,
      data:
        row.data !== null &&
        typeof row.data === 'object' &&
        !Array.isArray(row.data)
          ? (row.data as Record<string, unknown>)
          : {},
    });
  }
  return out;
}
