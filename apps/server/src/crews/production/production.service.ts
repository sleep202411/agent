import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CrewAssetNodeKind,
  CrewAssetNodeStatus,
  CrewAssetPermission,
  CrewEpisodeDeliveryStatus,
  CrewEpisodeStatus,
  CrewMembershipStatus,
  CrewProductionActivityKind,
  CrewProductionResourceKind,
  CrewTaskStatus,
  MediaAssetKind,
  MediaAssetStatus,
  ProjectMemberRole,
  Prisma,
  WorkspaceMemberRole,
  WorkspaceType,
} from '@prisma/client';
import { ConversationsService } from '../../conversations/conversations.service';
import { PrismaService } from '../../infra/db/db.module';
import { WorkspacePermissionService } from '../../workspaces';
import { CrewAssetAccessService } from '../assets/asset-access.service';
import { CrewAuthorizationService } from '../crew-authorization.service';
import { productionDocumentPlainText } from './production.dto';
import type {
  CreateCrewEpisodeInput,
  CreateProductionResourceInput,
  CreateProductionActivityInput,
  ListProductionActivityQuery,
  LinkCrewStudioProjectInput,
  ReorderCrewEpisodeInput,
  ReviewEpisodeDeliveryInput,
  SubmitEpisodeDeliveryInput,
  UpdateCrewEpisodeInput,
  UpdateProductionDocumentInput,
  UpdateProductionPropertiesInput,
} from './production.dto';

const EPISODE_INCLUDE = {
  deliveries: {
    include: {
      assetNode: {
        include: { mediaAsset: true },
      },
    },
    orderBy: [
      { versionNumber: 'desc' as const },
      { createdAt: 'desc' as const },
    ],
  },
  _count: { select: { tasks: { where: { deletedAt: null } } } },
} satisfies Prisma.CrewEpisodeInclude;

type EpisodeRow = Prisma.CrewEpisodeGetPayload<{
  include: typeof EPISODE_INCLUDE;
}>;

const PRODUCTION_RESOURCE_INCLUDE = {
  assetNode: {
    include: { mediaAsset: true },
  },
} satisfies Prisma.CrewProductionResourceInclude;

type ProductionResourceRow = Prisma.CrewProductionResourceGetPayload<{
  include: typeof PRODUCTION_RESOURCE_INCLUDE;
}>;

@Injectable()
export class CrewProductionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly authorization: CrewAuthorizationService,
    private readonly assetAccess: CrewAssetAccessService,
    private readonly conversations: ConversationsService,
    private readonly workspacePermissions: WorkspacePermissionService,
  ) {}

  async overview(crewId: string, userId: string) {
    const context = await this.authorization.require(
      crewId,
      userId,
      'production.view',
    );
    const [page, resources, latestUpdate, projectLabels, labelOptions, crew] =
      await Promise.all([
        this.prisma.crewProductionPage.findUniqueOrThrow({ where: { crewId } }),
        this.prisma.crewProductionResource.findMany({
          where: { crewId },
          include: PRODUCTION_RESOURCE_INCLUDE,
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.crewProductionActivity.findFirst({
          where: { crewId, kind: CrewProductionActivityKind.update },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        }),
        this.prisma.crewProductionLabelAssignment.findMany({
          where: { crewId },
          include: { label: true },
          orderBy: [{ createdAt: 'asc' }, { labelId: 'asc' }],
        }),
        this.prisma.crewTaskLabel.findMany({
          where: { crewId },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.crew.findUniqueOrThrow({
          where: { id: crewId },
          select: {
            studioProject: {
              select: {
                id: true,
                name: true,
                workspace: { select: { id: true, name: true } },
              },
            },
          },
        }),
      ]);

    return {
      page: productionPageDto(page),
      project: productionPropertiesDto(page),
      labels: projectLabels.map(({ label }) => productionLabelDto(label)),
      labelOptions: labelOptions.map(productionLabelDto),
      resources: resources.map(productionResourceDto),
      latestUpdate: latestUpdate ? productionActivityDto(latestUpdate) : null,
      studioProject: crew.studioProject
        ? studioProjectSummary(crew.studioProject)
        : null,
      capabilities: {
        manage: context.permissions.includes('production.manage'),
      },
    };
  }

  async studioProjectOptions(crewId: string, userId: string) {
    await this.authorization.require(crewId, userId, 'production.view');
    const [crew, memberships] = await Promise.all([
      this.prisma.crew.findUniqueOrThrow({
        where: { id: crewId },
        select: { studioProjectId: true },
      }),
      this.prisma.workspaceMember.findMany({
        where: {
          userId,
          status: 'active',
          removedAt: null,
          workspace: { status: 'active', deletedAt: null },
        },
        include: {
          workspace: {
            include: {
              projects: {
                where: { status: 'active', deletedAt: null },
                include: {
                  members: {
                    where: { userId, status: 'active', removedAt: null },
                    select: { role: true },
                  },
                  studioCrew: { select: { id: true, name: true } },
                },
                orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
              },
            },
          },
        },
        orderBy: [{ joinedAt: 'asc' }],
      }),
    ]);

    return {
      linkedProjectId: crew.studioProjectId,
      workspaces: memberships.map((membership) => ({
        id: membership.workspace.id,
        name: membership.workspace.name,
        type: membership.workspace.type,
        projects: membership.workspace.projects.map((project) => {
          const linkedElsewhere =
            project.studioCrew && project.studioCrew.id !== crewId;
          const canEdit = canEditStudioProject(
            membership.role,
            project.members[0]?.role ?? null,
          );
          const disabledReason =
            membership.workspace.type !== WorkspaceType.team
              ? 'personal_workspace'
              : linkedElsewhere
                ? 'already_linked'
                : !canEdit
                  ? 'insufficient_permission'
                  : null;
          return {
            id: project.id,
            name: project.name,
            description: project.description,
            selected: project.id === crew.studioProjectId,
            selectable: disabledReason === null,
            disabledReason,
            linkedCrewName: linkedElsewhere
              ? (project.studioCrew?.name ?? null)
              : null,
          };
        }),
      })),
    };
  }

  async linkStudioProject(
    crewId: string,
    userId: string,
    input: LinkCrewStudioProjectInput,
  ) {
    await this.authorization.require(crewId, userId, 'production.manage');
    if (input.projectId) {
      await this.workspacePermissions.requireProjectRole(
        userId,
        input.projectId,
        ProjectMemberRole.editor,
      );
    }

    let linked: {
      id: string;
      name: string;
      workspace: { id: string; name: string; type: WorkspaceType };
    } | null;
    try {
      linked = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`
          SELECT pg_advisory_xact_lock(hashtext(${`crew:studio-project:${crewId}`})::bigint)
        `;
        const crew = await tx.crew.findFirstOrThrow({
          where: { id: crewId, deletedAt: null },
          select: { studioProjectId: true },
        });
        let project: {
          id: string;
          name: string;
          workspace: { id: string; name: string; type: WorkspaceType };
        } | null = null;

        if (input.projectId) {
          const candidate = await tx.platformProject.findFirst({
            where: { id: input.projectId, status: 'active', deletedAt: null },
            select: {
              id: true,
              name: true,
              workspace: { select: { id: true, name: true, type: true } },
              studioCrew: { select: { id: true, name: true } },
            },
          });
          if (!candidate)
            throw new NotFoundException('Studio project not found.');
          if (candidate.workspace.type !== WorkspaceType.team) {
            throw new BadRequestException({
              code: 'CREW_STUDIO_PROJECT_REQUIRES_TEAM_WORKSPACE',
              message:
                'Only projects in a team workspace can be linked to a crew.',
            });
          }
          if (candidate.studioCrew && candidate.studioCrew.id !== crewId) {
            throw new ConflictException({
              code: 'CREW_STUDIO_PROJECT_ALREADY_LINKED',
              message: `This project is already linked to ${candidate.studioCrew.name}.`,
            });
          }
          project = candidate;
        }

        if (crew.studioProjectId !== (project?.id ?? null)) {
          await tx.crew.update({
            where: { id: crewId },
            data: { studioProjectId: project?.id ?? null },
          });
          await tx.crewProductionActivity.create({
            data: {
              crewId,
              kind: CrewProductionActivityKind.properties_changed,
              payload: {
                changes: [
                  {
                    field: 'studio_project_id',
                    from: crew.studioProjectId,
                    to: project?.id ?? null,
                  },
                ],
              },
              createdByUserId: userId,
            },
          });
        }
        return project;
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException({
          code: 'CREW_STUDIO_PROJECT_ALREADY_LINKED',
          message: 'This Studio project is already linked to another crew.',
        });
      }
      throw error;
    }

    await this.conversations.broadcastCrewTaskProjectChange(
      crewId,
      'production_project',
      crewId,
      'updated',
      userId,
    );
    return { studioProject: linked ? studioProjectSummary(linked) : null };
  }

  async updateDocument(
    crewId: string,
    userId: string,
    input: UpdateProductionDocumentInput,
  ) {
    await this.authorization.require(crewId, userId, 'production.manage');
    const result = await this.prisma.crewProductionPage.updateMany({
      where: { crewId, version: input.expectedVersion },
      data: {
        document: input.document as Prisma.InputJsonObject,
        version: { increment: 1 },
        updatedByUserId: userId,
      },
    });
    if (result.count !== 1) throw productionConflict();
    const page = await this.prisma.crewProductionPage.findUniqueOrThrow({
      where: { crewId },
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      crewId,
      'production_document',
      crewId,
      'updated',
      userId,
    );
    return productionPageDto(page);
  }

  async updateProperties(
    crewId: string,
    userId: string,
    input: UpdateProductionPropertiesInput,
  ) {
    await this.authorization.require(crewId, userId, 'production.manage');
    if (input.leadMemberId) {
      const lead = await this.prisma.crewMember.findFirst({
        where: {
          id: input.leadMemberId,
          crewId,
          status: CrewMembershipStatus.active,
        },
        select: { id: true },
      });
      if (!lead) {
        throw new BadRequestException({
          message: 'The selected project lead is not an active crew member.',
        });
      }
    }

    const [current, currentLabelAssignments] = await Promise.all([
      this.prisma.crewProductionPage.findUniqueOrThrow({
        where: { crewId },
        select: {
          status: true,
          priority: true,
          leadMemberId: true,
          startDate: true,
          startDateGranularity: true,
          targetDate: true,
          targetDateGranularity: true,
        },
      }),
      this.prisma.crewProductionLabelAssignment.findMany({
        where: { crewId },
        include: { label: true },
      }),
    ]);
    const startDate = resolveProjectDate(input.startDate, current.startDate);
    const targetDate = resolveProjectDate(input.targetDate, current.targetDate);
    const startDateGranularity =
      input.startDateGranularity ?? current.startDateGranularity;
    const targetDateGranularity =
      input.targetDateGranularity ?? current.targetDateGranularity;
    assertCanonicalProjectDate(startDate, startDateGranularity, 'start');
    assertCanonicalProjectDate(targetDate, targetDateGranularity, 'target');
    if (
      startDate &&
      targetDate &&
      projectPeriodEnd(targetDate, targetDateGranularity) < startDate
    ) {
      throw new BadRequestException({
        message: 'The target date cannot be earlier than the start date.',
      });
    }

    const labelIds = input.labelIds ? [...new Set(input.labelIds)] : undefined;
    let requestedLabels:
      | Array<{
          id: string;
          name: string;
          color: string;
        }>
      | undefined;
    if (labelIds) {
      const labels = await this.prisma.crewTaskLabel.findMany({
        where: { crewId, id: { in: labelIds } },
        select: { id: true, name: true, color: true },
      });
      if (labels.length !== labelIds.length) {
        throw new BadRequestException({
          message: 'One or more selected labels do not belong to this crew.',
        });
      }
      requestedLabels = labels;
    }

    const propertyChanges = productionPropertyChanges(current, input, {
      startDate,
      startDateGranularity,
      targetDate,
      targetDateGranularity,
    });
    const currentLabels = currentLabelAssignments.map(({ label }) => ({
      id: label.id,
      name: label.name,
      color: label.color,
    }));
    const labelChanges = requestedLabels
      ? productionLabelChanges(currentLabels, requestedLabels)
      : null;

    const page = await this.prisma.$transaction(async (tx) => {
      const result = await tx.crewProductionPage.updateMany({
        where: { crewId, metadataVersion: input.expectedVersion },
        data: {
          status: input.status,
          priority: input.priority,
          leadMemberId: input.leadMemberId,
          startDate: input.startDate === undefined ? undefined : startDate,
          startDateGranularity: input.startDateGranularity,
          targetDate: input.targetDate === undefined ? undefined : targetDate,
          targetDateGranularity: input.targetDateGranularity,
          metadataVersion: { increment: 1 },
          updatedByUserId: userId,
        },
      });
      if (result.count !== 1) throw productionPropertiesConflict();
      if (labelIds) {
        await tx.crewProductionLabelAssignment.deleteMany({
          where: { crewId },
        });
        if (labelIds.length > 0) {
          await tx.crewProductionLabelAssignment.createMany({
            data: labelIds.map((labelId) => ({ crewId, labelId })),
          });
        }
      }
      if (propertyChanges.length > 0) {
        await tx.crewProductionActivity.create({
          data: {
            crewId,
            kind: CrewProductionActivityKind.properties_changed,
            payload: { changes: propertyChanges },
            createdByUserId: userId,
          },
        });
      }
      if (
        labelChanges &&
        (labelChanges.added.length > 0 || labelChanges.removed.length > 0)
      ) {
        await tx.crewProductionActivity.create({
          data: {
            crewId,
            kind: CrewProductionActivityKind.labels_changed,
            payload: labelChanges,
            createdByUserId: userId,
          },
        });
      }
      return tx.crewProductionPage.findUniqueOrThrow({
        where: { crewId },
      });
    });
    const projectLabels =
      await this.prisma.crewProductionLabelAssignment.findMany({
        where: { crewId },
        include: { label: true },
        orderBy: [{ createdAt: 'asc' }, { labelId: 'asc' }],
      });
    await this.conversations.broadcastCrewTaskProjectChange(
      crewId,
      'production_project',
      crewId,
      'updated',
      userId,
    );
    return {
      project: productionPropertiesDto(page),
      labels: projectLabels.map(({ label }) => productionLabelDto(label)),
    };
  }

  async createResource(
    crewId: string,
    userId: string,
    input: CreateProductionResourceInput,
  ) {
    await this.authorization.require(crewId, userId, 'production.manage');
    let title: string;
    if (input.kind === 'asset') {
      await this.assetAccess.requireNodePermission(
        crewId,
        input.assetNodeId,
        userId,
        CrewAssetPermission.view,
      );
      const asset = await this.prisma.crewAssetNode.findFirst({
        where: {
          id: input.assetNodeId,
          crewId,
          status: CrewAssetNodeStatus.active,
        },
        select: { name: true },
      });
      if (!asset) {
        throw new BadRequestException({
          message: 'The selected crew asset is no longer available.',
        });
      }
      title = input.title ?? asset.name;
    } else {
      title = input.title ?? productionLinkTitle(input.url);
    }
    const created = await this.prisma.$transaction(async (tx) => {
      const resource = await tx.crewProductionResource.create({
        data: {
          crewId,
          kind:
            input.kind === 'link'
              ? CrewProductionResourceKind.link
              : CrewProductionResourceKind.asset,
          title,
          url: input.kind === 'link' ? input.url : null,
          assetNodeId: input.kind === 'asset' ? input.assetNodeId : null,
          createdByUserId: userId,
        },
      });
      await tx.crewProductionActivity.create({
        data: {
          crewId,
          kind: CrewProductionActivityKind.resource_added,
          payload: {
            resource: {
              id: resource.id,
              title: resource.title,
              kind: resource.kind,
            },
          },
          createdByUserId: userId,
        },
      });
      return resource;
    });
    const resource = await this.prisma.crewProductionResource.findUniqueOrThrow(
      {
        where: { id: created.id },
        include: PRODUCTION_RESOURCE_INCLUDE,
      },
    );
    await this.conversations.broadcastCrewTaskProjectChange(
      crewId,
      'production_resource',
      resource.id,
      'created',
      userId,
    );
    return productionResourceDto(resource);
  }

  async deleteResource(resourceId: string, userId: string) {
    const resource = await this.prisma.crewProductionResource.findUnique({
      where: { id: resourceId },
      select: { crewId: true, title: true, kind: true },
    });
    if (!resource) throw new NotFoundException('Project resource not found.');
    await this.authorization.require(
      resource.crewId,
      userId,
      'production.manage',
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.crewProductionResource.delete({ where: { id: resourceId } });
      await tx.crewProductionActivity.create({
        data: {
          crewId: resource.crewId,
          kind: CrewProductionActivityKind.resource_removed,
          payload: {
            resource: {
              id: resourceId,
              title: resource.title,
              kind: resource.kind,
            },
          },
          createdByUserId: userId,
        },
      });
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      resource.crewId,
      'production_resource',
      resourceId,
      'deleted',
      userId,
    );
  }

  async listActivity(
    crewId: string,
    userId: string,
    query: ListProductionActivityQuery,
  ) {
    await this.authorization.require(crewId, userId, 'production.view');
    let before: { createdAt: Date; id: string } | undefined;
    if (query.cursor) {
      const cursor = await this.prisma.crewProductionActivity.findFirst({
        where: { id: query.cursor, crewId },
        select: { createdAt: true, id: true },
      });
      if (!cursor) {
        throw new BadRequestException({
          message: 'Invalid project activity cursor.',
        });
      }
      before = cursor;
    }
    const rows = await this.prisma.crewProductionActivity.findMany({
      where: {
        crewId,
        ...(before
          ? {
              OR: [
                { createdAt: { lt: before.createdAt } },
                { createdAt: before.createdAt, id: { lt: before.id } },
              ],
            }
          : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    return {
      items: page.map(productionActivityDto),
      nextCursor: hasMore ? page.at(-1)!.id : null,
    };
  }

  async createActivity(
    crewId: string,
    userId: string,
    input: CreateProductionActivityInput,
  ) {
    await this.authorization.require(
      crewId,
      userId,
      input.kind === 'update' ? 'production.manage' : 'production.view',
    );
    const activity = await this.prisma.crewProductionActivity.create({
      data: {
        crewId,
        kind:
          input.kind === 'update'
            ? CrewProductionActivityKind.update
            : CrewProductionActivityKind.comment,
        health: input.kind === 'update' ? input.health : null,
        content: input.content as Prisma.InputJsonValue,
        plainText: productionDocumentPlainText(input.content).trim(),
        progress: input.kind === 'update' ? input.progress : null,
        createdByUserId: userId,
      },
    });
    await this.conversations.broadcastCrewTaskProjectChange(
      crewId,
      'production_activity',
      activity.id,
      'created',
      userId,
    );
    return productionActivityDto(activity);
  }

  async listEpisodes(crewId: string, userId: string) {
    await this.authorization.require(crewId, userId, 'production.view');
    return this.readEpisodes(crewId);
  }

  async createEpisode(
    crewId: string,
    userId: string,
    input: CreateCrewEpisodeInput,
  ) {
    await this.authorization.require(crewId, userId, 'production.manage');
    if (
      input.status === CrewEpisodeStatus.completed ||
      input.status === CrewEpisodeStatus.in_review
    ) {
      throw new BadRequestException({
        message:
          'A new episode cannot start in review or completed. Submit and approve a delivery to reach those states.',
      });
    }
    const id = await this.prisma.$transaction(async (tx) => {
      await this.lockEpisodes(tx, crewId);
      const aggregate = await tx.crewEpisode.aggregate({
        where: { crewId },
        _max: { number: true, rank: true },
      });
      const episode = await tx.crewEpisode.create({
        data: {
          crewId,
          number: input.number ?? (aggregate._max.number ?? 0) + 1,
          title: input.title,
          synopsis: input.synopsis,
          status: input.status,
          durationSeconds: input.durationSeconds,
          plannedReleaseAt: input.plannedReleaseAt
            ? new Date(input.plannedReleaseAt)
            : null,
          rank: (aggregate._max.rank ?? new Prisma.Decimal(0)).plus(1024),
          createdByUserId: userId,
        },
        select: { id: true },
      });
      return episode.id;
    });
    const episode = await this.findEpisodeDto(id);
    await this.conversations.broadcastCrewTaskProjectChange(
      crewId,
      'episode',
      id,
      'created',
      userId,
    );
    return episode;
  }

  async updateEpisode(
    episodeId: string,
    userId: string,
    input: UpdateCrewEpisodeInput,
  ) {
    const current = await this.prisma.crewEpisode.findUnique({
      where: { id: episodeId },
      include: {
        deliveries: {
          where: { status: CrewEpisodeDeliveryStatus.submitted },
          select: { id: true },
          take: 1,
        },
      },
    });
    if (!current) throw new NotFoundException('Episode not found.');
    await this.authorization.require(
      current.crewId,
      userId,
      'production.manage',
    );
    if (input.status === CrewEpisodeStatus.completed) {
      throw new ConflictException({
        message:
          'Episodes become completed only when a submitted delivery is approved.',
      });
    }
    if (
      current.status === CrewEpisodeStatus.completed &&
      input.status !== undefined
    ) {
      throw new ConflictException({
        message:
          'A completed episode can only re-enter review by submitting a newer delivery.',
      });
    }
    if (
      input.status === CrewEpisodeStatus.in_review &&
      current.deliveries.length === 0
    ) {
      throw new ConflictException({
        message: 'Submit a delivery before moving this episode into review.',
      });
    }
    const result = await this.prisma.crewEpisode.updateMany({
      where: { id: episodeId, version: input.expectedVersion },
      data: {
        number: input.number,
        title: input.title,
        synopsis: input.synopsis,
        status: input.status,
        durationSeconds: input.durationSeconds,
        plannedReleaseAt:
          input.plannedReleaseAt === undefined
            ? undefined
            : input.plannedReleaseAt
              ? new Date(input.plannedReleaseAt)
              : null,
        version: { increment: 1 },
      },
    });
    if (result.count !== 1) throw episodeConflict();
    const episode = await this.findEpisodeDto(episodeId);
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'episode',
      episodeId,
      'updated',
      userId,
    );
    return episode;
  }

  async reorderEpisode(
    episodeId: string,
    userId: string,
    input: ReorderCrewEpisodeInput,
  ) {
    const current = await this.prisma.crewEpisode.findUnique({
      where: { id: episodeId },
    });
    if (!current) throw new NotFoundException('Episode not found.');
    await this.authorization.require(
      current.crewId,
      userId,
      'production.manage',
    );
    await this.prisma.$transaction(async (tx) => {
      await this.lockEpisodes(tx, current.crewId);
      const locked = await tx.crewEpisode.findUniqueOrThrow({
        where: { id: episodeId },
      });
      if (locked.version !== input.expectedVersion) throw episodeConflict();
      const rank = await this.resolveEpisodeRank(
        tx,
        current.crewId,
        episodeId,
        input.beforeEpisodeId,
        input.afterEpisodeId,
      );
      await tx.crewEpisode.update({
        where: { id: episodeId },
        data: { rank, version: { increment: 1 } },
      });
    });
    const episode = await this.findEpisodeDto(episodeId);
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'episode',
      episodeId,
      'reordered',
      userId,
    );
    return episode;
  }

  async deleteEpisode(episodeId: string, userId: string) {
    const episode = await this.prisma.crewEpisode.findUnique({
      where: { id: episodeId },
      include: {
        _count: {
          select: { tasks: true, deliveries: true },
        },
      },
    });
    if (!episode) throw new NotFoundException('Episode not found.');
    await this.authorization.require(
      episode.crewId,
      userId,
      'production.manage',
    );
    if (episode._count.tasks > 0 || episode._count.deliveries > 0) {
      throw new ConflictException({
        code: 'CREW_EPISODE_NOT_EMPTY',
        message:
          'Move its tasks and preserve or replace its delivery history before deleting this episode.',
      });
    }
    await this.prisma.crewEpisode.delete({ where: { id: episodeId } });
    await this.conversations.broadcastCrewTaskProjectChange(
      episode.crewId,
      'episode',
      episodeId,
      'deleted',
      userId,
    );
  }

  async submitDelivery(
    episodeId: string,
    userId: string,
    input: SubmitEpisodeDeliveryInput,
  ) {
    const episode = await this.prisma.crewEpisode.findUnique({
      where: { id: episodeId },
    });
    if (!episode) throw new NotFoundException('Episode not found.');
    await this.authorization.require(
      episode.crewId,
      userId,
      'production.deliver',
    );
    if (episode.status === CrewEpisodeStatus.cancelled) {
      throw new ConflictException({
        message: 'A cancelled episode cannot accept a delivery.',
      });
    }
    await this.assetAccess.requireNodePermission(
      episode.crewId,
      input.assetNodeId,
      userId,
      CrewAssetPermission.view,
    );
    const asset = await this.prisma.crewAssetNode.findFirst({
      where: { id: input.assetNodeId, crewId: episode.crewId },
      include: { mediaAsset: true },
    });
    if (
      !asset ||
      asset.kind !== CrewAssetNodeKind.file ||
      asset.status !== CrewAssetNodeStatus.active ||
      !asset.mediaAsset ||
      asset.mediaAsset.kind !== MediaAssetKind.video ||
      asset.mediaAsset.status !== MediaAssetStatus.ready
    ) {
      throw new BadRequestException({
        message:
          'An episode delivery must use an active, ready video from the crew asset center.',
      });
    }
    const deliveryId = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:episode-delivery:${episodeId}`})::bigint)
      `;
      const aggregate = await tx.crewEpisodeDelivery.aggregate({
        where: { episodeId },
        _max: { versionNumber: true },
      });
      const pending = await tx.crewEpisodeDelivery.findFirst({
        where: {
          episodeId,
          status: CrewEpisodeDeliveryStatus.submitted,
        },
        select: { id: true, versionNumber: true },
      });
      if (pending) {
        throw new ConflictException({
          code: 'CREW_EPISODE_DELIVERY_PENDING',
          message: `Review version ${pending.versionNumber} before submitting another final cut.`,
        });
      }
      const delivery = await tx.crewEpisodeDelivery.create({
        data: {
          crewId: episode.crewId,
          episodeId,
          versionNumber: (aggregate._max.versionNumber ?? 0) + 1,
          assetNodeId: input.assetNodeId,
          note: input.note,
          submittedByUserId: userId,
        },
        select: { id: true },
      });
      await tx.crewEpisode.update({
        where: { id: episodeId },
        data: {
          status: CrewEpisodeStatus.in_review,
          version: { increment: 1 },
        },
      });
      return delivery.id;
    });
    const delivery = await this.findDeliveryDto(deliveryId);
    await this.conversations.broadcastCrewTaskProjectChange(
      episode.crewId,
      'delivery',
      deliveryId,
      'created',
      userId,
    );
    return delivery;
  }

  async reviewDelivery(
    deliveryId: string,
    userId: string,
    input: ReviewEpisodeDeliveryInput,
  ) {
    const current = await this.prisma.crewEpisodeDelivery.findUnique({
      where: { id: deliveryId },
    });
    if (!current) throw new NotFoundException('Episode delivery not found.');
    await this.authorization.require(
      current.crewId,
      userId,
      'production.review',
    );
    await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`crew:episode-delivery:${current.episodeId}`})::bigint)
      `;
      const delivery = await tx.crewEpisodeDelivery.findUniqueOrThrow({
        where: { id: deliveryId },
      });
      if (delivery.status !== CrewEpisodeDeliveryStatus.submitted) {
        throw new ConflictException({
          message: 'This delivery has already been reviewed.',
        });
      }
      if (input.decision === 'approve') {
        const incomplete = await tx.crewTask.count({
          where: {
            deletedAt: null,
            episodeId: delivery.episodeId,
            workflowState: {
              semantic: {
                notIn: [CrewTaskStatus.approved, CrewTaskStatus.cancelled],
              },
            },
          },
        });
        if (incomplete > 0) {
          throw new ConflictException({
            code: 'CREW_EPISODE_TASKS_INCOMPLETE',
            message: `${incomplete} linked task${incomplete === 1 ? '' : 's'} must be completed or cancelled before approving the final delivery.`,
          });
        }
      }
      const reviewedAt = new Date();
      await tx.crewEpisodeDelivery.update({
        where: { id: deliveryId },
        data: {
          status:
            input.decision === 'approve'
              ? CrewEpisodeDeliveryStatus.approved
              : CrewEpisodeDeliveryStatus.rejected,
          reviewNote: input.note,
          reviewedByUserId: userId,
          reviewedAt,
        },
      });
      await tx.crewEpisode.update({
        where: { id: delivery.episodeId },
        data: {
          status:
            input.decision === 'approve'
              ? CrewEpisodeStatus.completed
              : CrewEpisodeStatus.in_production,
          version: { increment: 1 },
        },
      });
    });
    const delivery = await this.findDeliveryDto(deliveryId);
    await this.conversations.broadcastCrewTaskProjectChange(
      current.crewId,
      'delivery',
      deliveryId,
      'updated',
      userId,
    );
    return delivery;
  }

  private lockEpisodes(tx: Prisma.TransactionClient, crewId: string) {
    return tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`crew:episodes:${crewId}`})::bigint)
    `;
  }

  private async resolveEpisodeRank(
    tx: Prisma.TransactionClient,
    crewId: string,
    episodeId: string,
    beforeId: string | null,
    afterId: string | null,
  ) {
    return resolveRank(
      beforeId,
      afterId,
      async (ids) =>
        tx.crewEpisode.findMany({
          where: { crewId, id: { in: ids } },
          select: { id: true, rank: true },
        }),
      async () =>
        tx.crewEpisode.count({
          where: { crewId, id: { not: episodeId } },
        }),
    );
  }

  private async readEpisodes(crewId: string) {
    const [episodes, taskRows] = await Promise.all([
      this.prisma.crewEpisode.findMany({
        where: { crewId },
        include: EPISODE_INCLUDE,
        orderBy: [{ rank: 'asc' }, { id: 'asc' }],
      }),
      this.prisma.crewTask.findMany({
        where: { deletedAt: null, crewId, episodeId: { not: null } },
        select: {
          episodeId: true,
          workflowState: { select: { semantic: true } },
        },
      }),
    ]);
    const counts = new Map<
      string,
      { total: number; completed: number; pendingReview: number }
    >();
    for (const row of taskRows) {
      if (!row.episodeId) continue;
      const value = counts.get(row.episodeId) ?? {
        total: 0,
        completed: 0,
        pendingReview: 0,
      };
      value.total += 1;
      if (row.workflowState.semantic === CrewTaskStatus.approved)
        value.completed += 1;
      if (row.workflowState.semantic === CrewTaskStatus.submitted)
        value.pendingReview += 1;
      counts.set(row.episodeId, value);
    }
    return episodes.map((episode) =>
      episodeDto(episode, counts.get(episode.id)),
    );
  }

  private async findEpisodeDto(episodeId: string) {
    const episode = await this.prisma.crewEpisode.findUnique({
      where: { id: episodeId },
      include: EPISODE_INCLUDE,
    });
    if (!episode) throw new NotFoundException('Episode not found.');
    const rows = await this.prisma.crewTask.findMany({
      where: { deletedAt: null, episodeId },
      select: { workflowState: { select: { semantic: true } } },
    });
    const counts = { total: 0, completed: 0, pendingReview: 0 };
    for (const row of rows) {
      counts.total += 1;
      if (row.workflowState.semantic === CrewTaskStatus.approved)
        counts.completed += 1;
      if (row.workflowState.semantic === CrewTaskStatus.submitted)
        counts.pendingReview += 1;
    }
    return episodeDto(episode, counts);
  }

  private async findDeliveryDto(deliveryId: string) {
    const delivery = await this.prisma.crewEpisodeDelivery.findUnique({
      where: { id: deliveryId },
      include: { assetNode: { include: { mediaAsset: true } } },
    });
    if (!delivery) throw new NotFoundException('Episode delivery not found.');
    return deliveryDto(delivery);
  }
}

async function resolveRank(
  beforeId: string | null,
  afterId: string | null,
  read: (ids: string[]) => Promise<Array<{ id: string; rank: Prisma.Decimal }>>,
  countOthers: () => Promise<number>,
) {
  const ids = [beforeId, afterId].filter((id): id is string => Boolean(id));
  const rows = ids.length > 0 ? await read(ids) : [];
  if (rows.length !== ids.length) {
    throw new ConflictException({
      code: 'CREW_PRODUCTION_REORDER_CONFLICT',
      message: 'One or more reorder anchors are unavailable.',
    });
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  const before = beforeId ? byId.get(beforeId) : undefined;
  const after = afterId ? byId.get(afterId) : undefined;
  if (!before && !after && (await countOthers()) > 0) {
    throw new ConflictException({
      code: 'CREW_PRODUCTION_REORDER_CONFLICT',
      message: 'A non-empty list requires a reorder anchor.',
    });
  }
  if (before && after && before.rank.greaterThanOrEqualTo(after.rank)) {
    throw new ConflictException({
      code: 'CREW_PRODUCTION_REORDER_CONFLICT',
      message: 'Reorder anchors are not in ascending order.',
    });
  }
  if (before && after) return before.rank.plus(after.rank).dividedBy(2);
  if (before) return before.rank.plus(1024);
  if (after) return after.rank.dividedBy(2);
  return new Prisma.Decimal(1024);
}

function studioProjectSummary(project: {
  id: string;
  name: string;
  workspace: { id: string; name: string };
}) {
  return { id: project.id, name: project.name, workspace: project.workspace };
}

function canEditStudioProject(
  workspaceRole: WorkspaceMemberRole,
  projectRole: ProjectMemberRole | null,
) {
  if (
    projectRole === ProjectMemberRole.owner ||
    projectRole === ProjectMemberRole.admin ||
    projectRole === ProjectMemberRole.editor
  ) {
    return true;
  }
  return (
    workspaceRole === WorkspaceMemberRole.owner ||
    workspaceRole === WorkspaceMemberRole.admin ||
    workspaceRole === WorkspaceMemberRole.billing ||
    workspaceRole === WorkspaceMemberRole.editor
  );
}

function productionPageDto(page: {
  crewId: string;
  document: Prisma.JsonValue;
  version: number;
  createdByUserId: string;
  updatedByUserId: string;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    crewId: page.crewId,
    document: page.document,
    version: page.version,
    createdByUserId: page.createdByUserId,
    updatedByUserId: page.updatedByUserId,
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  };
}

function productionPropertiesDto(page: {
  crewId: string;
  status: string;
  priority: string | null;
  leadMemberId: string | null;
  startDate: Date | null;
  startDateGranularity: string;
  targetDate: Date | null;
  targetDateGranularity: string;
  metadataVersion: number;
  updatedByUserId: string;
  updatedAt: Date;
}) {
  return {
    crewId: page.crewId,
    status: page.status,
    priority: page.priority,
    leadMemberId: page.leadMemberId,
    startDate: page.startDate?.toISOString().slice(0, 10) ?? null,
    startDateGranularity: page.startDateGranularity,
    targetDate: page.targetDate?.toISOString().slice(0, 10) ?? null,
    targetDateGranularity: page.targetDateGranularity,
    version: page.metadataVersion,
    updatedByUserId: page.updatedByUserId,
    updatedAt: page.updatedAt.toISOString(),
  };
}

function productionPropertyChanges(
  current: {
    status: string;
    priority: string | null;
    leadMemberId: string | null;
    startDate: Date | null;
    startDateGranularity: string;
    targetDate: Date | null;
    targetDateGranularity: string;
  },
  input: UpdateProductionPropertiesInput,
  resolved: {
    startDate: Date | null;
    startDateGranularity: string;
    targetDate: Date | null;
    targetDateGranularity: string;
  },
) {
  const changes: Array<{
    field: string;
    from: string | null;
    to: string | null;
  }> = [];
  const add = (field: string, from: string | null, to: string | null) => {
    if (from !== to) changes.push({ field, from, to });
  };
  if (input.status !== undefined) add('status', current.status, input.status);
  if (input.priority !== undefined)
    add('priority', current.priority, input.priority);
  if (input.leadMemberId !== undefined) {
    add('lead_member_id', current.leadMemberId, input.leadMemberId);
  }
  if (input.startDate !== undefined) {
    add(
      'start_date',
      projectDateValue(current.startDate),
      projectDateValue(resolved.startDate),
    );
  }
  if (input.startDateGranularity !== undefined) {
    add(
      'start_date_granularity',
      current.startDateGranularity,
      resolved.startDateGranularity,
    );
  }
  if (input.targetDate !== undefined) {
    add(
      'target_date',
      projectDateValue(current.targetDate),
      projectDateValue(resolved.targetDate),
    );
  }
  if (input.targetDateGranularity !== undefined) {
    add(
      'target_date_granularity',
      current.targetDateGranularity,
      resolved.targetDateGranularity,
    );
  }
  return changes;
}

function projectDateValue(value: Date | null) {
  return value?.toISOString().slice(0, 10) ?? null;
}

function productionLabelChanges(
  current: Array<{ id: string; name: string; color: string }>,
  next: Array<{ id: string; name: string; color: string }>,
) {
  const currentIds = new Set(current.map((label) => label.id));
  const nextIds = new Set(next.map((label) => label.id));
  return {
    added: next.filter((label) => !currentIds.has(label.id)),
    removed: current.filter((label) => !nextIds.has(label.id)),
  };
}

function resolveProjectDate(
  input: string | null | undefined,
  current: Date | null,
) {
  if (input === undefined) return current;
  if (input === null) return null;
  return new Date(`${input}T00:00:00.000Z`);
}

function assertCanonicalProjectDate(
  date: Date | null,
  granularity: 'day' | 'month' | 'quarter' | 'half_year' | 'year',
  kind: 'start' | 'target',
) {
  if (!date || granularity === 'day') return;
  const month = date.getUTCMonth();
  const isCanonical =
    date.getUTCDate() === 1 &&
    (granularity === 'month' ||
      (granularity === 'quarter' && month % 3 === 0) ||
      (granularity === 'half_year' && month % 6 === 0) ||
      (granularity === 'year' && month === 0));
  if (!isCanonical) {
    throw new BadRequestException({
      message: `The ${kind} date must align with its selected time granularity.`,
    });
  }
}

function projectPeriodEnd(
  date: Date,
  granularity: 'day' | 'month' | 'quarter' | 'half_year' | 'year',
) {
  if (granularity === 'day') return date;
  const months =
    granularity === 'month'
      ? 1
      : granularity === 'quarter'
        ? 3
        : granularity === 'half_year'
          ? 6
          : 12;
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 0),
  );
}

function productionLinkTitle(value: string) {
  const url = new URL(value);
  const host = url.hostname.replace(/^www\./i, '');
  const path = decodeURIComponent(url.pathname).replace(/^\/+|\/+$/g, '');
  return (path ? `${host}/${path}` : host).slice(0, 180);
}

function productionLabelDto(label: {
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

function productionResourceDto(resource: ProductionResourceRow) {
  return {
    id: resource.id,
    crewId: resource.crewId,
    kind: resource.kind,
    title: resource.title,
    url: resource.url,
    assetNodeId: resource.assetNodeId,
    createdByUserId: resource.createdByUserId,
    createdAt: resource.createdAt.toISOString(),
    updatedAt: resource.updatedAt.toISOString(),
    asset: resource.assetNode
      ? {
          name: resource.assetNode.name,
          kind: resource.assetNode.mediaAsset?.kind ?? null,
          contentType: resource.assetNode.mediaAsset?.contentType ?? null,
        }
      : null,
  };
}

function productionActivityDto(activity: {
  id: string;
  crewId: string;
  kind: string;
  health: string | null;
  content: Prisma.JsonValue | null;
  plainText: string;
  progress: number | null;
  payload: Prisma.JsonValue;
  createdByUserId: string;
  createdAt: Date;
}) {
  return {
    id: activity.id,
    crewId: activity.crewId,
    kind: activity.kind,
    health: activity.health,
    content: activity.content,
    plainText: activity.plainText,
    progress: activity.progress,
    payload: activity.payload,
    createdByUserId: activity.createdByUserId,
    createdAt: activity.createdAt.toISOString(),
  };
}

function episodeDto(
  episode: EpisodeRow,
  taskProgress = { total: 0, completed: 0, pendingReview: 0 },
) {
  return {
    id: episode.id,
    crewId: episode.crewId,
    number: episode.number,
    title: episode.title,
    synopsis: episode.synopsis,
    status: episode.status,
    durationSeconds: episode.durationSeconds,
    plannedReleaseAt: episode.plannedReleaseAt?.toISOString() ?? null,
    rank: episode.rank.toString(),
    version: episode.version,
    createdByUserId: episode.createdByUserId,
    createdAt: episode.createdAt.toISOString(),
    updatedAt: episode.updatedAt.toISOString(),
    taskProgress,
    deliveries: episode.deliveries.map(deliveryDto),
  };
}

function deliveryDto(delivery: {
  id: string;
  episodeId: string;
  versionNumber: number;
  assetNodeId: string;
  status: CrewEpisodeDeliveryStatus;
  note: string;
  reviewNote: string;
  submittedByUserId: string;
  reviewedByUserId: string | null;
  reviewedAt: Date | null;
  createdAt: Date;
  assetNode: {
    name: string;
    mediaAsset: {
      kind: MediaAssetKind;
      contentType: string;
      sizeBytes: bigint | null;
      durationSeconds: number | null;
    } | null;
  };
}) {
  return {
    id: delivery.id,
    episodeId: delivery.episodeId,
    versionNumber: delivery.versionNumber,
    assetNodeId: delivery.assetNodeId,
    status: delivery.status,
    note: delivery.note,
    reviewNote: delivery.reviewNote,
    submittedByUserId: delivery.submittedByUserId,
    reviewedByUserId: delivery.reviewedByUserId,
    reviewedAt: delivery.reviewedAt?.toISOString() ?? null,
    createdAt: delivery.createdAt.toISOString(),
    asset: {
      name: delivery.assetNode.name,
      kind: delivery.assetNode.mediaAsset?.kind ?? null,
      contentType: delivery.assetNode.mediaAsset?.contentType ?? null,
      sizeBytes:
        delivery.assetNode.mediaAsset?.sizeBytes == null
          ? null
          : Number(delivery.assetNode.mediaAsset.sizeBytes),
      durationSeconds: delivery.assetNode.mediaAsset?.durationSeconds ?? null,
    },
  };
}

function productionConflict() {
  return new ConflictException({
    code: 'CREW_PRODUCTION_DOCUMENT_CONFLICT',
    message:
      'This production overview changed in another session. Reload the latest version before editing again.',
  });
}

function productionPropertiesConflict() {
  return new ConflictException({
    code: 'CREW_PRODUCTION_PROPERTIES_CONFLICT',
    message:
      'These project properties changed in another session. Reload the latest version before editing again.',
  });
}

function episodeConflict() {
  return new ConflictException({
    code: 'CREW_EPISODE_CONFLICT',
    message:
      'This episode changed while you were editing it. Reload the latest version.',
  });
}
