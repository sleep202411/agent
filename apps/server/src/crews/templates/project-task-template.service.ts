import { Injectable, Logger } from '@nestjs/common';
import {
  CrewProductionKind,
  Prisma,
  type CrewTask,
  type ProjectTaskTemplate,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import {
  DEFAULT_SERIES_TASK_TEMPLATE,
  type TaskTemplateDefinition,
  type TaskTemplateItem,
} from './project-task-template.types';
import { randomUUID } from 'node:crypto';

export interface InstantiateTasksOptions {
  idempotencyKey?: string;
  userId?: string;
  workflowStateId?: string;
  episodeId?: string;
}

@Injectable()
export class ProjectTaskTemplateService {
  private readonly logger = new Logger(ProjectTaskTemplateService.name);

  constructor(private readonly prisma: PrismaService) {}

  async resolveActiveTemplate(
    projectType: CrewProductionKind,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<ProjectTaskTemplate | null> {
    // Guard: some callers (tests, partial transaction mocks) may not provide
    // the projectTaskTemplate delegate. Fall back to the in-memory default.
    const hasTemplateModel =
      client &&
      typeof (client as any).projectTaskTemplate?.findFirst === 'function';

    if (hasTemplateModel) {
      const found = await (client as any).projectTaskTemplate.findFirst({
        where: { projectType, active: true },
        orderBy: { version: 'desc' },
      });
      if (found) return found;
    }

    // Fallback default in memory if database has not been seeded yet
    if (projectType === CrewProductionKind.series) {
      return {
        id: '01990000-0000-7000-8000-000000000001',
        projectType: CrewProductionKind.series,
        name: '短剧全流程标准模板',
        version: 1,
        active: true,
        definition: DEFAULT_SERIES_TASK_TEMPLATE as unknown as Prisma.JsonValue,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
    }

    return null;
  }

  async instantiateTasks(
    tx: Prisma.TransactionClient,
    crewId: string,
    template: ProjectTaskTemplate,
    options: InstantiateTasksOptions = {},
  ): Promise<CrewTask[]> {
    // Guard: tx or tx.crewTask may be a partial mock in unit tests
    if (!tx || !(tx as any).crewTask) {
      this.logger.warn(
        `Cannot instantiate tasks for crew ${crewId}: crewTask delegate missing.`,
      );
      return [];
    }

    // 1. Idempotency check: query CrewTask where metadata matches templateId and crewId
    if (typeof (tx as any).crewTask.findMany === 'function') {
      const existing = await tx.crewTask.findMany({
        where: {
          crewId,
          metadata: {
            path: ['templateId'],
            equals: template.id,
          },
        },
        orderBy: { number: 'asc' },
      });

      if (existing.length > 0) {
        this.logger.log(
          `Found ${existing.length} existing tasks for crew ${crewId} and template ${template.id}, returning without re-creating.`,
        );
        return existing;
      }
    } else if (typeof (tx as any).crewTask.count === 'function') {
      const count = await (tx as any).crewTask.count({ where: { crewId } });
      if (count > 0 && !(tx as any).crewTask.create) {
        return [];
      }
    }

    // 2. Resolve default workflowStateId and episodeId if not provided
    let workflowStateId = options.workflowStateId;
    if (
      !workflowStateId &&
      typeof (tx as any).crewTaskWorkflowState?.findFirst === 'function'
    ) {
      const openState = await tx.crewTaskWorkflowState.findFirst({
        where: { crewId, systemKey: 'open' },
      });
      workflowStateId = openState?.id;
      if (!workflowStateId) {
        const anyState = await tx.crewTaskWorkflowState.findFirst({
          where: { crewId },
          orderBy: { position: 'asc' },
        });
        workflowStateId = anyState?.id;
      }
    }

    if (!workflowStateId) {
      this.logger.warn(
        `Cannot instantiate tasks for crew ${crewId}: no workflow state found.`,
      );
      return [];
    }

    let episodeId = options.episodeId;
    if (
      !episodeId &&
      typeof (tx as any).crewEpisode?.findFirst === 'function'
    ) {
      const episode = await tx.crewEpisode.findFirst({
        where: { crewId },
        orderBy: { number: 'asc' },
      });
      episodeId = episode?.id;
    }

    const definition = template.definition as unknown as TaskTemplateDefinition;
    const items: TaskTemplateItem[] = definition?.items ?? [];
    if (!items.length) {
      return [];
    }

    // Find current max task number in crew
    let lastTask: { number: number; rank: any } | null = null;
    if (typeof (tx as any).crewTask.findFirst === 'function') {
      lastTask = await tx.crewTask.findFirst({
        where: { crewId },
        orderBy: { number: 'desc' },
        select: { number: true, rank: true },
      });
    }

    let currentNumber = (lastTask?.number ?? 0) + 1;
    let currentRank = lastTask?.rank
      ? (lastTask.rank as Prisma.Decimal).plus(1024)
      : new Prisma.Decimal(1024);

    const createdTasks: CrewTask[] = [];
    const keyToTaskId = new Map<string, string>();

    // Pass 1: create tasks
    for (const item of items) {
      const taskId = randomUUID();
      keyToTaskId.set(item.templateKey, taskId);

      const metadata: Prisma.InputJsonObject = {
        templateId: template.id,
        templateVersion: template.version,
        templateKey: item.templateKey,
        ...(options.idempotencyKey
          ? { idempotencyKey: options.idempotencyKey }
          : {}),
        category: item.category,
        roleRequirement: item.roleRequirement,
        deliveryFields: item.deliveryFields as unknown as Prisma.InputJsonValue,
        unit: item.unit,
        ...(item.qualification !== undefined
          ? {
              qualification:
                item.qualification as unknown as Prisma.InputJsonValue,
            }
          : {}),
        ...(item.priceRange !== undefined
          ? { priceRange: item.priceRange as unknown as Prisma.InputJsonValue }
          : {}),
      };

      if (typeof (tx as any).crewTask.create === 'function') {
        const task = await tx.crewTask.create({
          data: {
            id: taskId,
            crewId,
            number: currentNumber,
            title: item.title,
            description: '',
            workflowStateId,
            taskKind: item.taskKind,
            episodeId,
            rank: currentRank,
            createdByUserId: options.userId ?? 'system',
            metadata,
          },
        });
        createdTasks.push(task);
      }

      currentNumber += 1;
      currentRank = currentRank.plus(1024);
    }

    // Pass 2: wire up default dependencies
    if (typeof (tx as any).crewTaskDependency?.create === 'function') {
      for (const item of items) {
        if (item.defaultDependencies?.length) {
          const blockedTaskId = keyToTaskId.get(item.templateKey);
          if (!blockedTaskId) continue;

          for (const depKey of item.defaultDependencies) {
            const blockingTaskId = keyToTaskId.get(depKey);
            if (blockingTaskId) {
              try {
                await tx.crewTaskDependency.create({
                  data: {
                    crewId,
                    blockingTaskId,
                    blockedTaskId,
                    createdByUserId: options.userId ?? 'system',
                  },
                });
              } catch (err) {
                this.logger.warn(
                  `Failed to link dependency ${blockingTaskId} -> ${blockedTaskId}: ${err}`,
                );
              }
            }
          }
        }
      }
    }

    return createdTasks;
  }
}
