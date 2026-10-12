import {
  admitTaskCreation,
  taskCreationTransaction,
} from '../task-requests/task-request-admission';
import { provisionTaskDeliveryFolderTx } from '../tasks/task-delivery-folder';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewProductionKind,
  CrewTaskKind,
  CrewTaskStatus,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../infra/db/db.module';
import { StoryPermissionService } from '../../story-studio/story-permission.service';
import { WorkspacePermissionService } from '../../workspaces';
import { ProjectMemberRole } from '@prisma/client';
import {
  StoryboardChildItem,
  LinkStoryboardChildInput,
  CreateStoryboardChildInput,
} from './storyboard-children.dto';
import {
  PlotTree,
  PlotTreeSchema,
} from '../templates/project-task-template.types';
import { randomUUID } from 'node:crypto';
import { CrewAuthorizationService } from '../crew-authorization.service';

@Injectable()
export class StoryboardChildrenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storyPermissions: StoryPermissionService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly authorization: CrewAuthorizationService,
  ) {}

  private async resolveCrew(
    projectId: string,
    userId: string,
  ): Promise<string> {
    // 1. Try PlatformProject
    const project = await this.prisma.platformProject.findUnique({
      where: { id: projectId },
      select: {
        studioCrew: {
          where: { deletedAt: null, studioWorkspaceId: null },
          select: { id: true },
        },
        workspace: {
          select: {
            studioCrew: {
              where: { deletedAt: null },
              select: { id: true },
            },
          },
        },
        productionCrew: {
          where: { deletedAt: null },
          select: { id: true },
        },
        crewTaskCanvas: {
          where: { deletedAt: null, crew: { deletedAt: null } },
          select: { crew: { select: { id: true } } },
        },
      },
    });

    const crewFromProject =
      project?.studioCrew?.id ??
      project?.workspace?.studioCrew?.id ??
      project?.productionCrew?.id ??
      project?.crewTaskCanvas?.crew?.id;

    if (crewFromProject) {
      await this.workspacePermissions.requireProjectRole(
        userId,
        projectId,
        ProjectMemberRole.viewer,
      );
      return crewFromProject;
    }

    // 2. Try StoryProject
    const { project: storyProject } =
      await this.storyPermissions.requireProject(
        userId,
        projectId,
        'story.read',
      );
    const crewFromStory = await this.prisma.crew.findFirst({
      where: { studioWorkspaceId: storyProject.workspaceId, deletedAt: null },
      select: { id: true },
    });

    if (crewFromStory) {
      return crewFromStory.id;
    }

    throw new NotFoundException({
      message: 'No crew found associated with the specified project.',
    });
  }

  private async resolvePlotTree(
    crewId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<PlotTree | null> {
    const plotTask = await client.crewTask.findFirst({
      where: { crewId, taskKind: CrewTaskKind.plot_tree, deletedAt: null },
      select: { metadata: true },
    });
    const metadata = plotTask?.metadata;
    if (
      metadata &&
      typeof metadata === 'object' &&
      !Array.isArray(metadata) &&
      'plotTree' in metadata
    ) {
      const snapshot = PlotTreeSchema.safeParse(metadata.plotTree);
      if (!snapshot.success) {
        throw new BadRequestException({
          message: 'The imported crew plot tree is invalid.',
        });
      }
      return snapshot.data;
    }

    const template = await client.projectTaskTemplate.findFirst({
      where: {
        projectType: CrewProductionKind.interactive_film,
        active: true,
      },
      orderBy: { version: 'desc' },
      select: { definition: true },
    });

    if (!template?.definition) return null;
    const def = template.definition as Record<string, unknown>;
    if (def.plotTree && typeof def.plotTree === 'object') {
      return def.plotTree as unknown as PlotTree;
    }
    return null;
  }

  private async resolveStoryboardTask(
    crewId: string,
    client: Prisma.TransactionClient | PrismaService = this.prisma,
  ) {
    const storyboardTask = await client.crewTask.findFirst({
      where: {
        crewId,
        deletedAt: null,
        OR: [
          {
            metadata: {
              path: ['templateKey'],
              equals: 'storyboard',
            },
          },
          { taskKind: CrewTaskKind.storyboard, parentId: { not: null } },
        ],
      },
      select: { id: true, crewId: true, workflowStateId: true },
    });

    return storyboardTask;
  }

  private async withTaskWrite<T>(
    crewId: string,
    userId: string,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
      await this.authorization.require(crewId, userId, 'tasks.manage', tx);
      const result = await write(tx);
      await this.authorization.require(crewId, userId, 'tasks.manage', tx);
      return result;
    });
  }

  private importedTask(
    tx: Prisma.TransactionClient,
    crewId: string,
    projectId: string,
    nodeId: string,
  ) {
    return tx.crewTask.findFirst({
      where: {
        crewId,
        deletedAt: null,
        taskKind: CrewTaskKind.storyboard,
        AND: [
          { metadata: { path: ['canvasTaskImport'], equals: projectId } },
          { metadata: { path: ['sourceNodeId'], equals: nodeId } },
        ],
      },
      select: { id: true },
    });
  }

  async candidates(
    projectId: string,
    userId: string,
    query: { q: string; cursor?: string },
  ) {
    const crewId = await this.resolveCrew(projectId, userId);
    await this.authorization.require(crewId, userId, 'tasks.manage');
    const parent = await this.resolveStoryboardTask(crewId);
    if (!parent)
      throw new BadRequestException('No storyboard task found in crew.');
    const excluded = new Set<string>();
    let id: string | null = parent.id;
    while (id && !excluded.has(id)) {
      excluded.add(id);
      const ancestor: { parentId: string | null } | null =
        await this.prisma.crewTask.findFirst({
          where: { id, crewId },
          select: { parentId: true },
        });
      id = ancestor?.parentId ?? null;
    }
    const rows = await this.prisma.crewTask.findMany({
      where: {
        crewId,
        deletedAt: null,
        id: {
          notIn: [...excluded],
          ...(query.cursor ? { gt: query.cursor } : {}),
        },
        ...(query.q
          ? { title: { contains: query.q, mode: 'insensitive' as const } }
          : {}),
      },
      select: { id: true, title: true, number: true, metadata: true },
      orderBy: { id: 'asc' },
      take: 51,
    });
    const page = rows.slice(0, 50);
    return {
      items: page
        .filter((row) => {
          const metadata = row.metadata;
          return (
            !metadata ||
            typeof metadata !== 'object' ||
            Array.isArray(metadata) ||
            (typeof metadata.plotTreeNodeId !== 'string' &&
              typeof metadata.canvasTaskImport !== 'string')
          );
        })
        .map(({ id, title, number }) => ({ id, title, number })),
      nextCursor: rows.length > 50 ? page[49].id : null,
    };
  }

  async list(
    projectId: string,
    userId: string,
  ): Promise<StoryboardChildItem[]> {
    const crewId = await this.resolveCrew(projectId, userId);
    await this.authorization.require(crewId, userId, 'tasks.view');
    // Canvas imports belong to a specific Story project, even when several
    // projects share a Crew workspace. Their tasks are top-level deliverables,
    // so they must not depend on the legacy template's storyboard parent.
    const imported = await this.prisma.crewTask.findMany({
      where: {
        crewId,
        taskKind: CrewTaskKind.storyboard,
        deletedAt: null,
        metadata: { path: ['canvasTaskImport'], equals: projectId },
      },
      orderBy: { number: 'asc' },
      select: {
        id: true,
        title: true,
        metadata: true,
        workflowState: { select: { semantic: true } },
      },
    });
    if (imported.length) {
      return imported.flatMap((task) => {
        const metadata = task.metadata;
        if (
          !metadata ||
          typeof metadata !== 'object' ||
          Array.isArray(metadata) ||
          typeof metadata.sourceNodeId !== 'string'
        )
          return [];
        return [
          {
            nodeId: metadata.sourceNodeId,
            nodeType: 'scene',
            title: task.title,
            taskId: task.id,
            status: task.workflowState.semantic,
          },
        ];
      });
    }
    const plotTree = await this.resolvePlotTree(crewId);
    if (!plotTree || !Array.isArray(plotTree.nodes)) {
      return [];
    }

    const storyboardTask = await this.resolveStoryboardTask(crewId);
    let childTasks: Array<{
      id: string;
      metadata: Prisma.JsonValue;
      workflowState: { semantic: string };
    }> = [];

    if (storyboardTask) {
      childTasks = await this.prisma.crewTask.findMany({
        where: {
          crewId,
          parentId: storyboardTask.id,
          deletedAt: null,
        },
        select: {
          id: true,
          metadata: true,
          workflowState: { select: { semantic: true } },
        },
      });
    }

    const taskByNodeId = new Map<string, { id: string; status: string }>();

    for (const task of childTasks) {
      const meta = task.metadata as Record<string, unknown> | null;
      if (meta && typeof meta.plotTreeNodeId === 'string') {
        taskByNodeId.set(meta.plotTreeNodeId, {
          id: task.id,
          status: task.workflowState.semantic,
        });
      }
    }

    return plotTree.nodes.map((node) => {
      const linked = taskByNodeId.get(node.id);
      const content = node.content ?? {};
      const title =
        typeof content.title === 'string' && content.title.trim()
          ? content.title.trim()
          : `${node.type}: ${node.id}`;

      return {
        nodeId: node.id,
        nodeType: node.type,
        title,
        taskId: linked?.id ?? null,
        status: linked?.status ?? null,
      };
    });
  }

  async link(
    projectId: string,
    nodeId: string,
    userId: string,
    input: LinkStoryboardChildInput,
  ): Promise<{ taskId: string }> {
    const crewId = await this.resolveCrew(projectId, userId);
    return this.withTaskWrite(crewId, userId, async (tx) => {
      const imported = await this.importedTask(tx, crewId, projectId, nodeId);
      if (imported) return { taskId: imported.id };
      const plotTree = await this.resolvePlotTree(crewId, tx);
      if (!plotTree || !Array.isArray(plotTree.nodes)) {
        throw new BadRequestException({
          message:
            'No active plot tree template configured for interactive_film.',
        });
      }

      const targetNode = plotTree.nodes.find((n) => n.id === nodeId);
      if (!targetNode) {
        throw new NotFoundException({
          message: `Plot tree node ${nodeId} not found in active template.`,
        });
      }

      const storyboardTask = await this.resolveStoryboardTask(crewId, tx);
      if (!storyboardTask) {
        throw new BadRequestException({
          message: 'No storyboard task found in crew.',
        });
      }

      // Check if a child task already linked to this nodeId
      const existingChild = await tx.crewTask.findFirst({
        where: {
          crewId,
          parentId: storyboardTask.id,
          deletedAt: null,
          metadata: {
            path: ['plotTreeNodeId'],
            equals: nodeId,
          },
        },
        select: { id: true },
      });

      if (existingChild) {
        if (existingChild.id === input.taskId) {
          return { taskId: existingChild.id };
        }
        // If linked twice to same nodeId with different taskId or re-linking
        return { taskId: existingChild.id };
      }

      // Validate the target task
      const taskToLink = await tx.crewTask.findFirst({
        where: {
          id: input.taskId,
          crewId,
          deletedAt: null,
        },
        select: { id: true, metadata: true, parentId: true },
      });

      if (!taskToLink) {
        throw new NotFoundException({
          message: 'Task not found in this crew.',
        });
      }

      let ancestorId: string | null = storyboardTask.id;
      const visited = new Set<string>();
      while (ancestorId) {
        if (ancestorId === taskToLink.id || visited.has(ancestorId)) {
          throw new ConflictException({
            message: 'Linking this task would create a task hierarchy cycle.',
          });
        }
        visited.add(ancestorId);
        const ancestor: { parentId: string | null } | null =
          await tx.crewTask.findFirst({
            where: { id: ancestorId, crewId, deletedAt: null },
            select: { parentId: true },
          });
        ancestorId = ancestor?.parentId ?? null;
      }

      // Check if task is already linked to a different nodeId
      const existingMeta = (taskToLink.metadata ?? {}) as Record<
        string,
        unknown
      >;
      if (typeof existingMeta.canvasTaskImport === 'string') {
        throw new ConflictException({
          message: 'This task is already linked to an imported canvas node.',
        });
      }
      if (
        typeof existingMeta.plotTreeNodeId === 'string' &&
        existingMeta.plotTreeNodeId !== nodeId
      ) {
        throw new ConflictException({
          message: `Task is already linked to plot node ${existingMeta.plotTreeNodeId}.`,
        });
      }

      const updatedMeta: Prisma.InputJsonObject = {
        ...(existingMeta as Prisma.InputJsonObject),
        plotTreeNodeId: nodeId,
      };

      await tx.crewTask.update({
        where: { id: taskToLink.id },
        data: {
          parentId: storyboardTask.id,
          metadata: updatedMeta,
          version: { increment: 1 },
        },
      });

      return { taskId: taskToLink.id };
    });
  }

  async create(
    projectId: string,
    nodeId: string,
    userId: string,
    input: CreateStoryboardChildInput,
  ): Promise<{ taskId: string }> {
    const crewId = await this.resolveCrew(projectId, userId);
    await admitTaskCreation(
      this.prisma,
      this.authorization,
      crewId,
      userId,
      'storyboard_child',
      { projectId, nodeId, input },
    );
    return taskCreationTransaction(this.prisma, async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
      await this.authorization.requireMembership(crewId, userId, tx);
      const imported = await this.importedTask(tx, crewId, projectId, nodeId);
      if (imported) return { taskId: imported.id };
      const plotTree = await this.resolvePlotTree(crewId, tx);
      if (!plotTree || !Array.isArray(plotTree.nodes)) {
        throw new BadRequestException({
          message:
            'No active plot tree template configured for interactive_film.',
        });
      }

      const targetNode = plotTree.nodes.find((n) => n.id === nodeId);
      if (!targetNode) {
        throw new NotFoundException({
          message: `Plot tree node ${nodeId} not found in active template.`,
        });
      }

      const storyboardTask = await this.resolveStoryboardTask(crewId, tx);
      if (!storyboardTask) {
        throw new BadRequestException({
          message: 'No storyboard task found in crew.',
        });
      }

      // Idempotency: if child task exists with metadata.plotTreeNodeId = nodeId
      const existing = await tx.crewTask.findFirst({
        where: {
          crewId,
          parentId: storyboardTask.id,
          deletedAt: null,
          metadata: {
            path: ['plotTreeNodeId'],
            equals: nodeId,
          },
        },
        select: { id: true },
      });

      if (existing) {
        return { taskId: existing.id };
      }

      // Children start open even when their parent is already completed.
      const openState = await tx.crewTaskWorkflowState.findFirst({
        where: { crewId, systemKey: CrewTaskStatus.open, archived: false },
        select: { id: true },
      });
      if (!openState) {
        throw new BadRequestException({
          message: 'No open workflow column is available in this crew.',
        });
      }
      const workflowStateId = openState.id;

      // Determine max number
      const lastTask = await tx.crewTask.findFirst({
        where: { crewId },
        orderBy: { number: 'desc' },
        select: { number: true, rank: true },
      });

      const nextNumber = (lastTask?.number ?? 0) + 1;
      const nextRank = lastTask?.rank
        ? lastTask.rank.plus(1024)
        : new Prisma.Decimal(1024);

      const nodeContent = targetNode.content ?? {};
      const defaultTitle =
        typeof nodeContent.title === 'string' && nodeContent.title.trim()
          ? nodeContent.title.trim()
          : `${targetNode.type}: ${targetNode.id}`;

      const taskTitle = input.title?.trim() || defaultTitle;

      const metadata: Prisma.InputJsonObject = {
        plotTreeNodeId: nodeId,
        nodeType: targetNode.type,
        generatedFrom: 'storyboard-plot-tree',
      };

      const created = await tx.crewTask.create({
        data: {
          id: randomUUID(),
          crewId,
          number: nextNumber,
          title: taskTitle,
          description: '',
          parentId: storyboardTask.id,
          workflowStateId,
          rank: nextRank,
          createdByUserId: userId,
          metadata,
        },
      });
      await provisionTaskDeliveryFolderTx(tx, created, userId);

      return { taskId: created.id };
    });
  }
}
