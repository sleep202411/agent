import { provisionTaskDeliveryFolderTx } from '../tasks/task-delivery-folder';
import { TaskTemplateDefinitionSchema } from './project-task-template.schema';
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  CrewProductionKind,
  Prisma,
  type CrewTask,
  type ProjectTaskTemplate,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import {
  DEFAULT_SERIES_TASK_TEMPLATE,
  DEFAULT_INTERACTIVE_FILM_TASK_TEMPLATE,
  PlotTreeSchema,
  type PlotTreeImportInput,
  type PlotTreeImportSummary,
  type TaskTemplateDefinition,
  type TaskTemplateItem,
} from './project-task-template.types';
import { randomUUID } from 'node:crypto';

export interface InstantiateTasksOptions {
  idempotencyKey?: string;
  userId?: string;
  workflowStateId?: string;
  episodeId?: string;
  episodeScoped?: boolean;
  taskFields?: Record<
    string,
    Array<{ fieldId: string; value: Prisma.InputJsonValue }>
  >;
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
      client && typeof client.projectTaskTemplate?.findFirst === 'function';

    if (hasTemplateModel) {
      const found = await client.projectTaskTemplate.findFirst({
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
    if (options.episodeScoped && !options.episodeId) {
      throw new BadRequestException(
        'An episode is required for an episode template.',
      );
    }
    // Guard: tx or tx.crewTask may be a partial mock in unit tests
    if (!tx || !tx.crewTask) {
      this.logger.warn(
        `Cannot instantiate tasks for crew ${crewId}: crewTask delegate missing.`,
      );
      return [];
    }

    // 1. Idempotency check: query CrewTask where metadata matches templateId and crewId
    if (typeof tx.crewTask.findMany === 'function') {
      const existing = await tx.crewTask.findMany({
        where: {
          crewId,
          ...(options.episodeScoped ? { episodeId: options.episodeId } : {}),
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
    } else if (typeof tx.crewTask.count === 'function') {
      const count = await tx.crewTask.count({ where: { crewId } });
      if (count > 0 && !tx.crewTask.create) {
        return [];
      }
    }

    // 2. Resolve default workflowStateId and episodeId if not provided
    let workflowStateId = options.workflowStateId;
    if (
      !workflowStateId &&
      typeof tx.crewTaskWorkflowState?.findFirst === 'function'
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
    if (!episodeId && typeof tx.crewEpisode?.findFirst === 'function') {
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
    let lastTask: { number: number; rank: Prisma.Decimal } | null = null;
    if (typeof tx.crewTask.findFirst === 'function') {
      lastTask = await tx.crewTask.findFirst({
        where: { crewId },
        orderBy: { number: 'desc' },
        select: { number: true, rank: true },
      });
    }

    let currentNumber = (lastTask?.number ?? 0) + 1;
    let currentRank = lastTask?.rank
      ? lastTask.rank.plus(1024)
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

      if (typeof tx.crewTask.create === 'function') {
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
            ...(options.taskFields?.[item.templateKey]?.length
              ? {
                  customFieldValues: {
                    create: options.taskFields[item.templateKey].map(
                      (field) => ({
                        ...field,
                        updatedByUserId: options.userId ?? 'system',
                      }),
                    ),
                  },
                }
              : {}),
          },
        });
        await provisionTaskDeliveryFolderTx(
          tx,
          task,
          options.userId ?? 'system',
        );
        createdTasks.push(task);
      }

      currentNumber += 1;
      currentRank = currentRank.plus(1024);
    }

    // Pass 2: wire up default dependencies
    if (typeof tx.crewTaskDependency?.create === 'function') {
      for (const item of items) {
        if (item.defaultDependencies?.length) {
          const blockedTaskId = keyToTaskId.get(item.templateKey);
          if (!blockedTaskId) continue;

          for (const depKey of item.defaultDependencies) {
            const blockingTaskId = keyToTaskId.get(depKey);
            if (blockingTaskId) {
              await tx.crewTaskDependency.create({
                data: {
                  crewId,
                  blockingTaskId,
                  blockedTaskId,
                  createdByUserId: options.userId ?? 'system',
                },
              });
            }
          }
        }
      }
    }

    return createdTasks;
  }
  async listAllAdmin(filter?: {
    projectType?: CrewProductionKind;
    includeInactive?: boolean;
  }): Promise<ProjectTaskTemplate[]> {
    const where: Prisma.ProjectTaskTemplateWhereInput = {};
    if (filter?.projectType) where.projectType = filter.projectType;
    if (!filter?.includeInactive) where.active = true;
    return this.prisma.projectTaskTemplate.findMany({
      where,
      orderBy: [{ projectType: 'asc' }, { version: 'desc' }],
    });
  }

  async saveAdmin(input: {
    projectType: CrewProductionKind;
    name: string;
    definition: unknown;
  }): Promise<ProjectTaskTemplate> {
    const definition = TaskTemplateDefinitionSchema.safeParse(input.definition);
    if (!definition.success) {
      throw new BadRequestException({
        message: 'Invalid project task template definition',
        issues: definition.error.issues,
      });
    }
    return this.prisma.$transaction(async (tx) => {
      // Saving and plot-tree import share this lock, including the first version.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:project-task-template:${input.projectType}`}, 0))`;
      const latest = await tx.projectTaskTemplate.findFirst({
        where: { projectType: input.projectType },
        orderBy: { version: 'desc' },
        select: { version: true },
      });
      await tx.projectTaskTemplate.updateMany({
        where: { projectType: input.projectType, active: true },
        data: { active: false },
      });
      return tx.projectTaskTemplate.create({
        data: {
          projectType: input.projectType,
          name: input.name,
          version: (latest?.version ?? 0) + 1,
          active: true,
          definition: definition.data as Prisma.InputJsonValue,
        },
      });
    });
  }

  async importPlotTree(
    input: PlotTreeImportInput,
  ): Promise<PlotTreeImportSummary> {
    const validated = PlotTreeSchema.parse(input);

    const nodeCount = validated.nodes.length;
    let choiceCount = 0;
    let endingCount = 0;

    for (const node of validated.nodes) {
      if (node.type === 'choice') choiceCount++;
      else if (node.type === 'ending') endingCount++;
    }

    const definition = {
      version: 1,
      plotTree: validated,
      items: DEFAULT_INTERACTIVE_FILM_TASK_TEMPLATE.items,
    };

    const template = await this.saveAdmin({
      projectType: CrewProductionKind.interactive_film,
      name: validated.title,
      definition,
    });

    return {
      templateId: template.id,
      nodeCount,
      choiceCount,
      endingCount,
    };
  }
}
