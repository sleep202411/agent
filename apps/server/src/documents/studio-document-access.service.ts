import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ProjectMemberRole,
  StudioDocumentStatus,
  type StudioDocument,
} from '@prisma/client';
import { PrismaService } from '../infra/db/db.module';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { WorkspacePermissionService } from '../workspaces';

export type StudioDocumentAction = 'read' | 'edit' | 'comment' | 'generate';

/**
 * Owner-neutral authorization boundary for every collaborative Studio document.
 * A document has exactly one durable owner FK, so callers never infer scope from
 * a route, a client-provided kind, or a synthetic Platform project.
 */
@Injectable()
export class StudioDocumentAccessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly storyPermissions: StoryPermissionService,
  ) {}

  async requireDocument(
    userId: string,
    documentId: string,
    action: StudioDocumentAction,
  ): Promise<StudioDocument> {
    const document = await this.prisma.studioDocument.findFirst({
      where: {
        id: documentId,
        status: StudioDocumentStatus.active,
        deletedAt: null,
      },
    });
    if (!document) this.notFound();

    if (document.platformProjectId) {
      await this.workspacePermissions.requireProjectRole(
        userId,
        document.platformProjectId,
        action === 'read' ? ProjectMemberRole.viewer : ProjectMemberRole.editor,
      );
      return document;
    }

    if (document.storyProjectId) {
      await this.storyPermissions.requireProject(
        userId,
        document.storyProjectId,
        action === 'read'
          ? 'story.read'
          : action === 'comment'
            ? 'story.review'
            : action === 'generate'
              ? 'story.generate'
              : 'story.edit',
        // Read-only for archived: `requireProject` gates archived purely on
        // this flag — the write guard it runs afterwards is the agent-run
        // fence, not an archive fence — so widening it for anything but
        // `read` would make an archived project editable.
        { allowArchived: action === 'read' },
      );
      return document;
    }

    // The database CHECK makes this unreachable; fail closed if corrupted data
    // is ever observed instead of accidentally treating it as workspace-wide.
    this.notFound();
  }

  private notFound(): never {
    throw new NotFoundException({
      code: 'DOCUMENT_NOT_FOUND',
      msg: 'Studio document not found.',
    });
  }
}
