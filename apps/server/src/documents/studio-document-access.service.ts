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

    await this.assertProjectAccess(userId, document, action);
    return document;
  }

  /**
   * Access-check-only edition of {@link requireDocument}: identical boundary,
   * but selects none of the heavy columns. `contentSnapshot` alone can be
   * hundreds of KB (see DocumentCompactionService), so permission probes that
   * never read the document body must not pay for transferring it.
   */
  async requireDocumentRef(
    userId: string,
    documentId: string,
    action: StudioDocumentAction,
  ): Promise<{ id: string }> {
    const document = await this.prisma.studioDocument.findFirst({
      where: {
        id: documentId,
        status: StudioDocumentStatus.active,
        deletedAt: null,
      },
      select: { id: true, platformProjectId: true, storyProjectId: true },
    });
    if (!document) this.notFound();

    await this.assertProjectAccess(userId, document, action);
    return { id: document.id };
  }

  /**
   * Which of `assetIds` the document's content snapshot references. Asset ids
   * are UUIDs, so a plain text-containment check can never produce a false
   * positive between two distinct ids. The snapshot is fetched as text and is
   * never parsed or re-serialized — callers may test a whole canvas batch
   * against one fetch.
   */
  async referencedAssetIds(
    documentId: string,
    assetIds: readonly string[],
  ): Promise<Set<string>> {
    const unique = [...new Set(assetIds)].filter(Boolean);
    if (unique.length === 0) return new Set();
    const rows = await this.prisma.$queryRaw<
      Array<{ snapshot_text: string | null }>
    >`SELECT content_snapshot::text AS snapshot_text
      FROM studio_documents
      WHERE id = ${documentId}::uuid`;
    const snapshotText = rows[0]?.snapshot_text;
    if (!snapshotText) return new Set();
    const referenced = new Set<string>();
    for (const assetId of unique) {
      if (snapshotText.includes(assetId)) referenced.add(assetId);
    }
    return referenced;
  }

  private async assertProjectAccess(
    userId: string,
    document: {
      platformProjectId: string | null;
      storyProjectId: string | null;
    },
    action: StudioDocumentAction,
  ): Promise<void> {
    if (document.platformProjectId) {
      await this.workspacePermissions.requireProjectRole(
        userId,
        document.platformProjectId,
        action === 'read' ? ProjectMemberRole.viewer : ProjectMemberRole.editor,
      );
      return;
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
      return;
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
