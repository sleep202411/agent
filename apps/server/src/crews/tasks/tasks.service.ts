import { recordTaskContractFile } from '../assets/task-contract-retention';
import { TASK_PAYMENT_TERMS } from '@repo/shared/crew';
import { readDocumentCrdtState } from '../../documents/document-persisted-state';
import { validateTaskCustomFieldValues } from './task-custom-field-values';
import { taskAssetCategory } from './task-asset-category';
import { CloseCrewTaskSchema, type CloseCrewTaskInput } from '../dto';
import { assertRecruitedTaskAssignees } from '../task-recruitment';
import { assertDeliveryTemplateEditable } from './task-delivery-template';
import { requireAvailableTaskContractAsset } from '../assets/task-contract-retention';
import {
  overdueTaskPredicate,
  TASK_ADVANCE_WARNING_MS,
  revisionDeadline,
  taskDeadlineRisk,
} from './task-deadline';
import { isDeepStrictEqual } from 'node:util';
import {
  readTaskDeliveryTemplate,
  validateProfessionalDelivery,
  TaskDeliveryTemplateInput,
} from './task-delivery-template';
import type { z } from 'zod';
import {
  captureTaskTimelinessTx,
  recordApprovedTaskTimelinessTx,
  postApprovedTaskTrustTx,
} from './task-timeliness';
import {
  taskDeliveryFolderTx,
  provisionTaskDeliveryFolderTx,
  publishTaskDeliveryAssetsTx,
} from './task-delivery-folder';
import { assertNewCrewCurrency } from '../earnings/ledger-currency';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewAssetNodeKind,
  CrewAssetNodeStatus,
  CrewAssetPermission,
  CrewTaskFieldType,
  CrewTaskStatus,
  MediaAssetStatus,
  StudioDocumentOperationType,
  StudioDocumentStatus,
  StudioDocumentType,
  StudioDocumentVersionSource,
  Prisma,
  ProjectMemberRole,
  ProjectMemberStatus,
  StoryProductionSpecStatus,
} from '@prisma/client';
import { ConversationsService } from '../../conversations/conversations.service';
import { DocumentStateBuilder } from '../../documents/document-crdt';
import { rootSchemaFor } from '../../documents/document-modes';
import { PrismaService } from '../../infra/db/db.module';
import { NotificationService } from '../../notification';
import { CrewAuthorizationService } from '../crew-authorization.service';
import type {
  CreateCrewTaskCommentInput,
  CreateCrewTaskKindTemplateInput,
  CreateCrewTaskInput,
  ListCrewTaskTimelineQuery,
  ReviewCrewTaskInput,
  SetTaskDeliveryFolderInput,
  SubmitCrewTaskInput,
  UpdateCrewTaskInput,
  UpdateCrewTaskCommentInput,
} from '../dto';
import { availableCrewAssetName } from '../assets/asset-name';
import { CrewAssetAccessService } from '../assets/asset-access.service';
import { lockCrewAssetUploads } from '../assets/upload-lock';
import { CrewEarningsService } from '../earnings/earnings.service';
import {
  DEFAULT_CREW_TASK_WORKFLOW_STATES,
  defaultCrewTaskView,
} from './task-defaults';
import {
  CrewTaskViewFiltersSchema,
  CrewTaskViewSortSchema,
} from './project-dto';
import type {
  BatchUpdateCrewTasksInput,
  CreateCrewTaskCycleInput,
  CreateCrewTaskFieldInput,
  CreateCrewTaskLabelInput,
  CreateCrewTaskViewInput,
  CreateCrewTaskWorkflowStateInput,
  ListCrewTaskOptionsQuery,
  ListCrewTasksQuery,
  CrewTaskCenterQuery,
  ReorderCrewTaskInput,
  ReorderCrewTaskWorkflowStatesInput,
  UpdateCrewTaskCycleInput,
  UpdateCrewTaskFieldInput,
  UpdateCrewTaskLabelInput,
  UpdateCrewTaskViewInput,
  UpdateCrewTaskWorkflowStateInput,
} from './project-dto';

const taskReferenceSelect = {
  id: true,
  number: true,
  title: true,
  workflowState: true,
  parentId: true,
} satisfies Prisma.CrewTaskSelect;

const taskInclude = {
  crew: {
    select: {
      productionProjectId: true,
      ownership: {
        select: { member: { select: { userId: true } } },
      },
    },
  },
  workflowState: true,
  parent: { select: taskReferenceSelect },
  children: {
    where: { deletedAt: null },
    select: taskReferenceSelect,
    orderBy: [{ rank: 'asc' as const }, { id: 'asc' as const }],
  },
  cycle: true,
  episode: {
    select: { id: true, number: true, title: true, status: true },
  },
  labels: { include: { label: true } },
  assignees: { orderBy: { assignedAt: 'asc' as const } },
  recruitmentPositions: {
    where: {
      status: 'open' as const,
      deletedAt: null,
      moderationStatus: 'ok' as const,
    },
    select: { closeDate: true },
  },
  deliveryFolder: {
    include: {
      folder: { select: { id: true, name: true } },
    },
  },
  submissions: {
    include: {
      canvasVersion: {
        include: {
          document: { select: { collaborationDialect: true } },
        },
      },
      assets: {
        include: {
          assetNode: {
            include: { mediaAsset: true },
          },
        },
      },
    },
    orderBy: { versionNumber: 'desc' as const },
  },
  dependenciesAsBlocked: {
    where: { blockingTask: { deletedAt: null } },
    include: { blockingTask: { select: taskReferenceSelect } },
    orderBy: { createdAt: 'asc' as const },
  },
  dependenciesAsBlocker: {
    where: { blockedTask: { deletedAt: null } },
    include: { blockedTask: { select: taskReferenceSelect } },
    orderBy: { createdAt: 'asc' as const },
  },
  customFieldValues: { orderBy: { fieldId: 'asc' as const } },
} satisfies Prisma.CrewTaskInclude;

type TaskRow = Prisma.CrewTaskGetPayload<{ include: typeof taskInclude }>;
const taskCardInclude = {
  workflowState: true,
  parent: { select: taskReferenceSelect },
  children: {
    where: { deletedAt: null },
    select: taskReferenceSelect,
    orderBy: [{ rank: 'asc' as const }, { id: 'asc' as const }],
  },
  cycle: true,
  episode: {
    select: { id: true, number: true, title: true, status: true },
  },
  labels: { include: { label: true } },
  assignees: { orderBy: { assignedAt: 'asc' as const } },
  recruitmentPositions: {
    where: {
      status: 'open' as const,
      deletedAt: null,
      moderationStatus: 'ok' as const,
    },
    select: { closeDate: true },
  },
  deliveryFolder: {
    include: {
      folder: { select: { id: true, name: true } },
    },
  },
  dependenciesAsBlocked: {
    where: { blockingTask: { deletedAt: null } },
    include: { blockingTask: { select: taskReferenceSelect } },
    orderBy: { createdAt: 'asc' as const },
  },
  dependenciesAsBlocker: {
    where: { blockedTask: { deletedAt: null } },
    include: { blockedTask: { select: taskReferenceSelect } },
    orderBy: { createdAt: 'asc' as const },
  },
  customFieldValues: { orderBy: { fieldId: 'asc' as const } },
} satisfies Prisma.CrewTaskInclude;
type TaskCardRow = Prisma.CrewTaskGetPayload<{
  include: typeof taskCardInclude;
}>;
const timelineInclude = {
  attachments: {
    orderBy: { position: 'asc' as const },
    include: {
      assetNode: {
        include: { mediaAsset: true },
      },
    },
  },
  replyTo: {
    select: {
      id: true,
      kind: true,
      actorUserId: true,
      body: true,
      deletedAt: true,
    },
  },
} satisfies Prisma.CrewTaskTimelineItemInclude;
type TimelineRow = Prisma.CrewTaskTimelineItemGetPayload<{
  include: typeof timelineInclude;
}>;
const activityInclude = {
  ...timelineInclude,
  task: { select: { id: true, number: true, title: true } },
} satisfies Prisma.CrewTaskTimelineItemInclude;
type ActivityRow = Prisma.CrewTaskTimelineItemGetPayload<{
  include: typeof activityInclude;
}>;
const ACCEPTING_TASK_STATUSES = new Set<CrewTaskStatus>([
  CrewTaskStatus.open,
  CrewTaskStatus.in_progress,
  CrewTaskStatus.revision_requested,
]);
const MANUALLY_MOVABLE_TASK_STATUSES = new Set<CrewTaskStatus>([
  CrewTaskStatus.open,
  CrewTaskStatus.in_progress,
  CrewTaskStatus.revision_requested,
]);
const MAX_ACTIVE_WORKFLOW_STATES = 24;

@Injectable()
export class CrewTasksService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly assetAccess: CrewAssetAccessService,
    private readonly notifications: NotificationService,
    private readonly conversations: ConversationsService,
    private readonly earnings: CrewEarningsService,
  ) {}

  async getProject(crewId: string, userId: string) {
    await this.authorization.require(crewId, userId, 'tasks.view');
    await Promise.all([
      this.ensureDefaultViews(crewId, userId),
      this.ensureDefaultWorkflowStates(crewId, userId),
    ]);
    const [views, cycles, labels, fields, workflowStates] = await Promise.all([
      this.prisma.crewTaskView.findMany({
        where: { crewId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.crewTaskCycle.findMany({
        where: { crewId },
        orderBy: [{ startAt: 'desc' }, { number: 'desc' }],
      }),
      this.prisma.crewTaskLabel.findMany({
        where: { crewId },
        orderBy: [{ name: 'asc' }],
      }),
      this.prisma.crewTaskFieldDefinition.findMany({
        where: { crewId },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      }),
      this.prisma.crewTaskWorkflowState.findMany({
        where: { crewId },
        include: {
          _count: { select: { tasks: { where: { deletedAt: null } } } },
        },
        orderBy: [
          { archived: 'asc' },
          { position: 'asc' },
          { createdAt: 'asc' },
        ],
      }),
    ]);
    return {
      views: views.map(taskViewDto),
      cycles: cycles.map(taskCycleDto),
      labels: labels.map(taskLabelDto),
      fields: fields.map(taskFieldDto),
      workflowStates: workflowStates.map(taskWorkflowStateDto),
    };
  }

  private async requireActiveTaskTx(
    tx: Prisma.TransactionClient,
    taskId: string,
  ): Promise<TaskRow> {
    try {
      return await tx.crewTask.findUniqueOrThrow({
        where: { id: taskId, deletedAt: null },
        include: taskInclude,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Task not found.');
      }
      throw error;
    }
  }

  private async lockTaskWrites(tx: Prisma.TransactionClient, crewId: string) {
    // Always acquired before operation-specific locks, including review/reward posting.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:task-writes:${crewId}`}, 0))`;
  }

  private async authorizedTaskWrite<T>(
    crewId: string,
    authorize: (tx: Prisma.TransactionClient) => Promise<void>,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTaskWrites(tx, crewId);
      await authorize(tx);
      const result = await write(tx);
      await authorize(tx);
      return result;
    });
  }

  private async manageTaskWrite<T>(
    crewId: string,
    userId: string,
    write: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      await this.lockTaskWrites(tx, crewId);
      await this.authorization.require(crewId, userId, 'tasks.manage', tx);
      const result = await write(tx);
      // Any row wait in the operation may outlive the initiating permission.
      await this.authorization.require(crewId, userId, 'tasks.manage', tx);
      return result;
    });
  }

  async delete(
    taskId: string,
    userId: string,
    expectedVersion: number,
  ): Promise<void> {
    const current = await this.requireTask(taskId);
    await this.authorization.require(current.crewId, userId, 'tasks.manage');
    const affected = await this.manageTaskWrite(
      current.crewId,
      userId,
      async (tx) => {
        await this.lockTaskWrites(tx, current.crewId);
        await this.authorization.require(
          current.crewId,
          userId,
          'tasks.manage',
          tx,
        );
        const task = await tx.crewTask.findUnique({
          where: { id: taskId, deletedAt: null },
        });
        if (!task) throw new NotFoundException('Task not found.');
        if (task.version !== expectedVersion) {
          throw new ConflictException({
            code: 'CREW_TASK_VERSION_CONFLICT',
            message: 'This task changed. Refresh before deleting it.',
          });
        }
        let parentId: string | null = null;
        let cursor = task.parentId;
        const visited = new Set([taskId]);
        while (cursor) {
          if (visited.has(cursor))
            throw new ConflictException('Task hierarchy contains a cycle.');
          visited.add(cursor);
          const parent = await tx.crewTask.findFirst({
            where: { id: cursor, crewId: task.crewId },
          });
          if (!parent)
            throw new ConflictException(
              'Task hierarchy contains a missing parent.',
            );
          if (!parent.deletedAt && parentId === null) parentId = parent.id;
          cursor = parent.parentId;
        }
        const children = await tx.crewTask.findMany({
          where: { crewId: task.crewId, parentId: taskId, deletedAt: null },
          select: { id: true },
        });
        for (const child of children) {
          await this.assertTaskStructure(
            tx,
            task.crewId,
            child.id,
            parentId,
            [],
          );
          await tx.crewTask.update({
            where: { id: child.id },
            data: { parentId, version: { increment: 1 } },
          });
          await this.writeActivity(tx, child.id, 'task.reparented', userId, {
            previousParentId: taskId,
            parentId,
            reason: 'parent_deleted',
          });
        }
        // Edges are retained as evidence; active relation queries exclude deleted endpoints.
        const edges = await tx.crewTaskDependency.findMany({
          where: {
            crewId: task.crewId,
            OR: [{ blockingTaskId: taskId }, { blockedTaskId: taskId }],
          },
        });
        const affectedIds = [
          ...new Set(
            edges.flatMap((edge) => [edge.blockedTaskId, edge.blockingTaskId]),
          ),
        ].filter((id) => id !== taskId);
        if (affectedIds.length)
          await tx.crewTask.updateMany({
            where: { id: { in: affectedIds }, deletedAt: null },
            data: { version: { increment: 1 } },
          });
        await tx.crewTask.update({
          where: { id: taskId, version: expectedVersion, deletedAt: null },
          data: {
            deletedAt: new Date(),
            deletedByUserId: userId,
            version: { increment: 1 },
          },
        });
        await this.writeActivity(tx, taskId, 'task.deleted', userId, {
          previousParentId: task.parentId,
          childIds: children.map((child) => child.id),
          newParentId: parentId,
          affectedDependencyTaskIds: affectedIds,
        });
        return [
          ...new Set([
            taskId,
            ...children.map((child) => child.id),
            ...affectedIds,
            ...(parentId ? [parentId] : []),
          ]),
        ];
      },
    );
    await Promise.all(
      affected.map((id) =>
        this.conversations.broadcastCrewTaskChange(
          current.crewId,
          id,
          'updated',
          userId,
        ),
      ),
    );
  }

  async createView(
    crewId: string,
    userId: string,
    input: CreateCrewTaskViewInput,
  ) {
    await this.authorization.require(crewId, userId, 'tasks.manage');
    const last = await this.prisma.crewTaskView.aggregate({
      where: { crewId },
      _max: { position: true },
    });
    const view = await this.manageTaskWrite(crewId, userId, (tx) =>
      tx.crewTaskView.create({
        data: {
          crewId,
          name: input.name,
          layout: input.layout,
          groupBy: input.groupBy === 'none' ? null : input.groupBy,
          filters: input.filters,
          sorts: input.sorts,
          visibleFields: input.visibleFields,
          completedMode: input.completedMode,
          showSubIssues: input.showSubIssues,
          showEmptyGroups: input.showEmptyGroups,
          position: (last._max.position ?? -1) + 1,
          createdByUserId: userId,
        },
      }),
    );
    await this.conversations.broadcastCrewTaskProjectChange(
      crewId,
      'view',
      view.id,
      'created',
      userId,
    );
    return taskViewDto(view);
  }

  async updateView(
    viewId: string,
    userId: string,
    input: UpdateCrewTaskViewInput,
  ) {
    const current = await this.prisma.crewTaskView.findUnique({
      where: { id: viewId },
    });
    if (!current) throw new NotFoundException('Task view not found.');
    await this.authorization.require(current.crewId, userId, 'tasks.manage');
    const result = await this.manageTaskWrite(current.crewId, userId, (tx) =>
      tx.crewTaskView.updateMany({
        where: {
          id: viewId,
          updatedAt: new Date(input.expectedUpdatedAt),
        },
        data: {
          name: input.name,
          layout: input.layout,
          groupBy:
            input.groupBy === undefined
              ? undefined
              : input.groupBy === 'none'
                ? null
                : input.groupBy,
          filters: input.filters,
          sorts: input.sorts,
          visibleFields: input.visibleFields,
          completedMode: input.completedMode,
          showSubIssues: input.showSubIssues,
          showEmptyGroups: input.showEmptyGroups,
        },
      }),
    );
    if (result.count !== 1) {
      throw new ConflictException({
        code: 'CREW_TASK_VIEW_CONFLICT',
        message:
          'This view changed while you were editing it. Reload its latest configuration.',
      });
    }
    const view = await this.prisma.crewTaskView.findUniqueOrThrow({
      where: { id: viewId },
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'view',
      viewId,
      'updated',
      userId,
    );
    return taskViewDto(view);
  }

  async deleteView(viewId: string, userId: string) {
    const view = await this.prisma.crewTaskView.findUnique({
      where: { id: viewId },
    });
    if (!view) throw new NotFoundException('Task view not found.');
    await this.authorization.require(view.crewId, userId, 'tasks.manage');
    if (view.isSystem) {
      throw new ConflictException({
        message: 'Built-in planning views cannot be deleted.',
      });
    }
    await this.manageTaskWrite(view.crewId, userId, (tx) =>
      tx.crewTaskView.delete({ where: { id: viewId } }),
    );
    await this.conversations.broadcastCrewTaskProjectChange(
      view.crewId,
      'view',
      viewId,
      'deleted',
      userId,
    );
  }

  async createWorkflowState(
    crewId: string,
    userId: string,
    input: CreateCrewTaskWorkflowStateInput,
  ) {
    await this.authorization.require(crewId, userId, 'tasks.manage');
    await this.ensureDefaultWorkflowStates(crewId, userId);
    const state = await this.manageTaskWrite(crewId, userId, async (tx) => {
      await this.lockTaskWrites(tx, crewId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-workflow:${crewId}`})::bigint)
      `;
      const [activeCount, duplicate, afterState, last] = [
        await tx.crewTaskWorkflowState.count({
          where: { crewId, archived: false },
        }),
        await tx.crewTaskWorkflowState.findFirst({
          where: {
            crewId,
            name: { equals: input.name, mode: 'insensitive' },
          },
          select: { id: true },
        }),
        await (input.afterStateId
          ? tx.crewTaskWorkflowState.findFirst({
              where: {
                id: input.afterStateId,
                crewId,
                archived: false,
              },
            })
          : null),
        await tx.crewTaskWorkflowState.aggregate({
          where: { crewId, archived: false },
          _max: { position: true },
        }),
      ];
      if (activeCount >= MAX_ACTIVE_WORKFLOW_STATES) {
        throw new ConflictException({
          code: 'CREW_TASK_WORKFLOW_LIMIT',
          message: `A task workflow can contain up to ${MAX_ACTIVE_WORKFLOW_STATES} active columns.`,
        });
      }
      if (duplicate) {
        throw new ConflictException({
          code: 'CREW_TASK_WORKFLOW_NAME_CONFLICT',
          message: 'A workflow column with this name already exists.',
        });
      }
      if (input.afterStateId && !afterState) {
        throw new ConflictException({
          code: 'CREW_TASK_WORKFLOW_ORDER_CONFLICT',
          message:
            'The column used as the insertion point is no longer available.',
        });
      }
      const position = afterState
        ? afterState.position + 1
        : (last._max.position ?? -1) + 1;
      if (afterState) {
        await tx.crewTaskWorkflowState.updateMany({
          where: { crewId, archived: false, position: { gte: position } },
          data: { position: { increment: 1 }, version: { increment: 1 } },
        });
      }
      return tx.crewTaskWorkflowState.create({
        data: {
          crewId,
          name: input.name,
          color: input.color.toUpperCase(),
          semantic: input.semantic,
          position,
          createdByUserId: userId,
        },
      });
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      crewId,
      'workflow',
      state.id,
      'created',
      userId,
    );
    return taskWorkflowStateDto(state);
  }

  async updateWorkflowState(
    stateId: string,
    userId: string,
    input: UpdateCrewTaskWorkflowStateInput,
  ) {
    const current = await this.prisma.crewTaskWorkflowState.findUnique({
      where: { id: stateId },
    });
    if (!current)
      throw new NotFoundException('Task workflow column not found.');
    await this.authorization.require(current.crewId, userId, 'tasks.manage');
    const state = await this.manageTaskWrite(
      current.crewId,
      userId,
      async (tx) => {
        await this.lockTaskWrites(tx, current.crewId);
        await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-workflow:${current.crewId}`})::bigint)
      `;
        const locked = await tx.crewTaskWorkflowState.findUniqueOrThrow({
          where: { id: stateId },
        });
        if (locked.version !== input.expectedVersion) {
          throw new ConflictException({
            code: 'CREW_TASK_WORKFLOW_CONFLICT',
            message: 'This workflow column changed while you were editing it.',
            expectedVersion: input.expectedVersion,
            currentVersion: locked.version,
          });
        }
        if (
          input.name &&
          input.name.toLowerCase() !== locked.name.toLowerCase()
        ) {
          const duplicate = await tx.crewTaskWorkflowState.findFirst({
            where: {
              crewId: locked.crewId,
              id: { not: stateId },
              name: { equals: input.name, mode: 'insensitive' },
            },
            select: { id: true },
          });
          if (duplicate) {
            throw new ConflictException({
              code: 'CREW_TASK_WORKFLOW_NAME_CONFLICT',
              message: 'A workflow column with this name already exists.',
            });
          }
        }
        if (input.archived === true && !locked.archived) {
          const activeCount = await tx.crewTaskWorkflowState.count({
            where: { crewId: locked.crewId, archived: false },
          });
          if (activeCount <= 1) {
            throw new ConflictException({
              message: 'A workflow must keep at least one active column.',
            });
          }
          const taskCount = await tx.crewTask.count({
            where: { deletedAt: null, workflowStateId: stateId },
          });
          if (taskCount > 0) {
            if (!input.replacementStateId) {
              throw new ConflictException({
                code: 'CREW_TASK_WORKFLOW_STATE_IN_USE',
                message:
                  'Choose another column for existing tasks before archiving this column.',
                taskCount,
              });
            }
            if (input.replacementStateId === stateId) {
              throw new BadRequestException({
                message: 'The replacement must be a different workflow column.',
              });
            }
            const replacement = await tx.crewTaskWorkflowState.findFirst({
              where: {
                id: input.replacementStateId,
                crewId: locked.crewId,
                archived: false,
              },
            });
            if (!replacement) {
              throw new BadRequestException({
                message: 'The replacement workflow column is unavailable.',
              });
            }
            if (replacement.semantic !== locked.semantic) {
              throw new ConflictException({
                code: 'CREW_TASK_WORKFLOW_SEMANTIC_MISMATCH',
                message:
                  'Existing tasks can only be moved to a column with the same workflow behavior.',
              });
            }
            await tx.crewTask.updateMany({
              where: { deletedAt: null, workflowStateId: stateId },
              data: {
                workflowStateId: replacement.id,
                version: { increment: 1 },
              },
            });
          }
        }
        if (input.archived === false && locked.archived) {
          const activeCount = await tx.crewTaskWorkflowState.count({
            where: { crewId: locked.crewId, archived: false },
          });
          if (activeCount >= MAX_ACTIVE_WORKFLOW_STATES) {
            throw new ConflictException({
              code: 'CREW_TASK_WORKFLOW_LIMIT',
              message: `A task workflow can contain up to ${MAX_ACTIVE_WORKFLOW_STATES} active columns.`,
            });
          }
        }
        const restoredPosition =
          input.archived === false && locked.archived
            ? ((
                await tx.crewTaskWorkflowState.aggregate({
                  where: { crewId: locked.crewId, archived: false },
                  _max: { position: true },
                })
              )._max.position ?? -1)
            : undefined;
        const updated = await tx.crewTaskWorkflowState.update({
          where: { id: stateId },
          data: {
            name: input.name,
            color: input.color?.toUpperCase(),
            archived: input.archived,
            position:
              restoredPosition === undefined ? undefined : restoredPosition + 1,
            version: { increment: 1 },
          },
        });
        if (input.archived === true && !locked.archived) {
          await tx.crewTaskWorkflowState.updateMany({
            where: {
              crewId: locked.crewId,
              archived: false,
              position: { gt: locked.position },
            },
            data: { position: { decrement: 1 }, version: { increment: 1 } },
          });
        }
        return updated;
      },
    );
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'workflow',
      stateId,
      'updated',
      userId,
    );
    return taskWorkflowStateDto(state);
  }

  async reorderWorkflowStates(
    crewId: string,
    userId: string,
    input: ReorderCrewTaskWorkflowStatesInput,
  ) {
    await this.authorization.require(crewId, userId, 'tasks.manage');
    const states = await this.manageTaskWrite(crewId, userId, async (tx) => {
      await this.lockTaskWrites(tx, crewId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-workflow:${crewId}`})::bigint)
      `;
      const current = await tx.crewTaskWorkflowState.findMany({
        where: { crewId, archived: false },
        orderBy: [{ position: 'asc' }, { createdAt: 'asc' }],
      });
      if (
        current.length !== input.states.length ||
        new Set(current.map((state) => state.id)).size !==
          input.states.length ||
        input.states.some(
          (requested) =>
            !current.some(
              (state) =>
                state.id === requested.id &&
                state.version === requested.expectedVersion,
            ),
        )
      ) {
        throw new ConflictException({
          code: 'CREW_TASK_WORKFLOW_ORDER_CONFLICT',
          message:
            'The workflow changed while it was being reordered. Reload the latest columns.',
        });
      }
      for (const [position, requested] of input.states.entries()) {
        await tx.crewTaskWorkflowState.update({
          where: { id: requested.id },
          data: { position, version: { increment: 1 } },
        });
      }
      return tx.crewTaskWorkflowState.findMany({
        where: { crewId },
        orderBy: [
          { archived: 'asc' },
          { position: 'asc' },
          { createdAt: 'asc' },
        ],
      });
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      crewId,
      'workflow',
      crewId,
      'reordered',
      userId,
    );
    return states.map(taskWorkflowStateDto);
  }

  async deleteWorkflowState(stateId: string, userId: string) {
    const current = await this.prisma.crewTaskWorkflowState.findUnique({
      where: { id: stateId },
    });
    if (!current)
      throw new NotFoundException('Task workflow column not found.');
    await this.authorization.require(current.crewId, userId, 'tasks.manage');
    await this.manageTaskWrite(current.crewId, userId, async (tx) => {
      await this.lockTaskWrites(tx, current.crewId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-workflow:${current.crewId}`})::bigint)
      `;
      const locked = await tx.crewTaskWorkflowState.findUniqueOrThrow({
        where: { id: stateId },
      });
      if (locked.systemKey) {
        throw new ConflictException({
          message:
            'Built-in workflow columns can be renamed or archived, but not permanently deleted.',
        });
      }
      if (!locked.archived) {
        throw new ConflictException({
          message:
            'Archive a custom workflow column before permanently deleting it.',
        });
      }
      const taskCount = await tx.crewTask.count({
        where: { workflowStateId: stateId },
      });
      if (taskCount > 0) {
        throw new ConflictException({
          code: 'CREW_TASK_WORKFLOW_STATE_IN_USE',
          message:
            'Move existing tasks to another column before deleting this workflow column.',
          taskCount,
        });
      }
      const views = await tx.crewTaskView.findMany({
        where: { crewId: current.crewId },
        select: { id: true, filters: true },
      });
      for (const view of views) {
        const filters = CrewTaskViewFiltersSchema.parse(view.filters);
        if (!filters.workflowStateIds?.includes(stateId)) continue;
        await tx.crewTaskView.update({
          where: { id: view.id },
          data: {
            filters: {
              ...filters,
              workflowStateIds: filters.workflowStateIds.filter(
                (id) => id !== stateId,
              ),
            },
          },
        });
      }
      await tx.crewTaskWorkflowState.delete({ where: { id: stateId } });
      await tx.crewTaskWorkflowState.updateMany({
        where: {
          crewId: current.crewId,
          archived: locked.archived,
          position: { gt: locked.position },
        },
        data: { position: { decrement: 1 }, version: { increment: 1 } },
      });
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'workflow',
      stateId,
      'deleted',
      userId,
    );
  }

  async createCycle(
    crewId: string,
    userId: string,
    input: CreateCrewTaskCycleInput,
  ) {
    await this.authorization.require(crewId, userId, 'tasks.manage');
    const cycle = await this.manageTaskWrite(crewId, userId, async (tx) => {
      await this.lockTaskWrites(tx, crewId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-cycle:${crewId}`})::bigint)
      `;
      const last = await tx.crewTaskCycle.aggregate({
        where: { crewId },
        _max: { number: true },
      });
      return tx.crewTaskCycle.create({
        data: {
          crewId,
          number: (last._max.number ?? 0) + 1,
          name: input.name,
          goal: input.goal,
          startAt: new Date(input.startAt),
          endAt: new Date(input.endAt),
          createdByUserId: userId,
        },
      });
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      crewId,
      'cycle',
      cycle.id,
      'created',
      userId,
    );
    return taskCycleDto(cycle);
  }

  async updateCycle(
    cycleId: string,
    userId: string,
    input: UpdateCrewTaskCycleInput,
  ) {
    const current = await this.prisma.crewTaskCycle.findUnique({
      where: { id: cycleId },
    });
    if (!current) throw new NotFoundException('Task cycle not found.');
    await this.authorization.require(current.crewId, userId, 'tasks.manage');
    const cycle = await this.manageTaskWrite(
      current.crewId,
      userId,
      async (tx) => {
        await this.lockTaskWrites(tx, current.crewId);
        await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-cycle:${current.crewId}`})::bigint)
      `;
        const locked = await tx.crewTaskCycle.findUniqueOrThrow({
          where: { id: cycleId },
        });
        if (
          locked.updatedAt.getTime() !==
          new Date(input.expectedUpdatedAt).getTime()
        ) {
          throw new ConflictException({
            code: 'CREW_TASK_CYCLE_CONFLICT',
            message:
              'This production cycle changed while you were editing it. Reload the latest settings.',
          });
        }
        const startAt = input.startAt
          ? new Date(input.startAt)
          : locked.startAt;
        const endAt = input.endAt ? new Date(input.endAt) : locked.endAt;
        if (endAt <= startAt) {
          throw new BadRequestException({
            message: 'Cycle end must be after its start.',
          });
        }
        if (input.status === 'active') {
          const another = await tx.crewTaskCycle.findFirst({
            where: {
              crewId: locked.crewId,
              status: 'active',
              id: { not: cycleId },
            },
            select: { id: true, name: true },
          });
          if (another) {
            throw new ConflictException({
              message: `Complete the active cycle "${another.name}" before starting another.`,
            });
          }
        }
        return tx.crewTaskCycle.update({
          where: { id: cycleId },
          data: {
            name: input.name,
            goal: input.goal,
            status: input.status,
            startAt: input.startAt ? startAt : undefined,
            endAt: input.endAt ? endAt : undefined,
          },
        });
      },
    );
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'cycle',
      cycle.id,
      'updated',
      userId,
    );
    return taskCycleDto(cycle);
  }

  async deleteCycle(cycleId: string, userId: string) {
    const current = await this.prisma.crewTaskCycle.findUnique({
      where: { id: cycleId },
    });
    if (!current) throw new NotFoundException('Task cycle not found.');
    await this.authorization.require(current.crewId, userId, 'tasks.manage');

    await this.manageTaskWrite(current.crewId, userId, async (tx) => {
      await this.lockTaskWrites(tx, current.crewId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-cycle:${current.crewId}`})::bigint)
      `;
      const views = await tx.crewTaskView.findMany({
        where: { crewId: current.crewId },
        select: { id: true, filters: true },
      });
      for (const view of views) {
        const parsed = CrewTaskViewFiltersSchema.parse(view.filters);
        if (!parsed.cycleIds?.includes(cycleId)) continue;
        await tx.crewTaskView.update({
          where: { id: view.id },
          data: {
            filters: {
              ...parsed,
              cycleIds: parsed.cycleIds.filter((id) => id !== cycleId),
            },
          },
        });
      }
      await tx.crewTask.updateMany({
        where: { cycleId },
        data: { cycleId: null, version: { increment: 1 } },
      });
      await tx.crewTaskCycle.delete({ where: { id: cycleId } });
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'cycle',
      cycleId,
      'deleted',
      userId,
    );
  }

  async createLabel(
    crewId: string,
    userId: string,
    input: CreateCrewTaskLabelInput,
  ) {
    await this.authorization.require(crewId, userId, 'tasks.manage');
    try {
      const label = await this.manageTaskWrite(crewId, userId, (tx) =>
        tx.crewTaskLabel.create({
          data: {
            crewId,
            name: input.name,
            color: input.color.toLowerCase(),
            description: input.description,
            createdByUserId: userId,
          },
        }),
      );
      await this.conversations.broadcastCrewTaskProjectChange(
        crewId,
        'label',
        label.id,
        'created',
        userId,
      );
      return taskLabelDto(label);
    } catch (error) {
      throw mapTaskLabelWriteError(error);
    }
  }

  async updateLabel(
    labelId: string,
    userId: string,
    input: UpdateCrewTaskLabelInput,
  ) {
    const current = await this.prisma.crewTaskLabel.findUnique({
      where: { id: labelId },
    });
    if (!current) throw new NotFoundException('Task label not found.');
    await this.authorization.require(current.crewId, userId, 'tasks.manage');

    let result: { count: number };
    try {
      result = await this.manageTaskWrite(current.crewId, userId, (tx) =>
        tx.crewTaskLabel.updateMany({
          where: {
            id: labelId,
            updatedAt: new Date(input.expectedUpdatedAt),
          },
          data: {
            name: input.name,
            color: input.color?.toLowerCase(),
            description: input.description,
          },
        }),
      );
    } catch (error) {
      throw mapTaskLabelWriteError(error);
    }
    if (result.count !== 1) {
      throw new ConflictException({
        code: 'CREW_TASK_LABEL_CONFLICT',
        message:
          'This task label changed while you were editing it. Reload the latest settings.',
      });
    }
    const label = await this.prisma.crewTaskLabel.findUniqueOrThrow({
      where: { id: labelId },
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'label',
      labelId,
      'updated',
      userId,
    );
    return taskLabelDto(label);
  }

  async deleteLabel(labelId: string, userId: string) {
    const current = await this.prisma.crewTaskLabel.findUnique({
      where: { id: labelId },
    });
    if (!current) throw new NotFoundException('Task label not found.');
    await this.authorization.require(current.crewId, userId, 'tasks.manage');
    await this.manageTaskWrite(current.crewId, userId, async (tx) => {
      const views = await tx.crewTaskView.findMany({
        where: { crewId: current.crewId },
        select: { id: true, filters: true },
      });
      for (const view of views) {
        const filters = CrewTaskViewFiltersSchema.parse(view.filters);
        if (!filters.labelIds?.includes(labelId)) continue;
        await tx.crewTaskView.update({
          where: { id: view.id },
          data: {
            filters: {
              ...filters,
              labelIds: filters.labelIds.filter((id) => id !== labelId),
            },
          },
        });
      }
      await tx.crewTaskLabel.delete({ where: { id: labelId } });
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'label',
      labelId,
      'deleted',
      userId,
    );
  }

  async createField(
    crewId: string,
    userId: string,
    input: CreateCrewTaskFieldInput,
  ) {
    await this.authorization.require(crewId, userId, 'tasks.manage');
    const last = await this.prisma.crewTaskFieldDefinition.aggregate({
      where: { crewId },
      _max: { position: true },
    });
    const field = await this.manageTaskWrite(crewId, userId, (tx) =>
      tx.crewTaskFieldDefinition.create({
        data: {
          crewId,
          name: input.name,
          description: input.description,
          type: input.type,
          options: input.options,
          required: input.required,
          position: (last._max.position ?? -1) + 1,
          createdByUserId: userId,
        },
      }),
    );
    await this.conversations.broadcastCrewTaskProjectChange(
      crewId,
      'field',
      field.id,
      'created',
      userId,
    );
    return taskFieldDto(field);
  }

  async updateField(
    fieldId: string,
    userId: string,
    input: UpdateCrewTaskFieldInput,
  ) {
    const current = await this.prisma.crewTaskFieldDefinition.findUnique({
      where: { id: fieldId },
    });
    if (!current) throw new NotFoundException('Custom field not found.');
    await this.authorization.require(current.crewId, userId, 'tasks.manage');
    if (
      input.options &&
      current.type !== CrewTaskFieldType.single_select &&
      current.type !== CrewTaskFieldType.multi_select
    ) {
      throw new BadRequestException({
        message: 'Only select fields can define options.',
      });
    }
    const result = await this.manageTaskWrite(
      current.crewId,
      userId,
      async (tx) => {
        if (input.options) {
          const allowed = new Set(input.options.map((option) => option.id));
          const values = await tx.crewTaskFieldValue.findMany({
            where: { fieldId },
            select: { value: true },
          });
          const used = new Set(
            values.flatMap((row) =>
              Array.isArray(row.value)
                ? row.value.filter(
                    (value): value is string => typeof value === 'string',
                  )
                : typeof row.value === 'string'
                  ? [row.value]
                  : [],
            ),
          );
          const removedInUse = [...used].filter(
            (optionId) => !allowed.has(optionId),
          );
          if (removedInUse.length > 0) {
            throw new ConflictException({
              code: 'CREW_TASK_FIELD_OPTION_IN_USE',
              message:
                'Clear or replace values that use an option before deleting that option.',
              optionIds: removedInUse,
            });
          }
        }
        return tx.crewTaskFieldDefinition.updateMany({
          where: { id: fieldId, updatedAt: new Date(input.expectedUpdatedAt) },
          data: {
            name: input.name,
            description: input.description,
            options: input.options,
            required: input.required,
          },
        });
      },
    );
    if (result.count !== 1) {
      throw new ConflictException({
        code: 'CREW_TASK_FIELD_CONFLICT',
        message:
          'This custom field changed while you were editing it. Reload the latest settings.',
      });
    }
    const field = await this.prisma.crewTaskFieldDefinition.findUniqueOrThrow({
      where: { id: fieldId },
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'field',
      fieldId,
      'updated',
      userId,
    );
    return taskFieldDto(field);
  }

  async deleteField(fieldId: string, userId: string) {
    const current = await this.prisma.crewTaskFieldDefinition.findUnique({
      where: { id: fieldId },
    });
    if (!current) throw new NotFoundException('Custom field not found.');
    await this.authorization.require(current.crewId, userId, 'tasks.manage');
    await this.manageTaskWrite(current.crewId, userId, (tx) =>
      tx.crewTaskFieldDefinition.delete({
        where: { id: fieldId },
      }),
    );
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'field',
      fieldId,
      'deleted',
      userId,
    );
  }

  async batchUpdate(
    crewId: string,
    userId: string,
    input: BatchUpdateCrewTasksInput,
  ) {
    await this.authorization.require(crewId, userId, 'tasks.manage');
    const taskIds = [...new Set(input.taskIds)];
    if (taskIds.length !== input.taskIds.length) {
      throw new BadRequestException({ message: 'Task ids must be unique.' });
    }
    await this.manageTaskWrite(crewId, userId, async (tx) => {
      await this.lockTaskWrites(tx, crewId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-batch:${crewId}`})::bigint)
      `;
      const count = await tx.crewTask.count({
        where: { deletedAt: null, crewId, id: { in: taskIds } },
      });
      if (count !== taskIds.length) {
        throw new BadRequestException({
          message: 'Every selected task must belong to this crew.',
        });
      }
      await this.assertPlanningReferences(tx, crewId, input.cycleId, [
        ...(input.addLabelIds ?? []),
        ...(input.removeLabelIds ?? []),
      ]);
      await tx.crewTask.updateMany({
        where: { deletedAt: null, crewId, id: { in: taskIds } },
        data: {
          priority: input.priority,
          cycleId: input.cycleId,
          version: { increment: 1 },
        },
      });
      if (input.removeLabelIds?.length) {
        await tx.crewTaskLabelAssignment.deleteMany({
          where: {
            taskId: { in: taskIds },
            labelId: { in: input.removeLabelIds },
          },
        });
      }
      if (input.addLabelIds?.length) {
        await tx.crewTaskLabelAssignment.createMany({
          data: taskIds.flatMap((taskId) =>
            input.addLabelIds!.map((labelId) => ({ crewId, taskId, labelId })),
          ),
          skipDuplicates: true,
        });
      }
    });
    const tasks = await this.prisma.crewTask.findMany({
      where: { deletedAt: null, crewId, id: { in: taskIds } },
      include: taskInclude,
      orderBy: [{ rank: 'asc' }, { id: 'asc' }],
    });
    await Promise.all(
      tasks.map((task) =>
        this.conversations.broadcastCrewTaskChange(
          crewId,
          task.id,
          'updated',
          userId,
        ),
      ),
    );
    return Promise.all(tasks.map((task) => this.toDtoWithUsage(task)));
  }

  async reorder(taskId: string, userId: string, input: ReorderCrewTaskInput) {
    const current = await this.requireTask(taskId);
    await this.authorization.require(current.crewId, userId, 'tasks.manage');
    if (
      current.workflowState.semantic === CrewTaskStatus.submitted ||
      current.workflowState.semantic === CrewTaskStatus.approved ||
      current.workflowState.semantic === CrewTaskStatus.cancelled
    ) {
      throw new ConflictException({
        message:
          'Review, completed, and cancelled work must use their workflow actions.',
      });
    }
    const updated = await this.manageTaskWrite(
      current.crewId,
      userId,
      async (tx) => {
        await this.lockTaskWrites(tx, current.crewId);
        await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-rank:${current.crewId}`})::bigint)
      `;
        const locked = await tx.crewTask.findUniqueOrThrow({
          where: { deletedAt: null, id: taskId },
          include: taskCardInclude,
        });
        if (locked.version !== input.expectedVersion) {
          throw new ConflictException({
            code: 'CREW_TASK_VERSION_CONFLICT',
            message: 'This task changed before it could be moved.',
            expectedVersion: input.expectedVersion,
            currentVersion: locked.version,
          });
        }
        await this.assertPlanningReferences(
          tx,
          locked.crewId,
          input.cycleId,
          [],
        );
        const targetWorkflowState = input.workflowStateId
          ? await tx.crewTaskWorkflowState.findFirst({
              where: {
                id: input.workflowStateId,
                crewId: locked.crewId,
                archived: false,
              },
            })
          : locked.workflowState;
        if (!targetWorkflowState) {
          throw new BadRequestException({
            message: 'The destination workflow column is unavailable.',
          });
        }
        if (!MANUALLY_MOVABLE_TASK_STATUSES.has(targetWorkflowState.semantic)) {
          throw new ConflictException({
            message:
              'Review, completed, and cancelled workflow columns can only be entered through their workflow actions.',
          });
        }
        const targetCycleId =
          input.cycleId === undefined ? locked.cycleId : input.cycleId;
        const anchors = [input.beforeTaskId, input.afterTaskId].filter(
          (id): id is string => id != null && id !== taskId,
        );
        const anchorRows = anchors.length
          ? await tx.crewTask.findMany({
              where: {
                deletedAt: null,
                crewId: locked.crewId,
                id: { in: anchors },
              },
              select: {
                id: true,
                rank: true,
                workflowStateId: true,
                cycleId: true,
                version: true,
              },
            })
          : [];
        if (anchorRows.length !== anchors.length) {
          throw new ConflictException({
            code: 'CREW_TASK_REORDER_CONFLICT',
            message: 'One or more reorder anchors are unavailable.',
          });
        }
        const byId = new Map(anchorRows.map((row) => [row.id, row]));
        const previous = input.beforeTaskId
          ? byId.get(input.beforeTaskId)
          : undefined;
        const next = input.afterTaskId
          ? byId.get(input.afterTaskId)
          : undefined;
        // Rank is the shared ordering key for a workflow column. A board can show
        // tasks from multiple cycles, so a neighbouring card from another cycle
        // is still a valid ordering anchor and must not silently reassign the
        // moved task's cycle.
        const anchorsMatchTarget = anchorRows.every(
          (anchor) => anchor.workflowStateId === targetWorkflowState.id,
        );
        const anchorsMatchVersion =
          (previous?.version ?? null) === input.beforeTaskVersion &&
          (next?.version ?? null) === input.afterTaskVersion;
        if (!anchorsMatchTarget || !anchorsMatchVersion) {
          throw new ConflictException({
            code: 'CREW_TASK_REORDER_CONFLICT',
            message:
              'The destination changed while this task was being moved. Refresh and try again.',
          });
        }
        let rank: Prisma.Decimal;
        if (previous && next) {
          if (previous.rank.greaterThanOrEqualTo(next.rank)) {
            throw new ConflictException({
              code: 'CREW_TASK_REORDER_CONFLICT',
              message: 'Reorder anchors are not in ascending order.',
            });
          }
        }
        const occupiedDestination = await tx.crewTask.count({
          where: {
            deletedAt: null,
            crewId: locked.crewId,
            id: { notIn: [taskId, ...anchors] },
            workflowStateId: targetWorkflowState.id,
            ...(previous && next
              ? { rank: { gte: previous.rank, lte: next.rank } }
              : previous
                ? { rank: { gte: previous.rank } }
                : next
                  ? { rank: { lte: next.rank } }
                  : {}),
          },
        });
        if (occupiedDestination > 0) {
          throw new ConflictException({
            code: 'CREW_TASK_REORDER_CONFLICT',
            message:
              'The destination changed while this task was being moved. Refresh and try again.',
          });
        }
        if (previous && next) {
          rank = previous.rank.plus(next.rank).dividedBy(2);
        } else if (previous) {
          rank = previous.rank.plus(1024);
        } else if (next) {
          rank = next.rank.dividedBy(2);
        } else {
          rank = new Prisma.Decimal(1024);
        }
        return tx.crewTask.update({
          where: { deletedAt: null, id: taskId },
          data: {
            rank,
            workflowStateId: targetWorkflowState.id,
            cycleId: targetCycleId,
            version: { increment: 1 },
          },
          include: taskInclude,
        });
      },
    );
    await this.conversations.broadcastCrewTaskChange(
      updated.crewId,
      updated.id,
      'updated',
      userId,
    );
    return this.toDtoWithUsage(updated);
  }

  async listCenter(userId: string, query: CrewTaskCenterQuery) {
    const memberships = await this.prisma.crewMember.findMany({
      where: { userId, status: 'active', crew: { deletedAt: null } },
      select: { crewId: true, crew: { select: { name: true } } },
    });
    const accessByCrew = new Map<string, string[]>();
    for (const { crewId } of memberships) {
      try {
        const access = await this.authorization.resolve(crewId, userId);
        if (
          access?.permissions.includes('tasks.view') &&
          (query.scope !== 'managed' ||
            access.permissions.some(
              (p) => p === 'tasks.manage' || p === 'tasks.review',
            ))
        )
          accessByCrew.set(crewId, access.permissions);
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
    }
    const crews = memberships
      .filter((m) => accessByCrew.has(m.crewId))
      .map((m) => ({ id: m.crewId, name: m.crew.name }));
    const crewIds = [...accessByCrew.keys()].filter(
      (id) => !query.crewId || id === query.crewId,
    );
    if (!crewIds.length)
      return {
        items: [],
        nextCursor: null,
        crews,
        stats: { dueSoon: 0, pendingReviews: 0 },
        categories: [],
      };
    const now = new Date();
    const base: Prisma.CrewTaskWhereInput = {
      deletedAt: null,
      crewId: { in: crewIds },
      crew: {
        deletedAt: null,
        members: { some: { userId, status: 'active' } },
      },
      ...(query.scope === 'mine' ? { assignees: { some: { userId } } } : {}),
      ...(query.hasContract
        ? { metadata: { path: ['contractAssetNodeId'], not: Prisma.AnyNull } }
        : {}),
      ...(query.query
        ? { OR: taskCenterSearchWhere(query.query, userId) }
        : {}),
    };
    const categories = await this.prisma.crewTask.groupBy({
      where: base,
      by: ['taskKind'],
    });
    const filtered = {
      ...base,
      ...(query.taskKind ? { taskKind: query.taskKind } : {}),
    };
    const active = {
      notIn: [CrewTaskStatus.approved, CrewTaskStatus.cancelled],
    };
    const statusWhere: Prisma.CrewTaskWhereInput =
      query.status === 'all'
        ? {}
        : query.status === 'overdue'
          ? overdueTaskPredicate(now)
          : {
              workflowState: {
                semantic: query.status === 'active' ? active : query.status,
              },
            };
    const [rows, dueSoon, pendingReviews] = await Promise.all([
      this.prisma.crewTask.findMany({
        where: {
          ...filtered,
          ...statusWhere,
          ...(query.cursor ? { id: { lt: query.cursor } } : {}),
        },
        orderBy: { id: 'desc' },
        take: query.limit + 1,
        select: {
          id: true,
          title: true,
          number: true,
          taskKind: true,
          workflowState: {
            select: { semantic: true, name: true, systemKey: true },
          },
          priority: true,
          dueAt: true,
          metadata: true,
          crew: { select: { id: true, name: true } },
          assignees: { where: { userId }, select: { userId: true } },
        },
      }),
      this.prisma.crewTask.count({
        where: {
          ...filtered,
          ...overdueTaskPredicate(now),
          dueAt: {
            gte: now,
            lte: new Date(now.getTime() + TASK_ADVANCE_WARNING_MS),
          },
        },
      }),
      this.prisma.crewTask.count({
        where: {
          ...filtered,
          workflowState: { semantic: CrewTaskStatus.submitted },
        },
      }),
    ]);
    const items = rows
      .slice(0, query.limit)
      .map(({ workflowState, assignees, metadata, ...task }) => {
        const permissions = accessByCrew.get(task.crew.id) ?? [];
        const status = workflowState.semantic;
        return {
          ...task,
          contractAssetNodeId: taskContractAssetId(metadata),
          workflowState,
          status,
          canSubmit:
            ACCEPTING_TASK_STATUSES.has(status) &&
            permissions.includes('tasks.submit_assigned') &&
            (assignees.length > 0 || permissions.includes('tasks.manage')),
          canReview:
            status === 'submitted' && permissions.includes('tasks.review'),
          deadlineRisk: taskDeadlineRisk(status, task.dueAt, now),
        };
      });
    return {
      items,
      nextCursor: rows.length > query.limit ? items.at(-1)!.id : null,
      crews,
      categories: categories.flatMap((row) =>
        row.taskKind ? [row.taskKind] : [],
      ),
      stats: { dueSoon, pendingReviews },
    };
  }

  private async assertContractAsset(
    tx: Prisma.TransactionClient,
    crewId: string,
    userId: string,
    assetId: string | null | undefined,
  ) {
    if (!assetId) return;
    await requireAvailableTaskContractAsset(tx, crewId, assetId);
    await this.assetAccess.requireNodesPermission(
      crewId,
      [assetId],
      userId,
      CrewAssetPermission.view,
      tx,
    );
  }

  private async assertTaskListCursor(
    where: Prisma.CrewTaskWhereInput,
    cursor?: string,
  ) {
    if (!cursor) return;
    const row = await this.prisma.crewTask.findFirst({
      where: { AND: [where, { id: cursor }] },
      select: { id: true },
    });
    if (!row)
      throw new BadRequestException({
        code: 'CREW_TASK_CURSOR_INVALID',
        message:
          'The task cursor is invalid for the current view. Restart from the first page.',
      });
  }

  async list(crewId: string, userId: string, query: ListCrewTasksQuery) {
    await this.authorization.require(crewId, userId, 'tasks.view');
    // The production dashboard is a fixed platform view, independent of saved filters.
    const view =
      query.viewId === 'production'
        ? {
            completedMode: 'all' as const,
            showSubIssues: true,
            filters: {},
            sorts: [],
          }
        : await this.prisma.crewTaskView.findFirst({
            where: { id: query.viewId, crewId },
          });
    if (!view) {
      throw new NotFoundException('Task view not found.');
    }
    const where = taskViewWhere(
      crewId,
      view.completedMode,
      view.showSubIssues,
      view.filters,
      query,
    );
    await this.assertTaskListCursor(where, query.cursor);
    const orderBy = taskViewOrderBy(view.sorts);
    const [rows, total, workflowCounts] = await Promise.all([
      this.prisma.crewTask.findMany({
        where,
        include: taskCardInclude,
        orderBy,
        take: query.limit + 1,
        ...(query.cursor
          ? {
              cursor: { id: query.cursor },
              skip: 1,
            }
          : {}),
      }),
      this.prisma.crewTask.count({ where }),
      this.prisma.crewTask.groupBy({
        by: ['workflowStateId'],
        where,
        _count: { _all: true },
      }),
    ]);
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items = await this.toDtosWithUsage(page);
    return {
      items,
      nextCursor: hasMore ? (page.at(-1)?.id ?? null) : null,
      total,
      workflowCounts: Object.fromEntries(
        workflowCounts.map((entry) => [
          entry.workflowStateId,
          entry._count._all,
        ]),
      ),
    };
  }

  async listOptions(
    crewId: string,
    userId: string,
    query: ListCrewTaskOptionsQuery,
  ) {
    await this.authorization.require(crewId, userId, 'tasks.view');
    if (query.recruitmentOnly) {
      await this.authorization.require(crewId, userId, 'tasks.manage');
    }
    const normalized = query.query?.trim();
    const where: Prisma.CrewTaskWhereInput = {
      deletedAt: null,
      crewId,
      ...(query.excludeTaskId ? { id: { not: query.excludeTaskId } } : {}),
      ...(query.activeOnly
        ? {
            workflowState: {
              semantic: {
                notIn: [CrewTaskStatus.approved, CrewTaskStatus.cancelled],
              },
            },
          }
        : {}),
      ...(query.recruitmentOnly
        ? {
            assignees: { none: {} },
            workflowState: {
              semantic: {
                notIn: [
                  CrewTaskStatus.approved,
                  CrewTaskStatus.cancelled,
                  CrewTaskStatus.submitted,
                ],
              },
            },
          }
        : {}),
      ...(normalized
        ? {
            OR: taskSearchWhere(normalized),
          }
        : {}),
    };
    await this.assertTaskListCursor(where, query.cursor);
    const rows = await this.prisma.crewTask.findMany({
      where,
      select: {
        id: true,
        number: true,
        title: true,
        workflowState: { select: { semantic: true } },
        priority: true,
        workflowStateId: true,
        parentId: true,
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor
        ? {
            cursor: { id: query.cursor },
            skip: 1,
          }
        : {}),
    });
    const hasMore = rows.length > query.limit;
    const page = hasMore ? rows.slice(0, query.limit) : rows;
    const items = page.map(({ workflowState, ...task }) => ({
      ...task,
      status: workflowState.semantic,
    }));
    return {
      items,
      nextCursor: hasMore ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async summary(crewId: string, userId: string) {
    await this.authorization.require(crewId, userId, 'tasks.view');
    const overdueWhere = { crewId, deletedAt: null, ...overdueTaskPredicate() };
    const [statusGroups, myActive, overdue, myOverdue] = await Promise.all([
      this.prisma.crewTaskWorkflowState.findMany({
        where: { crewId },
        select: {
          semantic: true,
          _count: { select: { tasks: { where: { deletedAt: null } } } },
        },
      }),
      this.prisma.crewTask.count({
        where: {
          deletedAt: null,
          crewId,
          workflowState: {
            semantic: {
              notIn: [CrewTaskStatus.approved, CrewTaskStatus.cancelled],
            },
          },
          assignees: { some: { userId } },
        },
      }),
      this.prisma.crewTask.count({ where: overdueWhere }),
      this.prisma.crewTask.count({
        where: { ...overdueWhere, assignees: { some: { userId } } },
      }),
    ]);
    const byStatus = Object.fromEntries(
      Object.values(CrewTaskStatus).map((status) => [status, 0]),
    ) as Record<CrewTaskStatus, number>;
    for (const group of statusGroups) {
      byStatus[group.semantic] += group._count.tasks;
    }
    return {
      total: Object.values(byStatus).reduce((sum, count) => sum + count, 0),
      active:
        byStatus.open +
        byStatus.in_progress +
        byStatus.submitted +
        byStatus.revision_requested,
      myActive,
      overdue,
      myOverdue,
      pendingReview: byStatus.submitted,
      completed: byStatus.approved,
      byStatus,
    };
  }

  /**
   * Resolves compute usage for a bounded page in two set-based queries. Task
   * list pages must never issue one aggregate per card.
   */
  private async toDtosWithUsage(tasks: TaskCardRow[]) {
    if (tasks.length === 0) return [];
    const projectIds = [
      ...new Set(
        tasks.flatMap((task) =>
          task.canvasProjectId ? [task.canvasProjectId] : [],
        ),
      ),
    ];
    const jobs = await this.prisma.aiJob.findMany({
      where: { projectId: { in: projectIds } },
      select: { id: true, projectId: true },
    });
    const projectByJobId = new Map(
      jobs.flatMap((job) =>
        job.projectId ? [[job.id, job.projectId] as const] : [],
      ),
    );
    const usageByJob = jobs.length
      ? await this.prisma.aiCostLedgerEntry.groupBy({
          by: ['jobId'],
          where: {
            jobId: { in: jobs.map((job) => job.id) },
            internalCredits: { not: null },
          },
          _sum: { internalCredits: true },
        })
      : [];
    const usageByProject = new Map<string, number>();
    for (const usage of usageByJob) {
      const projectId = projectByJobId.get(usage.jobId);
      if (!projectId) continue;
      usageByProject.set(
        projectId,
        (usageByProject.get(projectId) ?? 0) +
          (usage._sum.internalCredits ?? 0),
      );
    }
    return tasks.map((task) =>
      taskCardDto(
        task,
        task.canvasProjectId
          ? (usageByProject.get(task.canvasProjectId) ?? 0)
          : 0,
      ),
    );
  }

  /** Minimal assignment quote; no private scope, interview or negotiation history. */
  async recruitmentTerms(taskId: string, userId: string, applicantId: string) {
    const task = await this.requireTask(taskId);
    await this.authorization.require(task.crewId, userId, 'tasks.manage');
    const positions = await this.prisma.crewPosition.findMany({
      where: { taskId, crewId: task.crewId },
      select: { id: true },
    });
    if (!positions.length) return { required: false, items: [] };
    const applications = await this.prisma.crewApplication.findMany({
      where: {
        crewId: task.crewId,
        applicantId,
        status: 'approved',
        termsVersion: { gt: 0 },
        positionId: { in: positions.map((position) => position.id) },
        position: {
          memberPositions: {
            some: {
              member: {
                userId: applicantId,
                status: 'active',
                removedAt: null,
              },
            },
          },
        },
      },
      select: {
        termsVersion: true,
        terms: {
          select: {
            version: true,
            confirmedAt: true,
            feePeriod: true,
            currency: true,
            feeAmount: true,
          },
        },
      },
    });
    return {
      required: true,
      items: applications.flatMap((app) =>
        app.terms
          .filter(
            (term) =>
              term.version === app.termsVersion &&
              term.confirmedAt &&
              term.feePeriod === 'project',
          )
          .map((term) => ({
            version: term.version,
            currency: term.currency,
            feeAmount: term.feeAmount.toString(),
          })),
      ),
    };
  }

  async get(taskId: string, userId: string) {
    const task = await this.requireTask(taskId);
    await this.authorization.require(task.crewId, userId, 'tasks.view');
    return this.toDtoWithUsage(task);
  }

  async create(crewId: string, userId: string, input: CreateCrewTaskInput) {
    await this.authorization.require(crewId, userId, 'tasks.manage');
    if (input.dueAt && new Date(input.dueAt).getTime() < Date.now()) {
      throw new BadRequestException('Choose today or a future deadline.');
    }
    const uniqueAssigneeIds = [
      ...new Set(input.assignees.map((a) => a.userId)),
    ];
    if (uniqueAssigneeIds.length !== input.assignees.length) {
      throw new BadRequestException({
        message: 'Each member can only be assigned once.',
      });
    }

    const task = await this.manageTaskWrite(crewId, userId, async (tx) => {
      await this.lockTaskWrites(tx, crewId);
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-create:${crewId}`})::bigint)
      `;
      await this.ensureDefaultWorkflowStates(crewId, userId, tx);
      const workflowState = input.workflowStateId
        ? await tx.crewTaskWorkflowState.findFirst({
            where: {
              id: input.workflowStateId,
              crewId,
              archived: false,
            },
          })
        : await tx.crewTaskWorkflowState.findFirst({
            where: { crewId, systemKey: CrewTaskStatus.open },
          });
      if (!workflowState) {
        throw new BadRequestException({
          message: 'The selected workflow column is unavailable.',
        });
      }
      if (!MANUALLY_MOVABLE_TASK_STATUSES.has(workflowState.semantic)) {
        throw new ConflictException({
          message:
            'New tasks must start in an open, active, or changes-requested workflow column.',
        });
      }
      await this.assertPlanningReferences(
        tx,
        crewId,
        input.cycleId,
        input.labelIds,
        input.episodeId,
      );
      await this.assertTaskStructure(
        tx,
        crewId,
        null,
        input.parentId ?? null,
        input.blockedByTaskIds,
      );
      const customFieldValues = await validateTaskCustomFieldValues(
        tx,
        crewId,
        null,
        input.customFieldValues,
      );
      const planningSequence = await tx.crewTask.aggregate({
        where: { crewId },
        _max: { number: true, rank: true },
      });
      await this.assertContractAsset(
        tx,
        crewId,
        userId,
        input.contractAssetNodeId,
      );
      const crewMembers = await tx.crewMember.findMany({
        where: {
          crewId,
          status: 'active',
          userId: { in: uniqueAssigneeIds },
        },
      });
      const memberByUser = new Map(crewMembers.map((m) => [m.userId, m]));
      const missing = uniqueAssigneeIds.filter((id) => !memberByUser.has(id));
      if (missing.length > 0) {
        throw new BadRequestException({
          message: 'Every assignee must be an active crew member.',
          userIds: missing,
        });
      }

      for (const assignee of input.assignees) {
        assertNewCrewCurrency(assignee.currency);
      }
      const created = await tx.crewTask.create({
        data: {
          crewId,
          parentId: input.parentId ?? null,
          number: (planningSequence._max.number ?? 0) + 1,
          title: input.title,
          description: input.description,
          workflowStateId: workflowState.id,
          priority: input.priority,
          startAt: input.startAt ? new Date(input.startAt) : null,
          dueAt: input.dueAt ? new Date(input.dueAt) : null,
          estimatePoints: input.estimatePoints,
          metadata: {
            requiredSkills: [...new Set(input.requiredSkills ?? [])],
            positionRole: input.positionRole ?? null,
            contractAssetNodeId: input.contractAssetNodeId ?? null,
            compensation: {
              paymentTerms: input.paymentTerms ?? null,
              rewardUsdMinor: input.rewardUsdMinor ?? null,
              profitShareBps: input.profitShareBps ?? null,
            },
          },
          computeBudgetPoints: input.computeBudgetPoints,
          revisionLimit: input.revisionLimit,
          cycleId: input.cycleId,
          episodeId: input.episodeId,
          taskKind: input.taskKind ?? null,
          rank: (planningSequence._max.rank ?? new Prisma.Decimal(0)).plus(
            1024,
          ),
          createdByUserId: userId,
          labels: {
            create: input.labelIds.map(
              (labelId) =>
                ({
                  labelId,
                }) satisfies Prisma.CrewTaskLabelAssignmentUncheckedCreateWithoutTaskInput,
            ),
          },
          assignees: {
            create: input.assignees.map(
              (assignee) =>
                ({
                  crewMemberId: memberByUser.get(assignee.userId)!.id,
                  userId: assignee.userId,
                  currency: assignee.currency,
                  rewardAmountMinor:
                    assignee.rewardAmountMinor == null
                      ? null
                      : BigInt(assignee.rewardAmountMinor),
                }) satisfies Prisma.CrewTaskAssigneeUncheckedCreateWithoutTaskInput,
            ),
          },
          dependenciesAsBlocked: {
            create: input.blockedByTaskIds.map((blockingTaskId) => ({
              blockingTaskId,
              createdByUserId: userId,
            })),
          },
          customFieldValues: {
            create: customFieldValues.upserts.map(({ fieldId, value }) => ({
              fieldId,
              value,
              updatedByUserId: userId,
            })),
          },
        },
        include: taskInclude,
      });
      await provisionTaskDeliveryFolderTx(tx, created, userId);
      await recordTaskContractFile(
        tx,
        created.id,
        input.contractAssetNodeId,
        userId,
      );
      await this.writeActivity(tx, created.id, 'task.created', userId, {
        title: created.title,
        assigneeUserIds: uniqueAssigneeIds,
      });

      for (const assigneeId of uniqueAssigneeIds) {
        if (assigneeId === userId) continue;
        await this.notifications.send(
          {
            userId: assigneeId,
            type: 'crew.task.assigned',
            title: `New task: ${created.title}`,
            body: 'A task canvas is ready for you.',
            meta: {
              crewId,
              taskId: created.id,
              taskTitle: created.title,
              actorUserId: userId,
              deeplink: `/crews/${crewId}/workspace?tab=tasks&task=${created.id}`,
            },
            idempotencyKey: `crew.task.assigned:${created.id}:${assigneeId}`,
          },
          tx,
        );
      }
      // Include the folder inserted after task creation in the returned DTO.
      return tx.crewTask.findUniqueOrThrow({
        where: { id: created.id },
        include: taskInclude,
      });
    });
    await this.conversations.broadcastCrewTaskChange(
      crewId,
      task.id,
      'created',
      userId,
    );

    return this.toDtoWithUsage(task);
  }

  async close(taskId: string, userId: string, raw: CloseCrewTaskInput) {
    const input = CloseCrewTaskSchema.parse(raw);
    const task = await this.requireTask(taskId);
    await this.authorization.require(task.crewId, userId, 'tasks.manage');
    const state =
      task.workflowState.semantic === CrewTaskStatus.cancelled
        ? task.workflowState
        : await this.prisma.crewTaskWorkflowState.findFirst({
            where: {
              crewId: task.crewId,
              semantic: CrewTaskStatus.cancelled,
              archived: false,
            },
            orderBy: { id: 'asc' },
          });
    if (!state)
      throw new ConflictException(
        'An active cancellation workflow column is required.',
      );
    return this.update(
      taskId,
      userId,
      { expectedVersion: input.expectedVersion, workflowStateId: state.id },
      input,
    );
  }

  async update(
    taskId: string,
    userId: string,
    input: UpdateCrewTaskInput,
    closure?: CloseCrewTaskInput,
  ) {
    const current = await this.requireTask(taskId);
    await this.authorization.require(current.crewId, userId, 'tasks.manage');
    if (
      !closure &&
      (current.workflowState.semantic === CrewTaskStatus.approved ||
        current.workflowState.semantic === CrewTaskStatus.cancelled)
    ) {
      throw new ConflictException({
        message: 'Completed or cancelled tasks cannot be edited.',
      });
    }
    const uniqueAssigneeIds = input.assignees
      ? [...new Set(input.assignees.map((assignee) => assignee.userId))]
      : null;
    if (
      uniqueAssigneeIds &&
      uniqueAssigneeIds.length !== input.assignees!.length
    ) {
      throw new BadRequestException({
        message: 'Each member can only be assigned once.',
      });
    }

    const task = await this.manageTaskWrite(
      current.crewId,
      userId,
      async (tx) => {
        await this.lockTaskWrites(tx, current.crewId);
        await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-update:${taskId}`})::bigint)
      `;
        const locked = await this.requireActiveTaskTx(tx, taskId);
        if (closure) {
          const retry = await tx.crewTaskTimelineItem.findFirst({
            where: {
              taskId,
              kind: 'task.updated',
              payload: {
                path: ['closure', 'requestId'],
                equals: closure.requestId,
              },
            },
          });
          if (retry) {
            const payload = retry.payload as Record<string, unknown>;
            if (
              retry.actorUserId !== userId ||
              !isDeepStrictEqual(payload.closure, closure)
            )
              throw new ConflictException(
                'The closure request ID was already used with different details.',
              );
            return locked;
          }
        }
        // Membership projections and canvas metadata share the document writer's
        // project boundary. Acquire it before changing either projection.
        if (
          locked.canvasProjectId &&
          (input.assignees !== undefined ||
            input.title !== undefined ||
            input.description !== undefined)
        ) {
          await tx.$queryRaw`SELECT id FROM platform_projects WHERE id = ${locked.canvasProjectId}::uuid FOR UPDATE`;
        }

        await this.authorization.require(
          locked.crewId,
          userId,
          'tasks.manage',
          tx,
        );
        if (locked.version !== input.expectedVersion) {
          throw new ConflictException({
            code: 'CREW_TASK_VERSION_CONFLICT',
            message:
              'This task changed while you were editing it. Refresh and review the latest version before saving again.',
            expectedVersion: input.expectedVersion,
            currentVersion: locked.version,
          });
        }
        if (
          locked.workflowState.semantic === CrewTaskStatus.approved ||
          locked.workflowState.semantic === CrewTaskStatus.cancelled
        ) {
          throw new ConflictException({
            message: 'Completed or cancelled tasks cannot be edited.',
          });
        }
        if (
          input.workflowStateId &&
          locked.workflowState.semantic === CrewTaskStatus.submitted
        ) {
          throw new ConflictException({
            message:
              'Review the current submission before changing its status.',
          });
        }
        const nextWorkflowState = input.workflowStateId
          ? await tx.crewTaskWorkflowState.findFirst({
              where: {
                id: input.workflowStateId,
                crewId: locked.crewId,
                archived: false,
              },
            })
          : null;
        if (
          closure &&
          nextWorkflowState?.semantic !== CrewTaskStatus.cancelled
        ) {
          throw new ConflictException(
            'The cancellation workflow column changed. Refresh and retry.',
          );
        }
        if (input.workflowStateId && !nextWorkflowState) {
          throw new BadRequestException({
            message: 'The selected workflow column is unavailable.',
          });
        }
        if (
          nextWorkflowState &&
          nextWorkflowState.semantic !== CrewTaskStatus.cancelled &&
          !MANUALLY_MOVABLE_TASK_STATUSES.has(nextWorkflowState.semantic)
        ) {
          throw new ConflictException({
            message:
              'Review and completed workflow columns can only be entered through their workflow actions.',
          });
        }
        await this.assertPlanningReferences(
          tx,
          locked.crewId,
          input.cycleId,
          input.labelIds ?? [],
          input.episodeId,
        );
        const nextParentId =
          input.parentId === undefined ? locked.parentId : input.parentId;
        const nextBlockedByTaskIds =
          input.blockedByTaskIds ??
          locked.dependenciesAsBlocked.map(
            (dependency) => dependency.blockingTaskId,
          );
        await this.assertTaskStructure(
          tx,
          locked.crewId,
          taskId,
          nextParentId,
          nextBlockedByTaskIds,
        );
        const customFieldValues = input.customFieldValues
          ? await validateTaskCustomFieldValues(
              tx,
              locked.crewId,
              taskId,
              input.customFieldValues,
            )
          : null;
        const nextStartAt =
          input.startAt === undefined
            ? locked.startAt
            : input.startAt
              ? new Date(input.startAt)
              : null;
        const nextDueAt =
          input.dueAt === undefined
            ? locked.dueAt
            : input.dueAt
              ? new Date(input.dueAt)
              : null;
        if (nextStartAt && nextDueAt && nextDueAt < nextStartAt) {
          throw new BadRequestException({
            message: 'Task due date must be on or after its start date.',
          });
        }

        const previousAssigneeIds = new Set(
          locked.assignees.map((assignee) => assignee.userId),
        );
        const addedAssigneeIds: string[] = [];
        const removedAssigneeIds: string[] = [];
        if (uniqueAssigneeIds) {
          await assertRecruitedTaskAssignees(tx, taskId, input.assignees!);
          const crewMembers = await tx.crewMember.findMany({
            where: {
              crewId: locked.crewId,
              status: 'active',
              userId: { in: uniqueAssigneeIds },
            },
          });
          const memberByUser = new Map(
            crewMembers.map((member) => [member.userId, member]),
          );
          const missing = uniqueAssigneeIds.filter(
            (userId) => !memberByUser.has(userId),
          );
          if (missing.length > 0) {
            throw new BadRequestException({
              message: 'Every assignee must be an active crew member.',
              userIds: missing,
            });
          }
          const nextAssigneeIds = new Set(uniqueAssigneeIds);
          addedAssigneeIds.push(
            ...uniqueAssigneeIds.filter(
              (assigneeId) => !previousAssigneeIds.has(assigneeId),
            ),
          );
          removedAssigneeIds.push(
            ...[...previousAssigneeIds].filter(
              (assigneeId) => !nextAssigneeIds.has(assigneeId),
            ),
          );

          await tx.crewTaskAssignee.deleteMany({
            where: { taskId, userId: { in: removedAssigneeIds } },
          });
          for (const assignee of input.assignees!) {
            const existing = locked.assignees.find(
              (candidate) => candidate.userId === assignee.userId,
            );
            if (
              !existing ||
              existing.rewardAmountMinor == null ||
              existing.currency !== assignee.currency
            ) {
              assertNewCrewCurrency(assignee.currency);
            }
            const rewardAmountMinor =
              assignee.rewardAmountMinor == null
                ? null
                : BigInt(assignee.rewardAmountMinor);
            if (existing) {
              await tx.crewTaskAssignee.update({
                where: { id: existing.id },
                data: {
                  rewardAmountMinor,
                  currency: assignee.currency,
                },
              });
            } else {
              await tx.crewTaskAssignee.create({
                data: {
                  crewId: locked.crewId,
                  taskId,
                  crewMemberId: memberByUser.get(assignee.userId)!.id,
                  userId: assignee.userId,
                  currency: assignee.currency,
                  rewardAmountMinor,
                },
              });
            }
          }

          if (locked.canvasProjectId) {
            for (const assigneeId of addedAssigneeIds) {
              const activeProjectMember = await tx.projectMember.findFirst({
                where: {
                  projectId: locked.canvasProjectId,
                  userId: assigneeId,
                  removedAt: null,
                },
              });
              if (!activeProjectMember) {
                await tx.projectMember.create({
                  data: {
                    projectId: locked.canvasProjectId,
                    userId: assigneeId,
                    role: ProjectMemberRole.editor,
                    status: ProjectMemberStatus.active,
                    grantedById: userId,
                  },
                });
              }
            }
          }
          const removableProjectUsers = removedAssigneeIds.filter(
            (assigneeId) =>
              assigneeId !== locked.createdByUserId &&
              assigneeId !== crewOwnerUserId(locked.crew),
          );
          if (locked.canvasProjectId && removableProjectUsers.length > 0) {
            await tx.projectMember.updateMany({
              where: {
                projectId: locked.canvasProjectId,
                userId: { in: removableProjectUsers },
                removedAt: null,
                role: ProjectMemberRole.editor,
              },
              data: {
                status: ProjectMemberStatus.removed,
                removedAt: new Date(),
              },
            });
          }
        }

        if (
          locked.canvasProjectId &&
          locked.canvasDocumentId &&
          (input.title !== undefined || input.description !== undefined)
        ) {
          await tx.platformProject.update({
            where: { id: locked.canvasProjectId },
            data: {
              name: input.title,
              description: input.description,
            },
          });
          await tx.studioDocument.update({
            where: { id: locked.canvasDocumentId },
            data: {
              title: input.title,
              updatedById: userId,
              version: { increment: 1 },
            },
          });
        }
        if (input.labelIds) {
          await tx.crewTaskLabelAssignment.deleteMany({ where: { taskId } });
          if (input.labelIds.length > 0) {
            await tx.crewTaskLabelAssignment.createMany({
              data: input.labelIds.map((labelId) => ({
                crewId: locked.crewId,
                taskId,
                labelId,
              })),
            });
          }
        }
        if (input.blockedByTaskIds) {
          await tx.crewTaskDependency.deleteMany({
            where: { crewId: locked.crewId, blockedTaskId: taskId },
          });
          if (input.blockedByTaskIds.length > 0) {
            await tx.crewTaskDependency.createMany({
              data: input.blockedByTaskIds.map((blockingTaskId) => ({
                crewId: locked.crewId,
                blockingTaskId,
                blockedTaskId: taskId,
                createdByUserId: userId,
              })),
            });
          }
        }
        if (customFieldValues) {
          if (customFieldValues.removals.length > 0) {
            await tx.crewTaskFieldValue.deleteMany({
              where: {
                taskId,
                fieldId: { in: customFieldValues.removals },
              },
            });
          }
          for (const fieldValue of customFieldValues.upserts) {
            await tx.crewTaskFieldValue.upsert({
              where: {
                taskId_fieldId: {
                  taskId,
                  fieldId: fieldValue.fieldId,
                },
              },
              create: {
                crewId: locked.crewId,
                taskId,
                fieldId: fieldValue.fieldId,
                value: fieldValue.value,
                updatedByUserId: userId,
              },
              update: {
                value: fieldValue.value,
                updatedByUserId: userId,
              },
            });
          }
        }

        const changedFields: Record<string, { from: unknown; to: unknown }> =
          {};
        const recordChange = (field: string, from: unknown, to: unknown) => {
          if (to !== undefined && !changeValuesEqual(from, to))
            changedFields[field] = { from, to };
        };
        recordChange('title', locked.title, input.title);
        recordChange('description', locked.description, input.description);
        recordChange('priority', locked.priority, input.priority);
        recordChange(
          'startAt',
          locked.startAt?.toISOString() ?? null,
          input.startAt,
        );
        recordChange('dueAt', locked.dueAt?.toISOString() ?? null, input.dueAt);
        recordChange(
          'estimatePoints',
          locked.estimatePoints,
          input.estimatePoints,
        );
        recordChange(
          'computeBudgetPoints',
          locked.computeBudgetPoints,
          input.computeBudgetPoints,
        );
        recordChange(
          'revisionLimit',
          locked.revisionLimit,
          input.revisionLimit,
        );
        recordChange('cycleId', locked.cycleId, input.cycleId);
        recordChange('episodeId', locked.episodeId, input.episodeId);
        recordChange('parentId', locked.parentId, input.parentId);
        recordChange(
          'blockedByTaskIds',
          locked.dependenciesAsBlocked
            .map((dependency) => dependency.blockingTaskId)
            .sort(),
          input.blockedByTaskIds?.slice().sort(),
        );
        recordChange(
          'customFieldValues',
          locked.customFieldValues
            .map((fieldValue) => ({
              fieldId: fieldValue.fieldId,
              value: fieldValue.value,
            }))
            .sort((left, right) => left.fieldId.localeCompare(right.fieldId)),
          input.customFieldValues
            ?.slice()
            .sort((left, right) => left.fieldId.localeCompare(right.fieldId)),
        );
        recordChange(
          'labelIds',
          locked.labels.map((assignment) => assignment.labelId).sort(),
          input.labelIds?.slice().sort(),
        );
        recordChange(
          'workflowStateId',
          locked.workflowStateId,
          input.workflowStateId,
        );
        if (
          input.revisionLimit != null &&
          input.revisionLimit < locked.revisionRoundsUsed
        ) {
          throw new BadRequestException({
            code: 'CREW_TASK_REVISION_LIMIT_BELOW_USAGE',
            message: `The revision limit cannot be lower than the ${locked.revisionRoundsUsed} rounds already used.`,
            revisionRoundsUsed: locked.revisionRoundsUsed,
          });
        }

        const priorMetadata = (locked.metadata ?? {}) as Prisma.JsonObject;
        const attachedContractId = taskContractAssetId(priorMetadata);
        if (
          attachedContractId &&
          input.contractAssetNodeId !== undefined &&
          input.contractAssetNodeId !== attachedContractId
        ) {
          throw new ConflictException({
            code: 'CREW_TASK_CONTRACT_LOCKED',
            message:
              'An attached task contract cannot be replaced or removed. Keep the original contract when updating the task.',
          });
        }
        await this.assertContractAsset(
          tx,
          locked.crewId,
          userId,
          input.contractAssetNodeId,
        );
        recordChange(
          'contractAssetNodeId',
          priorMetadata.contractAssetNodeId ?? null,
          input.contractAssetNodeId,
        );
        recordChange(
          'positionRole',
          priorMetadata.positionRole ?? null,
          input.positionRole,
        );
        recordChange(
          'requiredSkills',
          priorMetadata.requiredSkills ?? [],
          input.requiredSkills,
        );
        const priorCompensation = (priorMetadata.compensation ??
          {}) as Prisma.JsonObject;
        recordChange(
          'rewardUsdMinor',
          priorCompensation.rewardUsdMinor ?? null,
          input.rewardUsdMinor,
        );
        recordChange(
          'paymentTerms',
          priorCompensation.paymentTerms ?? null,
          input.paymentTerms,
        );
        recordChange(
          'profitShareBps',
          priorCompensation.profitShareBps ?? null,
          input.profitShareBps,
        );
        const updated = await tx.crewTask.update({
          where: { deletedAt: null, id: taskId },
          data: {
            title: input.title,
            description: input.description,
            priority: input.priority,
            startAt:
              input.startAt === undefined
                ? undefined
                : input.startAt
                  ? new Date(input.startAt)
                  : null,
            dueAt:
              input.dueAt === undefined
                ? undefined
                : input.dueAt
                  ? new Date(input.dueAt)
                  : null,
            estimatePoints: input.estimatePoints,
            metadata:
              input.paymentTerms !== undefined ||
              input.rewardUsdMinor !== undefined ||
              input.profitShareBps !== undefined ||
              input.requiredSkills !== undefined ||
              input.positionRole !== undefined ||
              input.contractAssetNodeId !== undefined
                ? {
                    ...priorMetadata,
                    ...(input.contractAssetNodeId !== undefined
                      ? { contractAssetNodeId: input.contractAssetNodeId }
                      : {}),
                    ...(input.positionRole !== undefined
                      ? { positionRole: input.positionRole }
                      : {}),
                    ...(input.requiredSkills !== undefined
                      ? { requiredSkills: [...new Set(input.requiredSkills)] }
                      : {}),
                    ...(input.paymentTerms !== undefined ||
                    input.rewardUsdMinor !== undefined ||
                    input.profitShareBps !== undefined
                      ? {
                          compensation: {
                            ...priorCompensation,
                            ...(input.paymentTerms !== undefined
                              ? { paymentTerms: input.paymentTerms }
                              : {}),
                            ...(input.rewardUsdMinor !== undefined
                              ? { rewardUsdMinor: input.rewardUsdMinor }
                              : {}),
                            ...(input.profitShareBps !== undefined
                              ? { profitShareBps: input.profitShareBps }
                              : {}),
                          },
                        }
                      : {}),
                  }
                : undefined,
            computeBudgetPoints: input.computeBudgetPoints,
            revisionLimit: input.revisionLimit,
            cycleId: input.cycleId,
            episodeId: input.episodeId,
            taskKind: input.taskKind,
            parentId: input.parentId,
            workflowStateId: nextWorkflowState?.id,
            cancelledAt:
              nextWorkflowState?.semantic === CrewTaskStatus.cancelled
                ? new Date()
                : nextWorkflowState
                  ? null
                  : undefined,
            version: { increment: 1 },
          },
          include: taskInclude,
        });
        if (input.taskKind !== undefined && !updated.deliveryFolder) {
          // Explicitly classifying an older task also repairs its missing
          // delivery destination. Existing folder links and ACLs stay intact.
          await provisionTaskDeliveryFolderTx(tx, updated, userId);
          updated.deliveryFolder = (
            await tx.crewTask.findUniqueOrThrow({
              where: { id: taskId },
              include: taskInclude,
            })
          ).deliveryFolder;
        }
        await recordTaskContractFile(
          tx,
          taskId,
          input.contractAssetNodeId,
          userId,
        );
        await this.writeActivity(tx, taskId, 'task.updated', userId, {
          changedFields,
          addedAssigneeUserIds: addedAssigneeIds,
          removedAssigneeUserIds: removedAssigneeIds,
          ...(closure
            ? {
                closure,
                closureOutcome: 'cancelled_without_financial_settlement',
              }
            : {}),
        });

        for (const assigneeId of addedAssigneeIds) {
          await this.notifications.send(
            {
              userId: assigneeId,
              type: 'crew.task.assigned',
              title: `New task: ${updated.title}`,
              body: 'You were assigned to this task.',
              meta: {
                crewId: updated.crewId,
                taskId,
                taskTitle: updated.title,
                actorUserId: userId,
                deeplink: `/crews/${updated.crewId}/workspace?tab=tasks&task=${taskId}`,
              },
              idempotencyKey: `crew.task.assigned:${taskId}:${updated.version}:${assigneeId}`,
            },
            tx,
          );
        }
        const changed = Object.keys(changedFields).length > 0;
        if (changed || addedAssigneeIds.length || removedAssigneeIds.length) {
          const participantIds = new Set([
            crewOwnerUserId(updated.crew),
            ...updated.assignees.map((assignee) => assignee.userId),
          ]);
          participantIds.delete(userId);
          for (const participantId of participantIds) {
            if (addedAssigneeIds.includes(participantId)) continue;
            await this.notifications.send(
              {
                userId: participantId,
                type: 'crew.task.updated',
                title: `Task updated: ${updated.title}`,
                body: 'Task details or participants changed.',
                meta: {
                  crewId: updated.crewId,
                  taskId,
                  taskTitle: updated.title,
                  actorUserId: userId,
                  deeplink: `/crews/${updated.crewId}/workspace?tab=tasks&task=${taskId}`,
                },
                idempotencyKey: `crew.task.updated:${taskId}:${updated.version}:${participantId}`,
              },
              tx,
            );
          }
        }
        // Linked canvas, task and activity writes may have waited on other rows.
        // Losing authority during those waits must roll back this whole update.
        await this.authorization.require(
          locked.crewId,
          userId,
          'tasks.manage',
          tx,
        );
        return updated;
      },
    );
    await this.conversations.broadcastCrewTaskChange(
      task.crewId,
      task.id,
      'updated',
      userId,
    );
    return this.toDtoWithUsage(task);
  }

  async listTimeline(
    taskId: string,
    userId: string,
    query: ListCrewTaskTimelineQuery,
  ) {
    const task = await this.requireTask(taskId);
    await this.authorization.require(task.crewId, userId, 'tasks.view');
    let before:
      | {
          createdAt: Date;
          id: string;
        }
      | undefined;
    if (query.cursor) {
      const cursor = await this.prisma.crewTaskTimelineItem.findFirst({
        where: { id: query.cursor, taskId },
        select: { createdAt: true, id: true },
      });
      if (!cursor) {
        throw new BadRequestException({ message: 'Invalid timeline cursor.' });
      }
      before = cursor;
    }
    const rows = await this.prisma.crewTaskTimelineItem.findMany({
      where: {
        taskId,
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      include: timelineInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(timelineDto),
      nextCursor: hasMore ? page.at(-1)!.id : null,
    };
  }

  async listActivity(
    crewId: string,
    userId: string,
    query: ListCrewTaskTimelineQuery,
  ) {
    await this.authorization.require(crewId, userId, 'tasks.view');
    let before:
      | {
          createdAt: Date;
          id: string;
        }
      | undefined;
    if (query.cursor) {
      const cursor = await this.prisma.crewTaskTimelineItem.findFirst({
        where: { id: query.cursor, task: { crewId } },
        select: { createdAt: true, id: true },
      });
      if (!cursor) {
        throw new BadRequestException({ message: 'Invalid activity cursor.' });
      }
      before = cursor;
    }
    const rows = await this.prisma.crewTaskTimelineItem.findMany({
      where: {
        task: { crewId },
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      include: activityInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(activityDto),
      nextCursor: hasMore ? page.at(-1)!.id : null,
    };
  }

  async createComment(
    taskId: string,
    userId: string,
    input: CreateCrewTaskCommentInput,
  ) {
    const task = await this.requireTask(taskId);
    await this.authorization.require(task.crewId, userId, 'tasks.comment');
    const created = await this.authorizedTaskWrite(
      task.crewId,
      async (tx) => {
        await this.authorization.require(
          task.crewId,
          userId,
          'tasks.comment',
          tx,
        );
      },
      async (tx) => {
        await this.lockTaskWrites(tx, task.crewId);
        await tx.crewTask.findUniqueOrThrow({
          where: { id: task.id, deletedAt: null },
        });
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(
          hashtextextended(
            ${`crew-task-comment:${taskId}:${userId}:${input.clientKey}`},
            0
          )
        )`,
        );
        const existing = await tx.crewTaskTimelineItem.findFirst({
          where: { taskId, actorUserId: userId, clientKey: input.clientKey },
          include: timelineInclude,
        });
        if (existing) {
          this.assertCommentReplay(existing, input);
          return { row: existing, created: false };
        }

        await this.assertValidMentions(
          tx,
          task.crewId,
          userId,
          input.body,
          input.mentions,
        );
        if (input.replyToId) {
          const reply = await tx.crewTaskTimelineItem.findFirst({
            where: {
              id: input.replyToId,
              taskId,
              kind: 'comment',
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!reply) {
            throw new BadRequestException({
              message: 'The comment you are replying to is unavailable.',
            });
          }
        }

        const assetNodeIds = await this.claimCommentAttachments(
          tx,
          task.crewId,
          userId,
          input.attachments,
        );
        const row = await tx.crewTaskTimelineItem.create({
          data: {
            taskId,
            kind: 'comment',
            actorUserId: userId,
            body: input.body,
            mentions: input.mentions as unknown as Prisma.InputJsonValue,
            replyToId: input.replyToId ?? null,
            clientKey: input.clientKey,
            attachments: {
              create: assetNodeIds.map((assetNodeId, position) => ({
                assetNodeId,
                position,
              })),
            },
          },
          include: timelineInclude,
        });

        const mentionedIds = new Set(
          input.mentions.map((mention) => mention.userId),
        );
        for (const mentionedUserId of mentionedIds) {
          await this.notifications.send(
            {
              userId: mentionedUserId,
              type: 'crew.task.mentioned',
              title: `Mentioned in: ${task.title}`,
              body: input.body || 'You were mentioned with an attachment.',
              meta: {
                crewId: task.crewId,
                taskId,
                taskTitle: task.title,
                actorUserId: userId,
                commentBody: input.body || null,
                hasAttachments: input.attachments.length > 0,
                timelineItemId: row.id,
                deeplink: `/crews/${task.crewId}/workspace?tab=tasks&task=${taskId}&comment=${row.id}`,
              },
              idempotencyKey: `crew.task.mentioned:${row.id}:${mentionedUserId}`,
            },
            tx,
          );
        }
        const participantIds = new Set([
          crewOwnerUserId(task.crew),
          task.createdByUserId,
          ...task.assignees.map((assignee) => assignee.userId),
        ]);
        const previousCommenters = await tx.crewTaskTimelineItem.findMany({
          where: {
            taskId,
            kind: 'comment',
            actorUserId: { not: null },
            deletedAt: null,
          },
          distinct: ['actorUserId'],
          select: { actorUserId: true },
        });
        previousCommenters.forEach(({ actorUserId }) => {
          if (actorUserId) participantIds.add(actorUserId);
        });
        participantIds.delete(userId);
        for (const participantId of participantIds) {
          if (mentionedIds.has(participantId)) continue;
          await this.notifications.send(
            {
              userId: participantId,
              type: 'crew.task.commented',
              title: `New comment: ${task.title}`,
              body: input.body || 'A file was added to the task discussion.',
              meta: {
                crewId: task.crewId,
                taskId,
                taskTitle: task.title,
                actorUserId: userId,
                commentBody: input.body || null,
                hasAttachments: input.attachments.length > 0,
                timelineItemId: row.id,
                deeplink: `/crews/${task.crewId}/workspace?tab=tasks&task=${taskId}&comment=${row.id}`,
              },
              idempotencyKey: `crew.task.commented:${row.id}:${participantId}`,
            },
            tx,
          );
        }
        return { row, created: true };
      },
    );
    if (created.created) {
      await this.conversations.broadcastCrewTaskChange(
        task.crewId,
        taskId,
        'commented',
        userId,
      );
    }
    return timelineDto(created.row);
  }

  async updateComment(
    commentId: string,
    userId: string,
    input: UpdateCrewTaskCommentInput,
  ) {
    const current = await this.prisma.crewTaskTimelineItem.findUnique({
      where: { id: commentId },
      include: { task: true },
    });
    if (
      !current ||
      current.task.deletedAt ||
      current.kind !== 'comment' ||
      current.deletedAt
    ) {
      throw new NotFoundException('Task comment not found.');
    }
    const context = await this.authorization.require(
      current.task.crewId,
      userId,
      'tasks.comment',
    );
    if (
      current.actorUserId !== userId &&
      !context.permissions.includes('tasks.manage')
    ) {
      throw new ForbiddenException({
        message:
          'Only the author or a crew administrator can edit this comment.',
      });
    }
    const updated = await this.authorizedTaskWrite(
      current.task.crewId,
      async (tx) => {
        const context = await this.authorization.require(
          current.task.crewId,
          userId,
          'tasks.comment',
          tx,
        );
        if (
          current.actorUserId !== userId &&
          !context.permissions.includes('tasks.manage')
        )
          throw new ForbiddenException({
            message:
              'Only the author or a crew administrator can change this comment.',
          });
      },
      async (tx) => {
        await this.lockTaskWrites(tx, current.task.crewId);
        await tx.crewTask.findUniqueOrThrow({
          where: { id: current.taskId, deletedAt: null },
        });
        await tx.$executeRaw(
          Prisma.sql`SELECT pg_advisory_xact_lock(
          hashtextextended(${`crew-task-comment-edit:${commentId}`}, 0)
        )`,
        );
        await this.assertValidMentions(
          tx,
          current.task.crewId,
          userId,
          input.body,
          input.mentions,
        );
        const result = await tx.crewTaskTimelineItem.updateMany({
          where: {
            id: commentId,
            version: input.expectedVersion,
            deletedAt: null,
            kind: 'comment',
          },
          data: {
            body: input.body,
            mentions: input.mentions as unknown as Prisma.InputJsonValue,
            editedAt: new Date(),
            version: { increment: 1 },
          },
        });
        if (result.count !== 1) {
          throw new ConflictException({
            code: 'CREW_TASK_COMMENT_VERSION_CONFLICT',
            message:
              'This comment changed while you were editing it. Refresh before saving again.',
          });
        }
        const row = await tx.crewTaskTimelineItem.findUniqueOrThrow({
          where: { id: commentId },
          include: timelineInclude,
        });
        const previousMentionIds = new Set(
          parseMentions(current.mentions).map((mention) => mention.userId),
        );
        for (const mention of input.mentions) {
          if (previousMentionIds.has(mention.userId)) continue;
          await this.notifications.send(
            {
              userId: mention.userId,
              type: 'crew.task.mentioned',
              title: `Mentioned in: ${current.task.title}`,
              body: input.body,
              meta: {
                crewId: current.task.crewId,
                taskId: current.taskId,
                taskTitle: current.task.title,
                actorUserId: userId,
                commentBody: input.body || null,
                timelineItemId: commentId,
                deeplink: `/crews/${current.task.crewId}/workspace?tab=tasks&task=${current.taskId}&comment=${commentId}`,
              },
              idempotencyKey: `crew.task.mentioned:${commentId}:${row.version}:${mention.userId}`,
            },
            tx,
          );
        }
        return row;
      },
    );
    await this.conversations.broadcastCrewTaskChange(
      current.task.crewId,
      current.taskId,
      'commented',
      userId,
    );
    return timelineDto(updated);
  }

  async deleteComment(commentId: string, userId: string): Promise<void> {
    const current = await this.prisma.crewTaskTimelineItem.findUnique({
      where: { id: commentId },
      include: { task: true },
    });
    if (
      !current ||
      current.task.deletedAt ||
      current.kind !== 'comment' ||
      current.deletedAt
    ) {
      throw new NotFoundException('Task comment not found.');
    }
    const context = await this.authorization.require(
      current.task.crewId,
      userId,
      'tasks.comment',
    );
    if (
      current.actorUserId !== userId &&
      !context.permissions.includes('tasks.manage')
    ) {
      throw new ForbiddenException({
        message:
          'Only the author or a crew administrator can delete this comment.',
      });
    }
    await this.authorizedTaskWrite(
      current.task.crewId,
      async (tx) => {
        const context = await this.authorization.require(
          current.task.crewId,
          userId,
          'tasks.comment',
          tx,
        );
        if (
          current.actorUserId !== userId &&
          !context.permissions.includes('tasks.manage')
        )
          throw new ForbiddenException({
            message:
              'Only the author or a crew administrator can change this comment.',
          });
      },
      async (tx) => {
        await this.lockTaskWrites(tx, current.task.crewId);
        await tx.crewTask.findUniqueOrThrow({
          where: { id: current.taskId, deletedAt: null },
        });
        await tx.crewTaskTimelineItem.update({
          where: { id: commentId },
          data: {
            body: null,
            mentions: [],
            payload: {
              deletedByUserId: userId,
            },
            deletedAt: new Date(),
            version: { increment: 1 },
          },
        });
      },
    );
    await this.conversations.broadcastCrewTaskChange(
      current.task.crewId,
      current.taskId,
      'commented',
      userId,
    );
  }

  async getDeliveryTemplate(taskId: string, userId: string) {
    const task = await this.requireTask(taskId);
    await this.authorization.require(task.crewId, userId, 'tasks.view');
    return this.prisma.$transaction(async (tx) => {
      await this.authorization.require(task.crewId, userId, 'tasks.view', tx);
      await this.requireActiveTaskTx(tx, taskId);
      return readTaskDeliveryTemplate(tx, taskId);
    });
  }

  async setDeliveryTemplate(
    taskId: string,
    userId: string,
    input: z.infer<typeof TaskDeliveryTemplateInput>,
  ) {
    const task = await this.requireTask(taskId);
    await this.authorization.require(task.crewId, userId, 'tasks.manage');
    const result = await this.manageTaskWrite(
      task.crewId,
      userId,
      async (tx) => {
        const current = await this.requireActiveTaskTx(tx, taskId);
        if (current.version !== input.expectedVersion)
          throw new ConflictException(
            'Task changed. Refresh before changing its delivery template.',
          );
        if (!ACCEPTING_TASK_STATUSES.has(current.workflowState.semantic))
          throw new ConflictException(
            'The task is not accepting delivery-template changes.',
          );
        const acceptedCommitment = await tx.crewTaskCommitment.findFirst({
          where: { taskId, acceptedAt: { not: null } },
          select: { id: true },
        });
        assertDeliveryTemplateEditable({
          status: current.workflowState.semantic,
          hasSubmission: current.submissions.length > 0,
          hasAcceptedCommitment: Boolean(acceptedCommitment),
        });
        const before = await readTaskDeliveryTemplate(tx, taskId);
        if (input.category) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`crew:delivery-catalog:${input.category.id}`},0))`;
          const [latest] = await tx.$queryRaw<
            Array<{ version: number; status: string }>
          >`SELECT version, definition->>'status' AS status FROM crew_delivery_catalog_revisions WHERE category_id=${input.category.id}::uuid ORDER BY version DESC LIMIT 1`;
          if (
            !latest ||
            latest.version !== input.category.version ||
            latest.status !== 'active'
          )
            throw new ConflictException(
              'Choose the current active delivery category.',
            );
          await tx.$executeRaw`INSERT INTO crew_task_delivery_templates(task_id,category_id,category_version) VALUES (${taskId}::uuid,${input.category.id}::uuid,${input.category.version}) ON CONFLICT(task_id) DO UPDATE SET category_id=EXCLUDED.category_id,category_version=EXCLUDED.category_version`;
        } else {
          await tx.$executeRaw`DELETE FROM crew_task_delivery_templates WHERE task_id=${taskId}::uuid`;
        }
        await tx.crewTask.update({
          where: { id: taskId },
          data: { version: { increment: 1 } },
        });
        await this.writeActivity(
          tx,
          taskId,
          'task.delivery_template.changed',
          userId,
          {
            before: before
              ? { id: before.categoryId, version: before.version }
              : null,
            after: input.category,
          },
        );
        return readTaskDeliveryTemplate(tx, taskId);
      },
    );
    await this.conversations.broadcastCrewTaskChange(
      task.crewId,
      taskId,
      'updated',
      userId,
    );
    return result;
  }

  async setDeliveryFolder(
    taskId: string,
    userId: string,
    input: SetTaskDeliveryFolderInput,
  ) {
    const task = await this.requireTask(taskId);
    const context = await this.authorization.requireMembership(
      task.crewId,
      userId,
    );
    const isAssignee = task.assignees.some((a) => a.userId === userId);
    const canSubmit = context.permissions.includes('tasks.submit_assigned');
    const canManage = context.permissions.includes('tasks.manage');
    if (!canSubmit || (!isAssignee && !canManage)) {
      throw new ForbiddenException({
        message:
          'Only a task assignee or crew manager can set the delivery folder.',
      });
    }

    let resolvedFolderId: string;
    const updated = await this.authorizedTaskWrite(
      task.crewId,
      async (tx) => {
        const currentTask = await this.requireActiveTaskTx(tx, taskId);
        const currentContext = await this.authorization.requireMembership(
          currentTask.crewId,
          userId,
          tx,
        );
        if (
          !currentContext.permissions.includes('tasks.submit_assigned') ||
          (!currentTask.assignees.some((a) => a.userId === userId) &&
            !currentContext.permissions.includes('tasks.manage'))
        ) {
          throw new ForbiddenException({
            message:
              'Only a task assignee or crew manager can set the delivery folder.',
          });
        }
      },
      async (tx) => {
        const locked = await this.requireActiveTaskTx(tx, taskId);
        resolvedFolderId = await taskDeliveryFolderTx(
          tx,
          this.assetAccess,
          locked,
          userId,
          input.deliveryFolderId ?? undefined,
        );
        return tx.crewTask.findUniqueOrThrow({
          where: { id: taskId },
          include: taskInclude,
        });
      },
    );

    await this.conversations.broadcastCrewTaskChange(
      updated.crewId,
      updated.id,
      'updated',
      userId,
    );
    if (resolvedFolderId!) {
      await this.conversations.broadcastCrewAssetChange(
        updated.crewId,
        resolvedFolderId,
        'updated',
        userId,
      );
    }
    return this.toDtoWithUsage(updated);
  }

  async submit(taskId: string, userId: string, input: SubmitCrewTaskInput) {
    const task = await this.requireTask(taskId);
    const context = await this.authorization.requireMembership(
      task.crewId,
      userId,
    );
    const isAssignee = task.assignees.some((a) => a.userId === userId);
    const canSubmit = context.permissions.includes('tasks.submit_assigned');
    const canManage = context.permissions.includes('tasks.manage');
    if (!canSubmit || (!isAssignee && !canManage)) {
      throw new ForbiddenException({
        message: 'Only a task assignee can submit this task.',
      });
    }
    if (!ACCEPTING_TASK_STATUSES.has(task.workflowState.semantic)) {
      throw new ConflictException({
        message: 'This task is not accepting submissions.',
      });
    }

    let deliveryFolderId: string | undefined;
    const updated = await this.authorizedTaskWrite(
      task.crewId,
      async (tx) => {
        const currentTask = await this.requireActiveTaskTx(tx, taskId);
        const context = await this.authorization.requireMembership(
          currentTask.crewId,
          userId,
          tx,
        );
        if (
          !context.permissions.includes('tasks.submit_assigned') ||
          (!currentTask.assignees.some((a) => a.userId === userId) &&
            !context.permissions.includes('tasks.manage'))
        )
          throw new ForbiddenException({
            message: 'Only a current task assignee can submit this task.',
          });
      },
      async (tx) => {
        await this.lockTaskWrites(tx, task.crewId);
        await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-submit:${taskId}`})::bigint)
      `;
        const locked = await this.requireActiveTaskTx(tx, taskId);
        const currentContext = await this.authorization.requireMembership(
          locked.crewId,
          userId,
          tx,
        );
        if (
          !currentContext.permissions.includes('tasks.submit_assigned') ||
          (!locked.assignees.some((a) => a.userId === userId) &&
            !currentContext.permissions.includes('tasks.manage'))
        ) {
          throw new ForbiddenException({
            message: 'Only a current task assignee can submit this task.',
          });
        }

        if (!ACCEPTING_TASK_STATUSES.has(locked.workflowState.semantic)) {
          throw new ConflictException({
            message: 'This task is not accepting submissions.',
          });
        }
        // A manager submitting on behalf of the team must not bypass another
        // assignee's withdrawal and accidentally approve that person's reward.
        const commitment = await tx.crewTaskCommitment.findFirst({
          where: {
            assignmentId: { in: locked.assignees.map((a) => a.id) },
            status: 'withdrawn',
          },
        });
        const participation = await tx.crewParticipationRecord.findFirst({
          where: {
            crewId: locked.crewId,
            userId: { in: [userId, ...locked.assignees.map((a) => a.userId)] },
            withdrawalAt: { not: null },
          },
        });
        if (commitment?.status === 'withdrawn' || participation?.withdrawalAt) {
          throw new ConflictException(
            'A withdrawal is recorded. Arrange a handover with the leader before further work.',
          );
        }
        const unresolvedBlockers = locked.dependenciesAsBlocked
          .map((dependency) => dependency.blockingTask)
          .filter(
            (blocker) =>
              blocker.workflowState.semantic !== CrewTaskStatus.approved &&
              blocker.workflowState.semantic !== CrewTaskStatus.cancelled,
          );
        if (unresolvedBlockers.length > 0) {
          throw new ConflictException({
            code: 'CREW_TASK_BLOCKED',
            message:
              'Complete every blocking task before submitting this work for review.',
            blockers: unresolvedBlockers.map(taskReferenceDto),
          });
        }
        if (input.assetNodeIds.length > 0) {
          const count = await tx.crewAssetNode.count({
            where: {
              id: { in: input.assetNodeIds },
              crewId: locked.crewId,
              status: 'active',
              kind: 'file',
            },
          });
          if (count !== new Set(input.assetNodeIds).size) {
            throw new BadRequestException({
              message: 'One or more submitted assets are unavailable.',
            });
          }
          await this.assetAccess.requireNodesPermission(
            locked.crewId,
            input.assetNodeIds,
            userId,
            CrewAssetPermission.view,
            tx,
          );
        }

        const professionalDelivery = validateProfessionalDelivery(
          await readTaskDeliveryTemplate(tx, taskId),
          input.professionalDelivery,
          input.assetNodeIds,
        );
        let canvasVersionId: string | null = null;
        if (locked.canvasDocumentId) {
          const document = await this.materializeCanvasDocumentTx(
            tx,
            locked.canvasDocumentId,
          );
          const latestDocumentVersion =
            await tx.studioDocumentVersion.findFirst({
              where: { documentId: document.id },
              orderBy: { versionNumber: 'desc' },
            });
          const canvasVersion = await tx.studioDocumentVersion.create({
            data: {
              documentId: document.id,
              versionNumber: (latestDocumentVersion?.versionNumber ?? 0) + 1,
              schemaVersion: document.schemaVersion,
              sequence: document.currentSequence,
              title: document.title,
              label: `Task submission v${locked.submissions.length + 1}`,
              source: StudioDocumentVersionSource.manual,
              sourceId: taskId,
              snapshot: document.contentSnapshot as Prisma.InputJsonValue,
              crdtState: document.crdtState,
              metadata: {
                reason: 'crew_task_submission',
                taskId,
                documentSequence: document.currentSequence,
              },
              createdById: userId,
            },
          });
          canvasVersionId = canvasVersion.id;
          await tx.studioDocument.update({
            where: { id: document.id },
            data: {
              currentVersionId: canvasVersion.id,
              updatedById: userId,
              version: { increment: 1 },
            },
          });
        }
        deliveryFolderId = await taskDeliveryFolderTx(
          tx,
          this.assetAccess,
          locked,
          userId,
          input.deliveryFolderId,
        );
        const deliveryPayload = professionalDelivery ?? null;
        const submission = await tx.crewTaskSubmission.create({
          data: {
            taskId,
            versionNumber: locked.submissions.length + 1,
            submittedByUserId: userId,
            note: input.note,
            canvasVersionId,
            ...(deliveryPayload
              ? { professionalDelivery: deliveryPayload }
              : {}),
            assets: {
              create: [...new Set(input.assetNodeIds)].map((assetNodeId) => ({
                assetNodeId,
              })),
            },
          },
        });
        await captureTaskTimelinessTx(
          tx,
          submission.id,
          locked.dueAt,
          locked.assignees,
        );
        const reviewState = await this.requireSystemWorkflowState(
          tx,
          locked.crewId,
          CrewTaskStatus.submitted,
          userId,
        );
        const result = await tx.crewTask.update({
          where: { deletedAt: null, id: taskId },
          data: {
            workflowStateId: reviewState.id,
            submittedAt: new Date(),
            version: { increment: 1 },
          },
          include: taskInclude,
        });
        await this.writeActivity(tx, taskId, 'task.submitted', userId, {
          submissionId: submission.id,
          versionNumber: submission.versionNumber,
          note: input.note,
          assetNodeIds: [...new Set(input.assetNodeIds)],
        });
        await this.notifications.send(
          {
            userId: crewOwnerUserId(locked.crew),
            type: 'crew.task.submitted',
            title: `Task submitted: ${locked.title}`,
            body: `Submission v${submission.versionNumber} is ready for review.`,
            meta: {
              crewId: locked.crewId,
              taskId,
              taskTitle: locked.title,
              actorUserId: userId,
              submissionId: submission.id,
              submissionVersion: submission.versionNumber,
              deeplink: `/crews/${locked.crewId}/workspace?tab=tasks&task=${taskId}`,
            },
            idempotencyKey: `crew.task.submitted:${submission.id}`,
          },
          tx,
        );
        return result;
      },
    );
    await this.conversations.broadcastCrewTaskChange(
      updated.crewId,
      updated.id,
      'submitted',
      userId,
    );
    if (deliveryFolderId)
      await this.conversations.broadcastCrewAssetChange(
        updated.crewId,
        deliveryFolderId,
        'updated',
        userId,
      );
    return this.toDtoWithUsage(updated);
  }

  async review(taskId: string, userId: string, input: ReviewCrewTaskInput) {
    const current = await this.requireTask(taskId);
    await this.authorization.require(current.crewId, userId, 'tasks.review');

    const task = await this.authorizedTaskWrite(
      current.crewId,
      async (tx) => {
        await this.authorization.require(
          current.crewId,
          userId,
          'tasks.review',
          tx,
        );
      },
      async (tx) => {
        await this.lockTaskWrites(tx, current.crewId);
        await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:task-review:${taskId}`})::bigint)
      `;
        const locked = await this.requireActiveTaskTx(tx, taskId);
        await this.authorization.require(
          locked.crewId,
          userId,
          'tasks.review',
          tx,
        );
        if (locked.workflowState.semantic !== CrewTaskStatus.submitted) {
          throw new ConflictException({
            message: 'Only a submitted task can be reviewed.',
          });
        }
        const latest = locked.submissions[0];
        if (!latest) {
          throw new ConflictException({ message: 'No submission to review.' });
        }
        if (latest.id !== input.expectedSubmissionId) {
          throw new ConflictException({
            code: 'CREW_TASK_SUBMISSION_CHANGED',
            message:
              'A newer submission is available. Refresh the task and review it before deciding.',
          });
        }
        const now = new Date();
        const approved = input.decision === 'approve';
        if (approved && input.revisionDueAt !== undefined)
          throw new BadRequestException(
            'Only a revision request can extend the deadline.',
          );
        const nextDueAt = revisionDeadline(
          locked.dueAt,
          input.revisionDueAt,
          now,
        );
        if (
          !approved &&
          locked.revisionLimit != null &&
          locked.revisionRoundsUsed >= locked.revisionLimit
        ) {
          throw new ConflictException({
            code: 'CREW_TASK_REVISION_LIMIT_REACHED',
            message:
              'This task has used every included revision round. Increase the revision limit or approve the current submission.',
            revisionLimit: locked.revisionLimit,
            revisionRoundsUsed: locked.revisionRoundsUsed,
          });
        }
        const productionVersion =
          approved && latest.canvasVersion
            ? await this.mergeSubmissionIntoProductionTx(
                tx,
                locked,
                latest,
                userId,
                now,
              )
            : null;
        await tx.crewTaskSubmission.update({
          where: { id: latest.id },
          data: {
            reviewNote: input.note,
            reviewedByUserId: userId,
            reviewedAt: now,
            productionVersionId: productionVersion?.id ?? null,
            mergedAt: productionVersion ? now : null,
          },
        });
        if (approved) {
          await recordApprovedTaskTimelinessTx(tx, latest.id, userId);
          await postApprovedTaskTrustTx(tx, latest.id);
          await publishTaskDeliveryAssetsTx(
            tx,
            this.assetAccess,
            locked,
            userId,
            latest.assets.map((asset) => asset.assetNodeId),
          );

          const taskMeta = locked.metadata as Record<string, unknown> | null;
          const clipId =
            typeof taskMeta?.clipId === 'string' ? taskMeta.clipId : null;
          if (clipId) {
            await this.bindDeliveredMediaToClip(tx, {
              task: locked,
              submission: latest,
              userId,
              clipId,
              preferredAssetNodeId: input.bindAssetNodeId,
            });
          }
          for (const assignee of locked.assignees.filter(
            (candidate) =>
              candidate.rewardAmountMinor != null &&
              candidate.rewardAmountMinor > 0n,
          )) {
            await this.earnings.postTaskRewardTx(tx, {
              crewId: locked.crewId,
              taskId,
              taskNumber: locked.number,
              taskTitle: locked.title,
              crewMemberId: assignee.crewMemberId,
              userId: assignee.userId,
              amountMinor: assignee.rewardAmountMinor!,
              currency: assignee.currency,
              approvedByUserId: userId,
            });
          }
        }
        const targetSemantic = approved
          ? CrewTaskStatus.approved
          : CrewTaskStatus.revision_requested;
        const targetWorkflowState = await this.requireSystemWorkflowState(
          tx,
          locked.crewId,
          targetSemantic,
          userId,
        );
        const updated = await tx.crewTask.update({
          where: { deletedAt: null, id: taskId },
          data: approved
            ? {
                workflowStateId: targetWorkflowState.id,
                approvedAt: now,
                approvedByUserId: userId,
                version: { increment: 1 },
              }
            : {
                workflowStateId: targetWorkflowState.id,
                submittedAt: null,
                revisionRoundsUsed: { increment: 1 },
                ...(nextDueAt ? { dueAt: nextDueAt } : {}),
                version: { increment: 1 },
              },
          include: taskInclude,
        });
        await this.writeActivity(
          tx,
          taskId,
          approved ? 'task.approved' : 'task.revision_requested',
          userId,
          {
            submissionId: latest.id,
            versionNumber: latest.versionNumber,
            note: input.note,
            ...(nextDueAt
              ? {
                  deadlineChange: {
                    from: locked.dueAt?.toISOString() ?? null,
                    to: nextDueAt.toISOString(),
                  },
                }
              : {}),
            revisionRound: approved ? undefined : locked.revisionRoundsUsed + 1,
            revisionLimit: locked.revisionLimit,
            productionVersionId: productionVersion?.id,
          },
        );
        for (const assignee of locked.assignees) {
          await this.notifications.send(
            {
              userId: assignee.userId,
              type: approved
                ? 'crew.task.approved'
                : 'crew.task.revision_requested',
              title: approved
                ? `Task approved: ${locked.title}`
                : `Revision requested: ${locked.title}`,
              body:
                input.note ||
                (approved
                  ? 'Your work was approved.'
                  : 'Open the task canvas and submit a new version.'),
              meta: {
                crewId: locked.crewId,
                taskId,
                taskTitle: locked.title,
                actorUserId: userId,
                reviewNote: input.note || null,
                decision: approved ? 'approved' : 'revision_requested',
                deeplink: `/crews/${locked.crewId}/workspace?tab=tasks&task=${taskId}`,
              },
              idempotencyKey: `crew.task.reviewed:${latest.id}:${assignee.userId}`,
            },
            tx,
          );
        }
        return updated;
      },
    );
    await this.conversations.broadcastCrewTaskChange(
      task.crewId,
      task.id,
      'reviewed',
      userId,
    );
    if (input.decision === 'approve') {
      for (const asset of task.submissions[0]?.assets ?? []) {
        await this.conversations.broadcastCrewAssetChange(
          task.crewId,
          asset.assetNodeId,
          'updated',
          userId,
        );
      }
    }
    return this.toDtoWithUsage(task);
  }

  /**
   * Materialize the complete CRDT state while holding the document's advisory
   * lock. Task submission and branch creation call this instead of trusting the
   * asynchronously compacted snapshot, so a just-saved operation can never be
   * omitted from the immutable version under review.
   */
  private async materializeCanvasDocumentTx(
    tx: Prisma.TransactionClient,
    documentId: string,
  ) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${documentId}`})::bigint)
    `;
    let document = await tx.studioDocument.findFirst({
      where: {
        id: documentId,
        type: StudioDocumentType.canvas,
        status: StudioDocumentStatus.active,
        deletedAt: null,
      },
    });
    if (!document) {
      throw new ConflictException({
        code: 'CREW_TASK_CANVAS_UNAVAILABLE',
        message: 'The task canvas is unavailable.',
      });
    }
    const schema = rootSchemaFor(document.type);
    if (!schema) {
      throw new ConflictException({
        code: 'CREW_TASK_CANVAS_DIALECT_UNSUPPORTED',
        message: 'The task canvas does not use a mergeable CRDT dialect.',
      });
    }
    const saved = await readDocumentCrdtState(tx, documentId);
    document = {
      ...document,
      crdtState: saved.crdt_state ? Buffer.from(saved.crdt_state) : null,
      contentSnapshot: saved.content_snapshot,
      snapshotSequence: saved.snapshot_sequence,
      currentSequence: saved.current_sequence,
    };
    if (saved.unsupported_sequence !== null) {
      throw new ConflictException({
        code: 'CREW_TASK_CANVAS_OPERATION_UNMERGEABLE',
        message:
          'The canvas contains a non-CRDT operation and cannot be merged safely.',
        sequence: saved.unsupported_sequence,
      });
    }
    if (
      !document.crdtState &&
      Object.keys(document.contentSnapshot as object).length > 0 &&
      !saved.updates?.length
    ) {
      throw new ConflictException({
        code: 'CREW_TASK_CANVAS_STATE_MISSING',
        message:
          'The canvas has materialized content but no CRDT state. Repair it before creating or reviewing a task.',
      });
    }

    const builder = new DocumentStateBuilder(
      document.crdtState ? new Uint8Array(document.crdtState) : null,
      schema,
    );
    try {
      for (const update of saved.updates ?? []) {
        builder.apply(Buffer.from(update, 'base64'));
      }
      const merged = builder.finish();
      const crdtState = Buffer.from(merged.state);
      if (
        document.snapshotSequence !== document.currentSequence ||
        !document.crdtState
      ) {
        await tx.studioDocument.update({
          where: { id: document.id },
          data: {
            crdtState,
            contentSnapshot:
              merged.snapshot as unknown as Prisma.InputJsonValue,
            snapshotSequence: document.currentSequence,
            lastCompactedAt: new Date(),
          },
        });
      }
      return {
        ...document,
        crdtState,
        contentSnapshot: merged.snapshot,
        snapshotSequence: document.currentSequence,
      };
    } finally {
      builder.destroy();
    }
  }

  /**
   * Merge an immutable task submission into the crew's production trunk.
   *
   * Both sides are full Yjs states. Applying the branch state to the latest
   * materialized production state is commutative/idempotent and preserves
   * independent changes from other approved task branches; replacing the
   * production JSON snapshot would lose those changes.
   */
  private async bindDeliveredMediaToClip(
    tx: Prisma.TransactionClient,
    params: {
      task: TaskRow;
      submission: TaskRow['submissions'][number];
      userId: string;
      clipId: string;
      preferredAssetNodeId?: string;
    },
  ) {
    const { task, submission, userId, clipId, preferredAssetNodeId } = params;

    // 1. Resolve StoryStoryboardClip
    const clip = await tx.storyStoryboardClip.findFirst({
      where: {
        id: clipId,
        status: { not: StoryProductionSpecStatus.archived },
      },
      include: {
        project: { select: { id: true, archivedAt: true } },
      },
    });

    if (!clip || clip.project.archivedAt != null) {
      return;
    }

    // 2. Resolve delivered assets with their MediaAsset details
    const assetNodeIds = submission.assets.map((a) => a.assetNode.id);
    if (!assetNodeIds.length) return;

    const assetNodes = await tx.crewAssetNode.findMany({
      where: { id: { in: assetNodeIds }, status: 'active', kind: 'file' },
      include: { mediaAsset: true },
    });

    // 3. Pick primary asset:
    // If preferredAssetNodeId is provided and exists in delivered set, use it.
    // Otherwise fallback to priority order from professionalDelivery.answers:
    // a. answer to video_with_subtitle
    // b. answer to final_video
    // c. answer to video_without_subtitle
    // d. first asset whose MediaAsset.contentType starts with "video/"
    let chosenAssetNode: (typeof assetNodes)[number] | undefined;

    if (preferredAssetNodeId) {
      chosenAssetNode = assetNodes.find(
        (node) => node.id === preferredAssetNodeId && node.mediaAssetId != null,
      );
      if (!chosenAssetNode) {
        console.warn(
          `Preferred assetNode ${preferredAssetNodeId} not found among delivered assets; falling back to default priority.`,
        );
      }
    }

    if (!chosenAssetNode) {
      const answers =
        (
          submission.professionalDelivery as {
            answers?: Record<string, string | string[]>;
          } | null
        )?.answers ?? {};

      const assetIdForSlot = (slot: string): string | undefined => {
        const v = answers[slot];
        if (Array.isArray(v)) return v[0];
        return typeof v === 'string' ? v : undefined;
      };

      const findBySlotKey = (slotKey: string) => {
        const id = assetIdForSlot(slotKey);
        return id
          ? assetNodes.find(
              (node) => node.id === id && node.mediaAssetId != null,
            )
          : undefined;
      };

      chosenAssetNode =
        findBySlotKey('video_with_subtitle') ??
        findBySlotKey('final_video') ??
        findBySlotKey('video_without_subtitle') ??
        assetNodes.find(
          (node) =>
            node.mediaAsset?.contentType?.startsWith('video/') &&
            node.mediaAssetId != null,
        );
    }

    if (!chosenAssetNode || !chosenAssetNode.mediaAssetId) return;

    const latest = await tx.storyStoryboardClipMediaVersion.findFirst({
      where: { storyboardClipId: clip.id },
      orderBy: { versionNumber: 'desc' },
      select: { versionNumber: true },
    });

    const newVersionNumber = (latest?.versionNumber ?? 0) + 1;

    const mediaVersion = await tx.storyStoryboardClipMediaVersion.create({
      data: {
        storyProjectId: clip.storyProjectId,
        storyChapterId: clip.storyChapterId,
        storyboardClipId: clip.id,
        versionNumber: newVersionNumber,
        mediaAssetId: chosenAssetNode.mediaAssetId,
        sourceFingerprint: clip.sourceFingerprint,
        generationSnapshot: {
          version: 1,
          source: 'crew_task_delivery',
          taskId: task.id,
          taskNumber: task.number,
          submissionId: submission.id,
          assetNodeId: chosenAssetNode.id,
        },
        createdByUserId: userId,
      },
      select: { id: true },
    });

    await tx.storyStoryboardClip.update({
      where: { id: clip.id },
      data: { selectedMediaVersionId: mediaVersion.id },
    });
  }

  private async mergeSubmissionIntoProductionTx(
    tx: Prisma.TransactionClient,
    task: TaskRow,
    submission: TaskRow['submissions'][number],
    reviewerUserId: string,
    mergedAt: Date,
  ) {
    if (!task.crew.productionProjectId) {
      throw new ConflictException({
        code: 'CREW_PRODUCTION_SPACE_MISSING',
        message:
          'The crew production space is unavailable. Repair it before approving this submission.',
      });
    }
    if (
      !submission.canvasVersion ||
      submission.canvasVersion.documentId !== task.canvasDocumentId ||
      !submission.canvasVersion.crdtState
    ) {
      throw new ConflictException({
        code: 'CREW_TASK_SUBMISSION_VERSION_UNMERGEABLE',
        message:
          'The submitted canvas version is incomplete and cannot be merged safely.',
      });
    }
    const productionDocument = await tx.studioDocument.findFirst({
      where: {
        platformProjectId: task.crew.productionProjectId,
        type: StudioDocumentType.canvas,
        status: StudioDocumentStatus.active,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (!productionDocument) {
      throw new ConflictException({
        code: 'CREW_PRODUCTION_CANVAS_MISSING',
        message:
          'The crew production canvas is unavailable. Repair it before approving this submission.',
      });
    }
    const target = await this.materializeCanvasDocumentTx(
      tx,
      productionDocument.id,
    );
    if (
      target.schemaVersion !== submission.canvasVersion.schemaVersion ||
      target.collaborationDialect !==
        submission.canvasVersion.document?.collaborationDialect
    ) {
      throw new ConflictException({
        code: 'CREW_TASK_CANVAS_SCHEMA_CONFLICT',
        message:
          'The task and production canvases use incompatible collaboration schemas.',
      });
    }

    const existing = await tx.studioDocumentVersion.findFirst({
      where: {
        documentId: target.id,
        source: StudioDocumentVersionSource.manual,
        sourceId: submission.id,
      },
      orderBy: { versionNumber: 'desc' },
    });
    if (existing) return existing;

    const schema = rootSchemaFor(target.type);
    const builder = new DocumentStateBuilder(
      new Uint8Array(target.crdtState),
      schema,
    );
    try {
      builder.apply(new Uint8Array(submission.canvasVersion.crdtState));
      const merged = builder.finish();
      const nextSequence = target.currentSequence + 1;
      const idempotencyKey = `crew-task-merge:${submission.id}`;
      await tx.studioDocumentOperation.create({
        data: {
          documentId: target.id,
          sequence: nextSequence,
          operationType: StudioDocumentOperationType.yjs_update,
          actorUserId: reviewerUserId,
          idempotencyKey,
          baseSequence: target.currentSequence,
          yjsUpdate: submission.canvasVersion.crdtState,
          metadata: {
            reason: 'crew_task_approved',
            crewId: task.crewId,
            taskId: task.id,
            taskNumber: task.number,
            submissionId: submission.id,
            submissionVersion: submission.versionNumber,
          },
        },
      });
      const latestVersion = await tx.studioDocumentVersion.findFirst({
        where: { documentId: target.id },
        orderBy: { versionNumber: 'desc' },
      });
      const productionVersion = await tx.studioDocumentVersion.create({
        data: {
          documentId: target.id,
          versionNumber: (latestVersion?.versionNumber ?? 0) + 1,
          schemaVersion: target.schemaVersion,
          sequence: nextSequence,
          title: target.title,
          label: `Merged TASK-${task.number} submission v${submission.versionNumber}`,
          source: StudioDocumentVersionSource.manual,
          sourceId: submission.id,
          snapshot: merged.snapshot as unknown as Prisma.InputJsonValue,
          crdtState: Buffer.from(merged.state),
          metadata: {
            reason: 'crew_task_approved',
            crewId: task.crewId,
            taskId: task.id,
            taskNumber: task.number,
            submissionId: submission.id,
            taskCanvasVersionId: submission.canvasVersion.id,
          },
          createdById: reviewerUserId,
        },
      });
      await tx.studioDocument.update({
        where: { id: target.id },
        data: {
          crdtState: Buffer.from(merged.state),
          contentSnapshot: merged.snapshot as unknown as Prisma.InputJsonValue,
          currentSequence: nextSequence,
          snapshotSequence: nextSequence,
          lastCompactedAt: mergedAt,
          currentVersionId: productionVersion.id,
          updatedById: reviewerUserId,
          version: { increment: 1 },
        },
      });
      return productionVersion;
    } finally {
      builder.destroy();
    }
  }

  private async writeActivity(
    tx: Prisma.TransactionClient,
    taskId: string,
    kind: `task.${string}`,
    actorUserId: string | null,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await tx.crewTaskTimelineItem.create({
      data: {
        taskId,
        kind,
        actorUserId,
        payload: payload as Prisma.InputJsonValue,
      },
    });
  }

  private async assertValidMentions(
    tx: Prisma.TransactionClient | PrismaService,
    crewId: string,
    authorId: string,
    body: string,
    mentions: Array<{ userId: string; label: string }>,
  ): Promise<void> {
    const uniqueIds = new Set(mentions.map((mention) => mention.userId));
    if (uniqueIds.size !== mentions.length) {
      throw new BadRequestException({
        message: 'The same member cannot be mentioned twice.',
      });
    }
    if (uniqueIds.has(authorId)) {
      throw new BadRequestException({
        message: 'You cannot mention yourself.',
      });
    }
    for (const mention of mentions) {
      if (!body.includes(`@${mention.label}`)) {
        throw new BadRequestException({
          message: `Mention @${mention.label} is missing from the comment text.`,
        });
      }
    }
    if (uniqueIds.size === 0) return;
    const activeCount = await tx.crewMember.count({
      where: {
        crewId,
        status: 'active',
        userId: { in: [...uniqueIds] },
      },
    });
    if (activeCount !== uniqueIds.size) {
      throw new BadRequestException({
        message: 'One or more mentioned members are no longer in this crew.',
      });
    }
  }

  private async claimCommentAttachments(
    tx: Prisma.TransactionClient,
    crewId: string,
    userId: string,
    attachments: CreateCrewTaskCommentInput['attachments'],
  ): Promise<string[]> {
    if (attachments.length === 0) return [];
    const existingIds = attachments
      .filter(
        (
          item,
        ): item is Extract<
          CreateCrewTaskCommentInput['attachments'][number],
          { source: 'asset' }
        > => item.source === 'asset',
      )
      .map((item) => item.assetNodeId);
    const uploadIds = attachments
      .filter(
        (
          item,
        ): item is Extract<
          CreateCrewTaskCommentInput['attachments'][number],
          { source: 'upload' }
        > => item.source === 'upload',
      )
      .map((item) => item.mediaAssetId);

    await lockCrewAssetUploads(tx, uploadIds);
    const [nodes, uploadedMedia, alreadyClaimed] = [
      await tx.crewAssetNode.findMany({
        where: {
          id: { in: existingIds },
          crewId,
          kind: CrewAssetNodeKind.file,
          status: CrewAssetNodeStatus.active,
          mediaAssetId: { not: null },
          mediaAsset: { status: MediaAssetStatus.ready },
        },
        select: { id: true },
      }),
      await tx.mediaAsset.findMany({
        where: {
          id: { in: uploadIds },
          status: MediaAssetStatus.ready,
          deletedAt: null,
        },
        select: {
          id: true,
          createdByUserId: true,
          metadata: true,
        },
      }),
      await tx.crewAssetNode.findMany({
        where: {
          mediaAssetId: { in: uploadIds },
        },
        select: { mediaAssetId: true },
      }),
    ];
    if (nodes.length !== existingIds.length) {
      throw new BadRequestException({
        message: 'One or more attached crew assets are unavailable.',
      });
    }
    await this.assetAccess.requireNodesPermission(
      crewId,
      existingIds,
      userId,
      CrewAssetPermission.view,
      tx,
    );
    if (uploadedMedia.length !== uploadIds.length) {
      throw new BadRequestException({
        message: 'One or more uploaded files are unavailable.',
      });
    }
    if (alreadyClaimed.length > 0) {
      throw new ConflictException({
        message:
          'One or more uploaded files were already used. Upload them again before posting.',
      });
    }
    for (const media of uploadedMedia) {
      const metadata =
        media.metadata &&
        typeof media.metadata === 'object' &&
        !Array.isArray(media.metadata)
          ? media.metadata
          : {};
      if (
        media.createdByUserId !== userId ||
        metadata.crewId !== crewId ||
        metadata.uploadKind !== 'crew_asset_file'
      ) {
        throw new ForbiddenException({
          code: 'CREW_TASK_UPLOAD_SCOPE_MISMATCH',
          message:
            'One or more uploaded files do not belong to this crew and user.',
        });
      }
    }

    const nodeById = new Map(nodes.map((node) => [node.id, node.id]));
    const requestedUploads = attachments.filter(
      (item) => item.source === 'upload',
    );
    const usedNames = new Set<string>();
    if (requestedUploads.length > 0) {
      await tx.$executeRaw(
        Prisma.sql`SELECT pg_advisory_xact_lock(
          hashtextextended(${`crew-asset-root-names:${crewId}`}, 0)
        )`,
      );
      const rootNodes = await tx.crewAssetNode.findMany({
        where: {
          crewId,
          parentId: null,
          status: CrewAssetNodeStatus.active,
        },
        select: { name: true },
      });
      rootNodes.forEach((node) => usedNames.add(node.name.toLowerCase()));
    }

    const result: string[] = [];
    for (const attachment of attachments) {
      if (attachment.source === 'asset') {
        result.push(nodeById.get(attachment.assetNodeId)!);
        continue;
      }
      const name = availableCrewAssetName(attachment.name, usedNames);
      usedNames.add(name.toLowerCase());
      const node = await tx.crewAssetNode.create({
        data: {
          crewId,
          parentId: null,
          kind: CrewAssetNodeKind.file,
          name,
          mediaAssetId: attachment.mediaAssetId,
          createdByUserId: userId,
          updatedByUserId: userId,
        },
        select: { id: true },
      });
      result.push(node.id);
    }
    return result;
  }

  private assertCommentReplay(
    existing: TimelineRow,
    input: CreateCrewTaskCommentInput,
  ): void {
    const sameMentions = isDeepStrictEqual(existing.mentions, input.mentions);
    const sameAttachments =
      existing.attachments.length === input.attachments.length &&
      input.attachments.every((attachment, index) => {
        const stored = existing.attachments[index]?.assetNode;
        return attachment.source === 'asset'
          ? stored?.id === attachment.assetNodeId
          : stored?.mediaAssetId === attachment.mediaAssetId;
      });
    if (
      existing.deletedAt !== null ||
      existing.kind !== 'comment' ||
      existing.body !== input.body ||
      existing.replyToId !== (input.replyToId ?? null) ||
      !sameMentions ||
      !sameAttachments
    ) {
      throw new ConflictException({
        code: 'CREW_TASK_COMMENT_IDEMPOTENCY_CONFLICT',
        message:
          'This comment retry key was already used for different content.',
      });
    }
  }

  private async ensureDefaultWorkflowStates(
    crewId: string,
    userId: string,
    client: Prisma.TransactionClient = this.prisma,
  ) {
    await client.crewTaskWorkflowState.createMany({
      data: DEFAULT_CREW_TASK_WORKFLOW_STATES.map((state) => ({
        crewId,
        name: state.name,
        color: state.color,
        semantic: state.semantic,
        systemKey: state.systemKey,
        position: state.position,
        createdByUserId: userId,
      })),
      skipDuplicates: true,
    });
  }

  private async requireSystemWorkflowState(
    client: Prisma.TransactionClient,
    crewId: string,
    semantic: CrewTaskStatus,
    userId: string,
  ) {
    await this.ensureDefaultWorkflowStates(crewId, userId, client);
    const state = await client.crewTaskWorkflowState.findFirst({
      where: { crewId, systemKey: semantic },
    });
    if (!state) {
      throw new ConflictException({
        code: 'CREW_TASK_WORKFLOW_CONFIGURATION_INVALID',
        message: `The crew workflow is missing its ${semantic} system column.`,
      });
    }
    return state;
  }

  private async ensureDefaultViews(crewId: string, userId: string) {
    await this.prisma.crewTaskView.createMany({
      data: [defaultCrewTaskView(crewId, userId)],
      skipDuplicates: true,
    });
  }

  private async assertPlanningReferences(
    tx: Prisma.TransactionClient,
    crewId: string,
    cycleId: string | null | undefined,
    labelIds: string[],
    episodeId?: string | null,
  ) {
    if (cycleId) {
      const cycle = await tx.crewTaskCycle.findFirst({
        where: { id: cycleId, crewId, status: { not: 'cancelled' } },
        select: { id: true },
      });
      if (!cycle) {
        throw new BadRequestException({
          message: 'The selected cycle is unavailable for this crew.',
        });
      }
    }
    if (episodeId) {
      const episode = await tx.crewEpisode.findFirst({
        where: {
          id: episodeId,
          crewId,
          status: { notIn: ['cancelled', 'completed'] },
        },
        select: { id: true },
      });
      if (!episode) {
        throw new BadRequestException({
          message: 'The selected episode is unavailable for this crew.',
        });
      }
    }
    const uniqueLabelIds = [...new Set(labelIds)];
    if (uniqueLabelIds.length !== labelIds.length) {
      throw new BadRequestException({ message: 'Task labels must be unique.' });
    }
    if (uniqueLabelIds.length > 0) {
      const count = await tx.crewTaskLabel.count({
        where: { crewId, id: { in: uniqueLabelIds } },
      });
      if (count !== uniqueLabelIds.length) {
        throw new BadRequestException({
          message: 'Every task label must belong to this crew.',
        });
      }
    }
  }

  private async assertTaskStructure(
    tx: Prisma.TransactionClient,
    crewId: string,
    taskId: string | null,
    parentId: string | null,
    blockedByTaskIds: string[],
  ): Promise<void> {
    const uniqueBlockers = [...new Set(blockedByTaskIds)];
    if (uniqueBlockers.length !== blockedByTaskIds.length) {
      throw new BadRequestException({
        message: 'Blocking tasks must be unique.',
      });
    }
    if (taskId && (parentId === taskId || uniqueBlockers.includes(taskId))) {
      throw new BadRequestException({
        message: 'A task cannot be its own parent or blocker.',
      });
    }
    const references = [...uniqueBlockers, ...(parentId ? [parentId] : [])];
    if (references.length > 0) {
      const count = await tx.crewTask.count({
        where: {
          deletedAt: null,
          crewId,
          id: { in: [...new Set(references)] },
        },
      });
      if (count !== new Set(references).size) {
        throw new BadRequestException({
          message: 'Every related task must belong to this crew.',
        });
      }
    }

    if (taskId && parentId) {
      const visited = new Set<string>();
      let cursor: string | null = parentId;
      while (cursor) {
        if (cursor === taskId) {
          throw new ConflictException({
            code: 'CREW_TASK_HIERARCHY_CYCLE',
            message: 'A task cannot be moved inside its own subtask tree.',
          });
        }
        if (visited.has(cursor)) {
          throw new ConflictException({
            code: 'CREW_TASK_HIERARCHY_CORRUPT',
            message: 'The selected parent already belongs to an invalid cycle.',
          });
        }
        visited.add(cursor);
        const row: { parentId: string | null } | null =
          await tx.crewTask.findFirst({
            where: { deletedAt: null, id: cursor, crewId },
            select: { parentId: true },
          });
        cursor = row?.parentId ?? null;
      }
    }

    if (taskId && uniqueBlockers.length > 0) {
      const edges = await tx.crewTaskDependency.findMany({
        where: {
          crewId,
          blockedTaskId: { not: taskId },
          blockedTask: { deletedAt: null },
          blockingTask: { deletedAt: null },
        },
        select: { blockingTaskId: true, blockedTaskId: true },
      });
      const nextByTask = new Map<string, Set<string>>();
      for (const edge of edges) {
        const targets =
          nextByTask.get(edge.blockingTaskId) ?? new Set<string>();
        targets.add(edge.blockedTaskId);
        nextByTask.set(edge.blockingTaskId, targets);
      }
      for (const blockingTaskId of uniqueBlockers) {
        const targets = nextByTask.get(blockingTaskId) ?? new Set<string>();
        targets.add(taskId);
        nextByTask.set(blockingTaskId, targets);
      }
      const reachableFromTask = new Set<string>();
      const pending = [taskId];
      while (pending.length > 0) {
        const current = pending.pop()!;
        for (const next of nextByTask.get(current) ?? []) {
          if (reachableFromTask.has(next)) continue;
          reachableFromTask.add(next);
          pending.push(next);
        }
      }
      const cycleBlocker = uniqueBlockers.find((blocker) =>
        reachableFromTask.has(blocker),
      );
      if (cycleBlocker) {
        throw new ConflictException({
          code: 'CREW_TASK_DEPENDENCY_CYCLE',
          message:
            'This blocking relationship would create a circular dependency.',
          taskId,
          blockingTaskId: cycleBlocker,
        });
      }
    }
  }

  private async requireTask(taskId: string): Promise<TaskRow> {
    const task = await this.prisma.crewTask.findUnique({
      where: { deletedAt: null, id: taskId },
      include: taskInclude,
    });
    if (!task || task.deletedAt) throw new NotFoundException('Task not found.');
    return task;
  }

  private async toDtoWithUsage(task: TaskRow) {
    if (!task.canvasProjectId) return taskDto(task, 0);
    const usage = await this.prisma.aiCostLedgerEntry.aggregate({
      where: {
        internalCredits: { not: null },
        job: { projectId: task.canvasProjectId },
      },
      _sum: { internalCredits: true },
    });
    return taskDto(task, usage._sum.internalCredits ?? 0);
  }

  async listTaskKindTemplates(crewId: string, userId: string) {
    await this.authorization.require(crewId, userId, 'tasks.view');
    const items = await this.prisma.crewTaskKindTemplate.findMany({
      where: { crewId },
      orderBy: [{ kind: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return {
      items: items.map((row) => ({
        id: row.id,
        kind: row.kind,
        name: row.name,
        title: row.title,
        description: row.description,
      })),
    };
  }

  async createTaskKindTemplate(
    crewId: string,
    userId: string,
    input: CreateCrewTaskKindTemplateInput,
  ) {
    await this.authorization.require(crewId, userId, 'tasks.manage');
    const row = await this.prisma.crewTaskKindTemplate.create({
      data: {
        crewId,
        kind: input.kind,
        name: input.name,
        title: input.title,
        description: input.description,
        createdByUserId: userId,
      },
    });
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      title: row.title,
      description: row.description,
    };
  }

  async deleteTaskKindTemplate(
    crewId: string,
    userId: string,
    templateId: string,
  ) {
    await this.authorization.require(crewId, userId, 'tasks.manage');
    const existing = await this.prisma.crewTaskKindTemplate.findFirst({
      where: { id: templateId, crewId },
    });
    if (!existing) throw new NotFoundException('Task template not found.');
    await this.prisma.crewTaskKindTemplate.delete({
      where: { id: templateId },
    });
  }
}

function taskViewWhere(
  crewId: string,
  completedMode: 'all' | 'recent' | 'hidden',
  showSubIssues: boolean,
  rawFilters: Prisma.JsonValue,
  query: ListCrewTasksQuery,
): Prisma.CrewTaskWhereInput {
  const filters = CrewTaskViewFiltersSchema.parse(rawFilters);
  const clauses: Prisma.CrewTaskWhereInput[] = [{ deletedAt: null }];
  if (completedMode === 'hidden') {
    clauses.push({
      workflowState: {
        semantic: {
          notIn: [CrewTaskStatus.approved, CrewTaskStatus.cancelled],
        },
      },
    });
  } else if (completedMode === 'recent') {
    const completedAfter = new Date();
    completedAfter.setUTCDate(completedAfter.getUTCDate() - 30);
    clauses.push({
      OR: [
        {
          workflowState: {
            semantic: {
              notIn: [CrewTaskStatus.approved, CrewTaskStatus.cancelled],
            },
          },
        },
        {
          workflowState: {
            semantic: {
              in: [CrewTaskStatus.approved, CrewTaskStatus.cancelled],
            },
          },
          updatedAt: { gte: completedAfter },
        },
      ],
    });
  }
  if (!showSubIssues) clauses.push({ parentId: null });
  if (query.priority) clauses.push({ priority: query.priority });
  if (query.query) clauses.push({ OR: taskSearchWhere(query.query) });
  if (filters.workflowStateIds?.length) {
    clauses.push({ workflowStateId: { in: filters.workflowStateIds } });
  }
  if (filters.priorities?.length) {
    clauses.push({ priority: { in: filters.priorities } });
  }
  if (filters.assigneeUserIds?.length) {
    clauses.push({
      assignees: { some: { userId: { in: filters.assigneeUserIds } } },
    });
  }
  if (filters.cycleIds?.length) {
    clauses.push({ cycleId: { in: filters.cycleIds } });
  }
  if (filters.labelIds?.length) {
    clauses.push({
      labels: { some: { labelId: { in: filters.labelIds } } },
    });
  }
  if (filters.unassigned) clauses.push({ assignees: { none: {} } });
  if (filters.overdue) clauses.push(overdueTaskPredicate());
  return {
    crewId,
    ...(clauses.length ? { AND: clauses } : {}),
  };
}

function taskSearchWhere(search: string): Prisma.CrewTaskWhereInput[] {
  const normalized = search.trim();
  const number = /^#?\d+$/.test(normalized)
    ? Number(normalized.replace(/^#/, ''))
    : null;
  return [
    { title: { contains: normalized, mode: 'insensitive' } },
    { description: { contains: normalized, mode: 'insensitive' } },
    {
      labels: {
        some: {
          label: { name: { contains: normalized, mode: 'insensitive' } },
        },
      },
    },
    // CrewTask.number is a PostgreSQL INTEGER, narrower than a JS safe integer.
    ...(number != null && Number.isSafeInteger(number) && number <= 2147483647
      ? [{ number }]
      : []),
  ];
}

function taskViewOrderBy(
  rawSorts: Prisma.JsonValue,
): Prisma.CrewTaskOrderByWithRelationInput[] {
  const parsed = CrewTaskViewSortSchema.array().max(3).safeParse(rawSorts);
  const sorts =
    parsed.success && parsed.data.length
      ? parsed.data
      : [{ field: 'rank' as const, direction: 'asc' as const }];
  const orderBy = sorts.map<Prisma.CrewTaskOrderByWithRelationInput>(
    ({ field, direction }) => {
      if (field === 'status') {
        return { workflowState: { position: direction } };
      }
      if (field === 'priority') {
        // PostgreSQL stores the enum low → urgent. Product ordering is the
        // inverse (urgent → low), so reverse the physical direction.
        return { priority: direction === 'asc' ? 'desc' : 'asc' };
      }
      return { [field]: direction };
    },
  );
  orderBy.push({ id: 'asc' });
  return orderBy;
}

function taskCompensation(metadata: Prisma.JsonValue | null) {
  const compensation = (metadata as Prisma.JsonObject | null)?.compensation as
    | Prisma.JsonObject
    | undefined;
  return {
    paymentTerms:
      TASK_PAYMENT_TERMS.find((term) => term === compensation?.paymentTerms) ??
      null,
    rewardUsdMinor:
      typeof compensation?.rewardUsdMinor === 'number'
        ? compensation.rewardUsdMinor
        : null,
    profitShareBps:
      typeof compensation?.profitShareBps === 'number'
        ? compensation.profitShareBps
        : null,
  };
}

function taskDto(task: TaskRow, computeUsedPoints: number) {
  return {
    ...taskCardDto(task, computeUsedPoints),
    submissions: task.submissions.map((submission) => ({
      id: submission.id,
      versionNumber: submission.versionNumber,
      submittedByUserId: submission.submittedByUserId,
      note: submission.note,
      professionalDelivery: submission.professionalDelivery ?? null,
      canvasVersionId: submission.canvasVersionId,
      productionVersionId: submission.productionVersionId,
      reviewNote: submission.reviewNote,
      reviewedByUserId: submission.reviewedByUserId,
      reviewedAt: submission.reviewedAt?.toISOString() ?? null,
      mergedAt: submission.mergedAt?.toISOString() ?? null,
      createdAt: submission.createdAt.toISOString(),
      assets: submission.assets.map(({ assetNode }) => ({
        id: assetNode.id,
        name: assetNode.name,
        mediaAssetId: assetNode.mediaAssetId,
        contentType: assetNode.mediaAsset?.contentType ?? null,
        sizeBytes:
          assetNode.mediaAsset?.sizeBytes == null
            ? null
            : Number(assetNode.mediaAsset.sizeBytes),
      })),
    })),
  };
}

function taskCardDto(task: TaskCardRow, computeUsedPoints: number) {
  return {
    id: task.id,
    crewId: task.crewId,
    number: task.number,
    title: task.title,
    description: task.description,
    isRecruiting:
      task.recruitmentPositions?.some(
        (position) =>
          !position.closeDate ||
          position.closeDate.getTime() >=
            new Date(new Date().toISOString().slice(0, 10)).getTime(),
      ) ?? false,
    taskKind: task.taskKind,
    assetCategory: taskAssetCategory(task.metadata, task.taskKind),
    storyboardClipId:
      typeof (task.metadata as Record<string, unknown> | null)?.clipId ===
      'string'
        ? (task.metadata as Record<string, unknown>).clipId
        : null,
    status: task.workflowState.semantic,
    workflowStateId: task.workflowStateId,
    workflowState: taskWorkflowStateDto(task.workflowState),
    priority: task.priority,
    startAt: task.startAt?.toISOString() ?? null,
    dueAt: task.dueAt?.toISOString() ?? null,
    deadlineRisk: taskDeadlineRisk(task.workflowState.semantic, task.dueAt),
    ...taskCompensation(task.metadata),
    contractAssetNodeId: taskContractAssetId(task.metadata),
    positionRole:
      typeof (task.metadata as Prisma.JsonObject | null)?.positionRole ===
      'string'
        ? ((task.metadata as Prisma.JsonObject).positionRole as string)
        : null,
    requiredSkills: Array.isArray(
      (task.metadata as Prisma.JsonObject | null)?.requiredSkills,
    )
      ? (
          (task.metadata as Prisma.JsonObject)
            .requiredSkills as Prisma.JsonArray
        ).filter((skill): skill is string => typeof skill === 'string')
      : [],
    estimatePoints: task.estimatePoints,
    computeBudgetPoints: task.computeBudgetPoints,
    computeUsedPoints,
    revisionLimit: task.revisionLimit,
    revisionRoundsUsed: task.revisionRoundsUsed,
    rank: task.rank.toString(),
    parentId: task.parentId,
    parent: task.parent ? taskReferenceDto(task.parent) : null,
    children: task.children.map(taskReferenceDto),
    subtaskProgress: {
      total: task.children.length,
      completed: task.children.filter(
        (child) => child.workflowState.semantic === CrewTaskStatus.approved,
      ).length,
    },
    blockedBy: task.dependenciesAsBlocked.map((dependency) => ({
      ...taskReferenceDto(dependency.blockingTask),
      resolved:
        dependency.blockingTask.workflowState.semantic ===
          CrewTaskStatus.approved ||
        dependency.blockingTask.workflowState.semantic ===
          CrewTaskStatus.cancelled,
    })),
    blocking: task.dependenciesAsBlocker.map((dependency) =>
      taskReferenceDto(dependency.blockedTask),
    ),
    customFieldValues: task.customFieldValues.map((fieldValue) => ({
      fieldId: fieldValue.fieldId,
      value: fieldValue.value,
      updatedByUserId: fieldValue.updatedByUserId,
      updatedAt: fieldValue.updatedAt.toISOString(),
    })),
    cycleId: task.cycleId,
    cycle: task.cycle ? taskCycleDto(task.cycle) : null,
    episodeId: task.episodeId,
    episode: task.episode
      ? {
          id: task.episode.id,
          number: task.episode.number,
          title: task.episode.title,
          status: task.episode.status,
        }
      : null,
    deliveryFolder: task.deliveryFolder?.folder
      ? {
          id: task.deliveryFolder.folder.id,
          name: task.deliveryFolder.folder.name,
        }
      : null,
    deliveryFields:
      ((task.metadata as Record<string, unknown> | null)?.deliveryFields as
        | Array<{ type: string; required: boolean }>
        | undefined) ?? null,
    labels: task.labels
      .map(({ label }) => taskLabelDto(label))
      .sort((a, b) => a.name.localeCompare(b.name)),
    version: task.version,
    canvasProjectId: task.canvasProjectId,
    canvasDocumentId: task.canvasDocumentId,
    canvasHref: task.canvasProjectId
      ? `/fizzstudio/projects/${task.canvasProjectId}`
      : null,
    createdByUserId: task.createdByUserId,
    approvedByUserId: task.approvedByUserId,
    submittedAt: task.submittedAt?.toISOString() ?? null,
    approvedAt: task.approvedAt?.toISOString() ?? null,
    cancelledAt: task.cancelledAt?.toISOString() ?? null,
    createdAt: task.createdAt.toISOString(),
    updatedAt: task.updatedAt.toISOString(),
    assignees: task.assignees.map((assignee) => ({
      id: assignee.id,
      userId: assignee.userId,
      crewMemberId: assignee.crewMemberId,
      currency: assignee.currency,
      rewardAmountMinor:
        assignee.rewardAmountMinor == null
          ? null
          : Number(assignee.rewardAmountMinor),
      assignedAt: assignee.assignedAt.toISOString(),
    })),
  };
}

function taskReferenceDto(task: {
  id: string;
  number: number;
  title: string;
  workflowState: {
    id: string;
    crewId: string;
    name: string;
    color: string;
    semantic: CrewTaskStatus;
    systemKey: string | null;
    position: number;
    archived: boolean;
    version: number;
    createdByUserId: string;
    createdAt: Date;
    updatedAt: Date;
  };
  parentId: string | null;
}) {
  return {
    id: task.id,
    number: task.number,
    title: task.title,
    status: task.workflowState.semantic,
    workflowStateId: task.workflowState.id,
    workflowState: taskWorkflowStateDto(task.workflowState),
    parentId: task.parentId,
  };
}

function changeValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left == null || right == null) return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) => changeValuesEqual(value, right[index]))
    );
  }
  if (typeof left === 'object' || typeof right === 'object') {
    if (typeof left !== 'object' || typeof right !== 'object') return false;
    const leftRecord = left as Record<string, unknown>;
    const rightRecord = right as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).sort();
    const rightKeys = Object.keys(rightRecord).sort();
    return (
      leftKeys.length === rightKeys.length &&
      leftKeys.every(
        (key, index) =>
          key === rightKeys[index] &&
          changeValuesEqual(leftRecord[key], rightRecord[key]),
      )
    );
  }
  return false;
}

function taskViewDto(view: {
  id: string;
  crewId: string;
  name: string;
  layout: string;
  groupBy: string | null;
  filters: unknown;
  sorts: unknown;
  visibleFields: unknown;
  completedMode: 'all' | 'recent' | 'hidden';
  showSubIssues: boolean;
  showEmptyGroups: boolean;
  position: number;
  isSystem: boolean;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...view,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

function taskWorkflowStateDto(state: {
  id: string;
  crewId: string;
  name: string;
  color: string;
  semantic: CrewTaskStatus;
  systemKey: string | null;
  position: number;
  archived: boolean;
  version: number;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
  _count?: { tasks: number };
}) {
  const { _count, ...workflowState } = state;
  return {
    ...workflowState,
    ...(_count ? { taskCount: _count.tasks } : {}),
    createdAt: state.createdAt.toISOString(),
    updatedAt: state.updatedAt.toISOString(),
  };
}

function taskFieldDto(field: {
  id: string;
  crewId: string;
  name: string;
  description: string;
  type: CrewTaskFieldType;
  options: unknown;
  position: number;
  required: boolean;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...field,
    createdAt: field.createdAt.toISOString(),
    updatedAt: field.updatedAt.toISOString(),
  };
}

function taskCycleDto(cycle: {
  id: string;
  crewId: string;
  number: number;
  name: string;
  goal: string;
  status: string;
  startAt: Date;
  endAt: Date;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...cycle,
    startAt: cycle.startAt.toISOString(),
    endAt: cycle.endAt.toISOString(),
    createdAt: cycle.createdAt.toISOString(),
    updatedAt: cycle.updatedAt.toISOString(),
  };
}

function taskLabelDto(label: {
  id: string;
  crewId: string;
  name: string;
  color: string;
  description: string;
  createdByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...label,
    createdAt: label.createdAt.toISOString(),
    updatedAt: label.updatedAt.toISOString(),
  };
}

function timelineDto(item: TimelineRow) {
  const deleted = item.deletedAt != null;
  return {
    id: item.id,
    taskId: item.taskId,
    kind: item.kind,
    actorUserId: item.actorUserId,
    body: deleted ? null : item.body,
    mentions: deleted ? [] : item.mentions,
    payload: item.payload,
    replyTo:
      item.replyTo == null
        ? null
        : {
            id: item.replyTo.id,
            kind: item.replyTo.kind,
            actorUserId: item.replyTo.actorUserId,
            body: item.replyTo.deletedAt ? null : item.replyTo.body,
            deleted: item.replyTo.deletedAt != null,
          },
    version: item.version,
    editedAt: item.editedAt?.toISOString() ?? null,
    deletedAt: item.deletedAt?.toISOString() ?? null,
    createdAt: item.createdAt.toISOString(),
    updatedAt: item.updatedAt.toISOString(),
    attachments: deleted
      ? []
      : item.attachments.map(({ assetNode }) => ({
          id: assetNode.id,
          name: assetNode.name,
          mediaAssetId: assetNode.mediaAssetId,
          mediaKind: assetNode.mediaAsset?.kind ?? null,
          contentType: assetNode.mediaAsset?.contentType ?? null,
          sizeBytes:
            assetNode.mediaAsset?.sizeBytes == null
              ? null
              : Number(assetNode.mediaAsset.sizeBytes),
        })),
  };
}

function activityDto(item: ActivityRow) {
  return {
    ...timelineDto(item),
    task: item.task,
  };
}

function parseMentions(
  value: Prisma.JsonValue,
): Array<{ userId: string; label: string }> {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (
      candidate == null ||
      typeof candidate !== 'object' ||
      Array.isArray(candidate) ||
      typeof candidate.userId !== 'string' ||
      typeof candidate.label !== 'string'
    ) {
      return [];
    }
    return [{ userId: candidate.userId, label: candidate.label }];
  });
}

function crewOwnerUserId(crew: {
  ownership: { member: { userId: string } } | null;
}): string {
  if (!crew.ownership) throw new Error('Crew has no active owner.');
  return crew.ownership.member.userId;
}

function mapTaskLabelWriteError(error: unknown): Error {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    return new ConflictException({
      code: 'CREW_TASK_LABEL_NAME_CONFLICT',
      message: 'A task label with this name already exists in the crew.',
    });
  }
  return error instanceof Error ? error : new Error('Task label write failed.');
}

function taskContractAssetId(
  metadata: Prisma.JsonValue | null | undefined,
): string | null {
  const value = (metadata as Prisma.JsonObject | null)?.contractAssetNodeId;
  return typeof value === 'string' ? value : null;
}

/** A financial reference only discovers a task when it belongs to the viewer;
 * the outer task-center scope still enforces live Crew/task permissions. */
export function taskCenterSearchWhere(
  query: string,
  userId: string,
): Prisma.CrewTaskWhereInput[] {
  const term = query.trim();
  const clauses: Prisma.CrewTaskWhereInput[] = [
    { title: { contains: term, mode: 'insensitive' } },
    { crew: { name: { contains: term, mode: 'insensitive' } } },
  ];
  if (
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(term)
  ) {
    clauses.push(
      { id: term },
      { earningEntries: { some: { id: term, userId } } },
    );
  }
  return clauses;
}
