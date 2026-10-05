import {
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import {
  StudioDocumentStatus,
  StudioDocumentType,
  PlatformProjectStatus,
  ProjectMemberRole,
  Prisma,
  type StudioDocument,
  type PlatformProjectSection,
} from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { PlatformAuditLogService } from '../workspaces/audit-log.service';
import { enqueueProjectChanged } from '../workspaces/project-realtime';
import { WorkspacePermissionService } from '../workspaces/workspace-permission.service';
import type {
  ArchiveProjectSectionInput,
  CreateProjectSectionInput,
  ReorderProjectSectionsInput,
  UpdateProjectSectionInput,
} from './dto';
import { createProjectSectionWithCanvas } from './project-section.persistence';

type SectionWithDocuments = PlatformProjectSection & {
  documents: StudioDocument[];
};

@Injectable()
export class ProjectSectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: WorkspacePermissionService,
    private readonly audit: PlatformAuditLogService,
  ) {}

  async list(user: AuthUser, projectId: string) {
    const project = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.viewer,
    );
    const sections = await this.readActiveSections(projectId);
    return {
      projectVersion: project.version,
      sections: sections.map((section) => this.sectionDto(section)),
    };
  }

  async create(
    user: AuthUser,
    projectId: string,
    input: CreateProjectSectionInput,
  ) {
    const project = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.editor,
    );
    const created = await this.prisma.$transaction(async (tx) => {
      await this.lockProject(tx, projectId);
      const version = await tx.platformProject.updateMany({
        where: {
          id: projectId,
          status: PlatformProjectStatus.active,
          deletedAt: null,
          version: input.expectedProjectVersion,
        },
        data: {
          version: { increment: 1 },
          updatedById: user.userId,
        },
      });
      if (version.count !== 1) this.projectVersionConflict();

      const last = await tx.platformProjectSection.findFirst({
        where: { projectId, archivedAt: null },
        orderBy: [{ rank: 'desc' }, { createdAt: 'desc' }],
        select: { rank: true },
      });
      const aggregate = await createProjectSectionWithCanvas(tx, {
        workspaceId: project.workspaceId,
        projectId,
        title: input.title,
        rank: (last?.rank ?? -1) + 1,
        actorId: user.userId,
      });
      await enqueueProjectChanged(tx, {
        workspaceId: project.workspaceId,
        projectId,
        action: 'updated',
        actorUserId: user.userId,
      });
      return aggregate;
    });

    await this.audit.record({
      workspaceId: project.workspaceId,
      projectId,
      actorUserId: user.userId,
      action: 'project_section.created',
      entityType: 'project_section',
      entityId: created.section.id,
      after: created.section,
    });
    return this.list(user, projectId);
  }

  async update(
    user: AuthUser,
    projectId: string,
    sectionId: string,
    input: UpdateProjectSectionInput,
  ) {
    const project = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.editor,
    );
    const before = await this.requireActiveSection(projectId, sectionId);
    const updated = await this.prisma.$transaction(async (tx) => {
      // Serialize structural edits before touching chapter or canvas rows.
      // Reorder/archive acquire this same lock before their project-row writes.
      await this.lockProject(tx, projectId);
      const result = await tx.platformProjectSection.updateMany({
        where: {
          id: sectionId,
          projectId,
          archivedAt: null,
          version: input.expectedVersion,
        },
        data: {
          title: input.title,
          version: { increment: 1 },
          updatedById: user.userId,
        },
      });
      if (result.count !== 1) {
        throw new ConflictException({
          code: 'PROJECT_SECTION_VERSION_CONFLICT',
          msg: 'The chapter was modified by another request.',
        });
      }
      await tx.studioDocument.updateMany({
        where: {
          platformProjectId: projectId,
          sectionId,
          type: StudioDocumentType.canvas,
          status: StudioDocumentStatus.active,
          deletedAt: null,
        },
        data: { title: input.title, updatedById: user.userId },
      });
      await tx.platformProject.update({
        where: { id: projectId },
        data: {
          version: { increment: 1 },
          updatedById: user.userId,
        },
      });
      await enqueueProjectChanged(tx, {
        workspaceId: project.workspaceId,
        projectId,
        action: 'updated',
        actorUserId: user.userId,
      });
      return tx.platformProjectSection.findUniqueOrThrow({
        where: { id: sectionId },
        include: { documents: { where: activeCanvasWhere } },
      });
    });

    await this.audit.record({
      workspaceId: project.workspaceId,
      projectId,
      actorUserId: user.userId,
      action: 'project_section.updated',
      entityType: 'project_section',
      entityId: sectionId,
      before,
      after: updated,
    });
    return this.list(user, projectId);
  }

  async reorder(
    user: AuthUser,
    projectId: string,
    input: ReorderProjectSectionsInput,
  ) {
    const project = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.editor,
    );
    if (new Set(input.sectionIds).size !== input.sectionIds.length) {
      throw new ConflictException({
        code: 'PROJECT_SECTION_ORDER_INVALID',
        msg: 'The chapter order contains duplicate chapters.',
      });
    }
    await this.prisma.$transaction(async (tx) => {
      await this.lockProject(tx, projectId);
      const active = await tx.platformProjectSection.findMany({
        where: { projectId, archivedAt: null },
        orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      const actualIds = new Set(active.map(({ id }) => id));
      if (
        actualIds.size !== input.sectionIds.length ||
        input.sectionIds.some((id) => !actualIds.has(id))
      ) {
        throw new ConflictException({
          code: 'PROJECT_SECTION_ORDER_STALE',
          msg: 'The chapter list changed before the order was saved.',
        });
      }
      const version = await tx.platformProject.updateMany({
        where: {
          id: projectId,
          status: PlatformProjectStatus.active,
          deletedAt: null,
          version: input.expectedProjectVersion,
        },
        data: {
          version: { increment: 1 },
          updatedById: user.userId,
        },
      });
      if (version.count !== 1) this.projectVersionConflict();
      for (const [rank, id] of input.sectionIds.entries()) {
        await tx.platformProjectSection.update({
          where: { id },
          data: { rank, updatedById: user.userId },
        });
      }
      await enqueueProjectChanged(tx, {
        workspaceId: project.workspaceId,
        projectId,
        action: 'updated',
        actorUserId: user.userId,
      });
    });
    return this.list(user, projectId);
  }

  async archive(
    user: AuthUser,
    projectId: string,
    sectionId: string,
    input: ArchiveProjectSectionInput,
  ) {
    const project = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.editor,
    );
    const before = await this.requireActiveSection(projectId, sectionId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockProject(tx, projectId);
      const active = await tx.platformProjectSection.findMany({
        where: { projectId, archivedAt: null },
        orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
        select: { id: true },
      });
      if (!active.some(({ id }) => id === sectionId)) {
        throw new NotFoundException({
          code: 'PROJECT_SECTION_NOT_FOUND',
          msg: 'Chapter not found.',
        });
      }
      if (active.length === 1) {
        throw new ConflictException({
          code: 'PROJECT_SECTION_LAST_ACTIVE',
          msg: 'A project must keep at least one active chapter.',
        });
      }
      const now = new Date();
      const section = await tx.platformProjectSection.updateMany({
        where: {
          id: sectionId,
          projectId,
          archivedAt: null,
          version: input.expectedSectionVersion,
        },
        data: {
          archivedAt: now,
          version: { increment: 1 },
          updatedById: user.userId,
        },
      });
      if (section.count !== 1) {
        throw new ConflictException({
          code: 'PROJECT_SECTION_VERSION_CONFLICT',
          msg: 'The chapter was modified by another request.',
        });
      }
      const version = await tx.platformProject.updateMany({
        where: {
          id: projectId,
          version: input.expectedProjectVersion,
          status: PlatformProjectStatus.active,
          deletedAt: null,
        },
        data: {
          version: { increment: 1 },
          updatedById: user.userId,
        },
      });
      if (version.count !== 1) this.projectVersionConflict();
      await tx.studioDocument.updateMany({
        where: {
          platformProjectId: projectId,
          sectionId,
          status: StudioDocumentStatus.active,
          deletedAt: null,
        },
        data: {
          status: StudioDocumentStatus.archived,
          archivedAt: now,
          updatedById: user.userId,
        },
      });
      const remaining = active.filter(({ id }) => id !== sectionId);
      for (const [rank, section] of remaining.entries()) {
        await tx.platformProjectSection.update({
          where: { id: section.id },
          data: { rank },
        });
      }
      await enqueueProjectChanged(tx, {
        workspaceId: project.workspaceId,
        projectId,
        action: 'updated',
        actorUserId: user.userId,
      });
    });

    await this.audit.record({
      workspaceId: project.workspaceId,
      projectId,
      actorUserId: user.userId,
      action: 'project_section.archived',
      entityType: 'project_section',
      entityId: sectionId,
      before,
    });
    return this.list(user, projectId);
  }

  private readActiveSections(projectId: string) {
    return this.prisma.platformProjectSection.findMany({
      where: { projectId, archivedAt: null },
      include: { documents: { where: activeCanvasWhere } },
      orderBy: [{ rank: 'asc' }, { createdAt: 'asc' }],
    });
  }

  private async requireActiveSection(projectId: string, sectionId: string) {
    const section = await this.prisma.platformProjectSection.findFirst({
      where: { id: sectionId, projectId, archivedAt: null },
      include: { documents: { where: activeCanvasWhere } },
    });
    if (!section) {
      throw new NotFoundException({
        code: 'PROJECT_SECTION_NOT_FOUND',
        msg: 'Chapter not found.',
      });
    }
    return section;
  }

  private sectionDto(section: SectionWithDocuments) {
    if (section.documents.length !== 1) {
      throw new InternalServerErrorException({
        code: 'PROJECT_SECTION_CANVAS_INVARIANT_BROKEN',
        msg: 'The chapter must own exactly one active canvas document.',
      });
    }
    return {
      id: section.id,
      projectId: section.projectId,
      title: section.title,
      rank: section.rank,
      version: section.version,
      canvasDocumentId: section.documents[0].id,
      createdAt: section.createdAt.toISOString(),
      updatedAt: section.updatedAt.toISOString(),
    };
  }

  private async lockProject(tx: Prisma.TransactionClient, projectId: string) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext(${`project-sections:${projectId}`})::bigint)
    `;
  }

  private projectVersionConflict(): never {
    throw new ConflictException({
      code: 'PROJECT_VERSION_CONFLICT',
      msg: 'The project structure was modified by another request.',
    });
  }
}

const activeCanvasWhere = {
  type: StudioDocumentType.canvas,
  status: StudioDocumentStatus.active,
  deletedAt: null,
} as const;
