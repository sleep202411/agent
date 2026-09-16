import { HttpException, Injectable } from '@nestjs/common';
import { PrismaService } from '../infra/db/db.module';
import { AiGenerationService } from '../ai-generation/ai-generation.service';
import { AgentOsProjectContextService } from '../agent-os-gateway/agent-os-project-context.service';
import type { AuthUser } from '../auth';

type Status =
  | 'pending'
  | 'running'
  | 'waiting'
  | 'completed'
  | 'failed'
  | 'cancelled';
type TaskType = 'image' | 'video' | 'audio' | 'agent' | 'production';
export interface RecentTask {
  id: string;
  remoteId: string;
  type: TaskType;
  status: Status;
  source: 'server';
  projectId?: string;
  input: Record<string, never>;
  createdAt: number;
  updatedAt: number;
}
const LIMIT = 100;
const AI_STATUS: Record<string, Status> = {
  created: 'pending',
  in_queue: 'pending',
  in_progress: 'running',
  completed: 'completed',
  failed: 'failed',
  expired: 'failed',
  cancelled: 'cancelled',
};
const AGENT_STATUS: Record<string, Status> = {
  queued: 'pending',
  running: 'running',
  waiting_for_external: 'running',
  waiting_for_approval: 'waiting',
  waiting_for_input: 'waiting',
  waiting_for_user_input: 'waiting',
  completed: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};
const PRODUCTION_STATUS: Record<string, Status> = {
  authoring: 'running',
  authoring_failed: 'failed',
  proposed: 'waiting',
  applying: 'running',
  succeeded: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
  stale: 'failed',
};
const BUILD_STATUS: Record<string, Status> = {
  queued: 'pending',
  validating: 'running',
  compiling: 'running',
  ready: 'completed',
  failed: 'failed',
  cancelled: 'cancelled',
};

function statusFrom(
  map: Record<string, Status>,
  value: string,
): Status | undefined {
  return Object.hasOwn(map, value) ? map[value] : undefined;
}

/** Read-only recent work. Execution, approval and cancellation retain their own routes. */
@Injectable()
export class TasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ai: AiGenerationService,
    private readonly projects: AgentOsProjectContextService,
  ) {}

  async list(user: AuthUser): Promise<RecentTask[]> {
    const [ai, agents, production, builds] = await Promise.all([
      this.ai.listJobs(user, { limit: String(LIMIT) }),
      this.prisma.agentOsRun.findMany({
        where: { actorId: user.userId },
        take: LIMIT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          projectId: true,
          projectKind: true,
          workbenchMode: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.storyAgentRun.findMany({
        where: { initiatedByUserId: user.userId },
        take: LIMIT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          storyProjectId: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
      this.prisma.storyBuild.findMany({
        where: { createdByUserId: user.userId },
        take: LIMIT,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: {
          id: true,
          storyProjectId: true,
          status: true,
          createdAt: true,
          updatedAt: true,
        },
      }),
    ]);
    // Never expose an Agent/Story record after its project read permission is lost.
    // Cache only within this request; permission changes are checked on the next read.
    const access = new Map<string, Promise<string | null>>();
    const projectKind = (id: string) => {
      let pending = access.get(id);
      if (!pending) {
        pending = this.projects
          .requireRead(user.userId, id)
          .then((context) => context.projectKind)
          .catch((error: unknown) => {
            if (
              error instanceof HttpException &&
              [403, 404].includes(error.getStatus())
            )
              return null;
            throw error;
          });
        access.set(id, pending);
      }
      return pending;
    };
    const tasks: RecentTask[] = [];
    const add = (
      prefix: string,
      row: { id: string; createdAt: Date | string; updatedAt: Date | string },
      type: TaskType,
      status: Status | undefined,
      projectId?: string | null,
    ) => {
      if (!status) return;
      tasks.push({
        id: `${prefix}:${row.id}`,
        remoteId: row.id,
        type,
        status,
        source: 'server',
        ...(projectId ? { projectId } : {}),
        input: {},
        createdAt: new Date(row.createdAt).getTime(),
        updatedAt: new Date(row.updatedAt).getTime(),
      });
    };
    for (const job of ai.jobs)
      add(
        'ai',
        job,
        job.type,
        statusFrom(AI_STATUS, job.status),
        job.projectId ?? job.storyProjectId,
      );
    for (const run of agents) {
      if (
        !run.projectKind ||
        !run.workbenchMode ||
        (await projectKind(run.projectId)) !== run.projectKind
      )
        continue;
      add(
        'agent',
        run,
        'agent',
        statusFrom(AGENT_STATUS, run.status),
        run.projectId,
      );
    }
    for (const run of production) {
      if ((await projectKind(run.storyProjectId)) !== 'story') continue;
      add(
        'production',
        run,
        'production',
        statusFrom(PRODUCTION_STATUS, run.status),
        run.storyProjectId,
      );
    }
    for (const build of builds) {
      if ((await projectKind(build.storyProjectId)) !== 'story') continue;
      add(
        'build',
        build,
        'production',
        statusFrom(BUILD_STATUS, build.status),
        build.storyProjectId,
      );
    }
    return tasks.sort(
      (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id),
    );
  }
}
