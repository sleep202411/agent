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
import { PlotTree } from '../templates/project-task-template.types';
import { randomUUID } from 'node:crypto';

@Injectable()
export class StoryboardChildrenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storyPermissions: StoryPermissionService,
    private readonly workspacePermissions: WorkspacePermissionService,
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

  private async resolvePlotTree(crewId: string): Promise<PlotTree | null> {
    const template = await this.prisma.projectTaskTemplate.findFirst({
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

  private async resolveStoryboardTask(crewId: string) {
    const storyboardTask = await this.prisma.crewTask.findFirst({
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
          { taskKind: CrewTaskKind.storyboard },
        ],
      },
      select: { id: true, crewId: true, workflowStateId: true },
    });

    return storyboardTask;
  }

  async list(
    projectId: string,
    userId: string,
  ): Promise<StoryboardChildItem[]> {
    const crewId = await this.resolveCrew(projectId, userId);
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
      const content = (node.content ?? {}) as Record<string, unknown>;
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
    const plotTree = await this.resolvePlotTree(crewId);
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

    const storyboardTask = await this.resolveStoryboardTask(crewId);
    if (!storyboardTask) {
      throw new BadRequestException({
        message: 'No storyboard task found in crew.',
      });
    }

    // Check if a child task already linked to this nodeId
    const existingChild = await this.prisma.crewTask.findFirst({
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
    const taskToLink = await this.prisma.crewTask.findFirst({
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

    // Check if task is already linked to a different nodeId
    const existingMeta = (taskToLink.metadata ?? {}) as Record<string, unknown>;
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

    await this.prisma.crewTask.update({
      where: { id: taskToLink.id },
      data: {
        parentId: storyboardTask.id,
        metadata: updatedMeta,
      },
    });

    return { taskId: taskToLink.id };
  }

  async create(
    projectId: string,
    nodeId: string,
    userId: string,
    input: CreateStoryboardChildInput,
  ): Promise<{ taskId: string }> {
    const crewId = await this.resolveCrew(projectId, userId);
    const plotTree = await this.resolvePlotTree(crewId);
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

    const storyboardTask = await this.resolveStoryboardTask(crewId);
    if (!storyboardTask) {
      throw new BadRequestException({
        message: 'No storyboard task found in crew.',
      });
    }

    // Idempotency: if child task exists with metadata.plotTreeNodeId = nodeId
    const existing = await this.prisma.crewTask.findFirst({
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

    // Determine workflow state
    let workflowStateId = storyboardTask.workflowStateId;
    if (!workflowStateId) {
      const openState = await this.prisma.crewTaskWorkflowState.findFirst({
        where: { crewId, systemKey: CrewTaskStatus.open },
        select: { id: true },
      });
      workflowStateId = openState?.id ?? '';
    }

    // Determine max number
    const lastTask = await this.prisma.crewTask.findFirst({
      where: { crewId },
      orderBy: { number: 'desc' },
      select: { number: true, rank: true },
    });

    const nextNumber = (lastTask?.number ?? 0) + 1;
    const nextRank = lastTask?.rank
      ? (lastTask.rank as Prisma.Decimal).plus(1024)
      : new Prisma.Decimal(1024);

    const nodeContent = (targetNode.content ?? {}) as Record<string, unknown>;
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

    const created = await this.prisma.crewTask.create({
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
      select: { id: true },
    });

    return { taskId: created.id };
  }
}
