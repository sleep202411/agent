import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  PlatformDocumentCommentStatus,
  PlatformDocumentOperationType,
  PlatformDocumentStatus,
  PlatformDocumentType,
  PlatformDocumentVersionSource,
  ProjectMemberRole,
  type PlatformDocument,
  type PlatformDocumentComment,
  type PlatformDocumentCommentThread,
  type PlatformDocumentOperation,
  type PlatformDocumentPresence,
  type PlatformDocumentVersion,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { PlatformAuditLogService } from '../workspaces/audit-log.service';
import { WorkspacePermissionService } from '../workspaces';
import { DocumentCompactionService } from './document-compaction.service';
import { resolveSyncWindow } from './document-sync';
import type {
  AddCommentInput,
  AppendDocumentOperationInput,
  CreateCommentThreadInput,
  CreateDocumentInput,
  CreateDocumentVersionInput,
  ListDocumentOperationsQuery,
  ListProjectDocumentsQuery,
  UpdateDocumentInput,
  UpsertDocumentPresenceInput,
} from './dto';

@Injectable()
export class DocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly permissions: WorkspacePermissionService,
    private readonly audit: PlatformAuditLogService,
    private readonly compaction: DocumentCompactionService,
  ) {}

  async listProjectDocuments(
    user: AuthUser,
    projectId: string,
    query: ListProjectDocumentsQuery,
  ) {
    await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.viewer,
    );
    const documents = await this.prisma.platformDocument.findMany({
      where: {
        projectId,
        deletedAt: null,
        ...(query.type ? { type: query.type } : {}),
      },
      orderBy: [{ updatedAt: 'desc' }, { createdAt: 'desc' }],
      take: query.limit,
    });
    return {
      documents: documents.map((document) => this.documentDto(document)),
    };
  }

  async createDocument(
    user: AuthUser,
    projectId: string,
    input: CreateDocumentInput,
  ) {
    const project = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.editor,
    );

    const document = await this.prisma.$transaction(async (tx) => {
      const created = await tx.platformDocument.create({
        data: {
          workspaceId: project.workspaceId,
          projectId,
          type: input.type,
          title: input.title,
          slug: input.slug,
          schemaVersion: input.schemaVersion,
          collaborationDialect: input.collaborationDialect,
          contentSnapshot: input.contentSnapshot as Prisma.InputJsonValue,
          createdById: user.userId,
        },
      });
      const version = await tx.platformDocumentVersion.create({
        data: {
          documentId: created.id,
          versionNumber: 1,
          schemaVersion: created.schemaVersion,
          sequence: 0,
          title: created.title,
          source: PlatformDocumentVersionSource.system,
          snapshot: created.contentSnapshot as Prisma.InputJsonValue,
          createdById: user.userId,
          metadata: { reason: 'initial_document_version' },
        },
      });
      return tx.platformDocument.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
      });
    });

    await this.audit.record({
      workspaceId: document.workspaceId,
      projectId: document.projectId,
      actorUserId: user.userId,
      action: 'document.created',
      entityType: 'document',
      entityId: document.id,
      after: document,
    });

    return { document: this.documentDto(document) };
  }

  /**
   * Idempotent — returns the project's primary document of a given mode
   * (`type`), creating it if absent. This is the multi-mode ensure-on-open
   * primitive: a project=entity has at most one primary document per mode
   * (canvas / storyboard / timeline / script …), lazily created when the
   * user first opens that mode. Concurrency-safe via a pg advisory lock
   * keyed on (project, type).
   */
  async ensurePrimaryDocument(
    user: AuthUser,
    projectId: string,
    type: PlatformDocumentType,
  ) {
    const project = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.viewer,
    );

    const existing = await this.prisma.platformDocument.findFirst({
      where: {
        projectId,
        type,
        deletedAt: null,
        status: PlatformDocumentStatus.active,
      },
      orderBy: [{ createdAt: 'asc' }],
    });
    if (existing) {
      return { document: this.documentDto(existing, { detail: true }) };
    }

    await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.editor,
    );

    const document = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`document:primary-${type}:${projectId}`})::bigint)
      `;
      // Re-check inside the lock to avoid a race creating two docs.
      const found = await tx.platformDocument.findFirst({
        where: {
          projectId,
          type,
          deletedAt: null,
          status: PlatformDocumentStatus.active,
        },
        orderBy: [{ createdAt: 'asc' }],
      });
      if (found) return found;

      const created = await tx.platformDocument.create({
        data: {
          workspaceId: project.workspaceId,
          projectId,
          type,
          title: project.name,
          createdById: user.userId,
        },
      });
      const version = await tx.platformDocumentVersion.create({
        data: {
          documentId: created.id,
          versionNumber: 1,
          schemaVersion: created.schemaVersion,
          sequence: 0,
          title: created.title,
          source: PlatformDocumentVersionSource.system,
          snapshot: created.contentSnapshot as Prisma.InputJsonValue,
          createdById: user.userId,
          metadata: { reason: `initial_${type}` },
        },
      });
      return tx.platformDocument.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
      });
    });

    await this.audit.record({
      workspaceId: document.workspaceId,
      projectId: document.projectId,
      actorUserId: user.userId,
      action: 'document.created',
      entityType: 'document',
      entityId: document.id,
      after: document,
    });

    return { document: this.documentDto(document, { detail: true }) };
  }

  /** Back-compat wrapper for the existing storyboard ensure route. */
  async ensurePrimaryStoryboard(user: AuthUser, projectId: string) {
    return this.ensurePrimaryDocument(
      user,
      projectId,
      PlatformDocumentType.storyboard,
    );
  }

  async getDocument(user: AuthUser, documentId: string) {
    const document = await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.viewer,
    );
    return { document: this.documentDto(document, { detail: true }) };
  }

  async updateDocument(
    user: AuthUser,
    documentId: string,
    input: UpdateDocumentInput,
  ) {
    const before = await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.editor,
    );
    const result = await this.prisma.platformDocument.updateMany({
      where: {
        id: documentId,
        deletedAt: null,
        ...(input.expectedVersion == null
          ? {}
          : { version: input.expectedVersion }),
      },
      data: {
        title: input.title,
        slug: input.slug === undefined ? undefined : input.slug,
        status:
          input.status === undefined
            ? undefined
            : (input.status as PlatformDocumentStatus),
        contentSnapshot:
          input.contentSnapshot === undefined
            ? undefined
            : (input.contentSnapshot as Prisma.InputJsonValue),
        archivedAt:
          input.status === 'archived'
            ? new Date()
            : input.status === 'active'
              ? null
              : undefined,
        updatedById: user.userId,
        version: { increment: 1 },
      },
    });
    if (result.count === 0) {
      throw new ConflictException({
        code: 'DOCUMENT_VERSION_CONFLICT',
        msg: 'Document was modified by another request.',
      });
    }

    const document = await this.prisma.platformDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    await this.audit.record({
      workspaceId: document.workspaceId,
      projectId: document.projectId,
      actorUserId: user.userId,
      action: 'document.updated',
      entityType: 'document',
      entityId: document.id,
      before,
      after: document,
    });

    return { document: this.documentDto(document, { detail: true }) };
  }

  async listOperations(
    user: AuthUser,
    documentId: string,
    query: ListDocumentOperationsQuery,
  ) {
    await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.viewer,
    );
    const operations = await this.prisma.platformDocumentOperation.findMany({
      where: {
        documentId,
        sequence: { gt: query.afterSequence },
      },
      orderBy: { sequence: 'asc' },
      take: query.limit,
    });
    return { operations: operations.map((op) => this.operationDto(op)) };
  }

  /**
   * Operations a (re)connecting client must replay, resolved against the
   * compaction horizon. When the client is behind the horizon, `resync.required`
   * is true and it must rebuild from the document's crdtState (carried in the
   * detail DTO) before applying these operations. See {@link resolveSyncWindow}.
   */
  async getOperationSyncWindow(
    user: AuthUser,
    documentId: string,
    afterSequence: number,
    limit: number,
  ) {
    const document = await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.viewer,
    );
    const window = resolveSyncWindow(afterSequence, document.snapshotSequence);
    const operations = await this.prisma.platformDocumentOperation.findMany({
      where: { documentId, sequence: { gt: window.fromSequence } },
      orderBy: { sequence: 'asc' },
      take: Math.min(Math.max(limit, 1), 1000),
    });
    return {
      operations: operations.map((op) => this.operationDto(op)),
      resync: {
        required: window.resyncRequired,
        fromSequence: window.fromSequence,
      },
    };
  }

  async getSyncState(
    user: AuthUser,
    documentId: string,
    afterSequence = 0,
    limit = 500,
  ) {
    const [{ document }, sync, { presences }] = await Promise.all([
      this.getDocument(user, documentId),
      this.getOperationSyncWindow(user, documentId, afterSequence, limit),
      this.listPresence(user, documentId),
    ]);
    return {
      document,
      operations: sync.operations,
      presences,
      resync: sync.resync,
    };
  }

  async appendOperation(
    user: AuthUser,
    documentId: string,
    input: AppendDocumentOperationInput,
  ) {
    await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.editor,
    );

    const operationType = input.operationType as PlatformDocumentOperationType;
    // Two collaboration models share this op log:
    //  • patch/snapshot — NOT a CRDT. The client ships the authoritative
    //    materialized view, persisted inline so the next reader sees it at once,
    //    guarded by optimistic concurrency on baseSequence.
    //  • yjs_update — a CRDT. Updates are commutative (no baseSequence guard);
    //    contentSnapshot and crdtState are derived server-side from the merged op
    //    stream by DocumentCompactionService (the sole crdtState writer) and are
    //    NEVER trusted from the client nor written per-op on the hot path.
    const isCrdt = operationType === PlatformDocumentOperationType.yjs_update;

    const result = await this.prisma.$transaction(async (tx) => {
      // Serialize sequence assignment per document. The body is intentionally
      // tiny (find + small op insert + counter bump) so the lock is held
      // briefly; the expensive merge happens off the hot path in compaction.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${documentId}`})::bigint)
      `;

      const document = await tx.platformDocument.findFirst({
        where: {
          id: documentId,
          status: PlatformDocumentStatus.active,
          deletedAt: null,
        },
      });
      if (!document) {
        throw new NotFoundException({
          code: 'DOCUMENT_NOT_FOUND',
          msg: 'Document not found.',
        });
      }

      if (input.idempotencyKey) {
        const existing = await tx.platformDocumentOperation.findFirst({
          where: { documentId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) return { operation: existing, scheduleCompaction: false };
      }

      if (
        !isCrdt &&
        (operationType === PlatformDocumentOperationType.patch ||
          operationType === PlatformDocumentOperationType.snapshot) &&
        input.baseSequence != null &&
        input.baseSequence !== document.currentSequence
      ) {
        throw new ConflictException({
          code: 'DOCUMENT_SEQUENCE_CONFLICT',
          currentSequence: document.currentSequence,
          msg: 'Document changed before this operation could be applied.',
        });
      }

      const sequence = document.currentSequence + 1;
      const created = await tx.platformDocumentOperation.create({
        data: {
          documentId,
          sequence,
          operationType,
          actorUserId: user.userId,
          clientMutationId: input.clientMutationId,
          idempotencyKey: input.idempotencyKey,
          baseSequence: input.baseSequence,
          patch: jsonOrNull(input.patch),
          yjsUpdate: input.yjsUpdateBase64
            ? Buffer.from(input.yjsUpdateBase64, 'base64')
            : null,
          snapshot: jsonOrNull(input.snapshot),
          metadata: input.metadata as Prisma.InputJsonValue,
        },
      });

      const materializedContent = isCrdt
        ? undefined
        : (input.materializedContent ?? input.snapshot);

      await tx.platformDocument.update({
        where: { id: documentId },
        data: {
          currentSequence: sequence,
          // Only non-CRDT docs persist a client-materialized snapshot inline.
          // CRDT docs leave contentSnapshot/crdtState to compaction.
          contentSnapshot:
            materializedContent === undefined
              ? undefined
              : (materializedContent as Prisma.InputJsonValue),
          updatedById: user.userId,
          version: { increment: 1 },
        },
      });

      return { operation: created, scheduleCompaction: isCrdt };
    });

    if (result.scheduleCompaction) {
      // Off the hot path: fold the new op into crdtState + contentSnapshot.
      this.compaction.schedule(documentId);
    }

    return { operation: this.operationDto(result.operation) };
  }

  async createVersion(
    user: AuthUser,
    documentId: string,
    input: CreateDocumentVersionInput,
  ) {
    await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.editor,
    );
    const version = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${documentId}`})::bigint)
      `;
      const document = await tx.platformDocument.findFirst({
        where: { id: documentId, deletedAt: null },
      });
      if (!document) {
        throw new NotFoundException({
          code: 'DOCUMENT_NOT_FOUND',
          msg: 'Document not found.',
        });
      }
      const last = await tx.platformDocumentVersion.findFirst({
        where: { documentId },
        orderBy: { versionNumber: 'desc' },
      });
      const created = await tx.platformDocumentVersion.create({
        data: {
          documentId,
          versionNumber: (last?.versionNumber ?? 0) + 1,
          schemaVersion: document.schemaVersion,
          sequence: document.currentSequence,
          title: document.title,
          label: input.label,
          source: input.source as PlatformDocumentVersionSource,
          sourceId: input.sourceId,
          snapshot:
            (input.snapshot as Prisma.InputJsonValue | undefined) ??
            (document.contentSnapshot as Prisma.InputJsonValue),
          crdtState: input.crdtStateBase64
            ? Buffer.from(input.crdtStateBase64, 'base64')
            : document.crdtState,
          metadata: input.metadata as Prisma.InputJsonValue,
          createdById: user.userId,
        },
      });
      await tx.platformDocument.update({
        where: { id: documentId },
        data: {
          currentVersionId: created.id,
          updatedById: user.userId,
          version: { increment: 1 },
        },
      });
      return created;
    });
    return { version: this.versionDto(version) };
  }

  /**
   * Append a system-authored version row WITHOUT an auth check — for trusted
   * background producers (e.g. the AI worker logging an 'ai' activity entry).
   * Lightweight: an empty snapshot + null crdtState (an activity marker is a
   * who/when/what log entry, not a restore point) and it does NOT advance the
   * document's currentVersionId. Returns the new version id, or null if the
   * document is gone.
   */
  async createSystemVersion(
    documentId: string,
    input: {
      source: PlatformDocumentVersionSource;
      label?: string | null;
      sourceId?: string | null;
      createdById: string;
    },
  ): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${documentId}`})::bigint)
      `;
      const document = await tx.platformDocument.findFirst({
        where: { id: documentId, deletedAt: null },
        select: { schemaVersion: true, currentSequence: true, title: true },
      });
      if (!document) return null;
      const last = await tx.platformDocumentVersion.findFirst({
        where: { documentId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const created = await tx.platformDocumentVersion.create({
        data: {
          documentId,
          versionNumber: (last?.versionNumber ?? 0) + 1,
          schemaVersion: document.schemaVersion,
          sequence: document.currentSequence,
          title: document.title,
          label: input.label?.slice(0, 120) ?? null,
          source: input.source,
          sourceId: input.sourceId ?? null,
          snapshot: {},
          crdtState: null,
          metadata: {},
          createdById: input.createdById,
        },
        select: { id: true },
      });
      return created.id;
    });
  }

  async listVersions(user: AuthUser, documentId: string) {
    await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.viewer,
    );
    const versions = await this.prisma.platformDocumentVersion.findMany({
      where: { documentId },
      orderBy: { versionNumber: 'desc' },
      take: 100,
    });
    return { versions: versions.map((version) => this.versionDto(version)) };
  }

  async upsertPresence(
    user: AuthUser,
    documentId: string,
    input: UpsertDocumentPresenceInput,
  ) {
    await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.viewer,
    );
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    const presence = await this.prisma.platformDocumentPresence.upsert({
      where: {
        documentId_userId_connectionId: {
          documentId,
          userId: user.userId,
          connectionId: input.connectionId,
        },
      },
      create: {
        documentId,
        userId: user.userId,
        connectionId: input.connectionId,
        cursor: jsonOrNull(input.cursor),
        selection: jsonOrNull(input.selection),
        metadata: input.metadata as Prisma.InputJsonValue,
        lastSeenAt: now,
        expiresAt,
      },
      update: {
        cursor: jsonOrNull(input.cursor),
        selection: jsonOrNull(input.selection),
        metadata: input.metadata as Prisma.InputJsonValue,
        lastSeenAt: now,
        expiresAt,
      },
    });
    return { presence: this.presenceDto(presence) };
  }

  async removePresence(
    user: AuthUser,
    documentId: string,
    connectionId: string,
  ) {
    await this.prisma.platformDocumentPresence.deleteMany({
      where: { documentId, userId: user.userId, connectionId },
    });
    return {
      presence: {
        documentId,
        userId: user.userId,
        connectionId,
      },
    };
  }

  async listPresence(user: AuthUser, documentId: string) {
    await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.viewer,
    );
    const now = new Date();
    await this.prisma.platformDocumentPresence.deleteMany({
      where: { documentId, expiresAt: { lt: now } },
    });
    const presences = await this.prisma.platformDocumentPresence.findMany({
      where: { documentId, expiresAt: { gte: now } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return {
      presences: presences.map((presence) => this.presenceDto(presence)),
    };
  }

  async listCommentThreads(user: AuthUser, documentId: string) {
    await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.viewer,
    );
    const threads = await this.prisma.platformDocumentCommentThread.findMany({
      where: { documentId, deletedAt: null },
      include: {
        comments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ status: 'asc' }, { updatedAt: 'desc' }],
    });
    return {
      threads: threads.map((thread) => this.commentThreadDto(thread)),
    };
  }

  async createCommentThread(
    user: AuthUser,
    documentId: string,
    input: CreateCommentThreadInput,
  ) {
    await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.editor,
    );
    const thread = await this.prisma.platformDocumentCommentThread.create({
      data: {
        documentId,
        blockId: input.blockId,
        anchor: jsonOrNull(input.anchor),
        title: input.title,
        createdById: user.userId,
        comments: {
          create: {
            documentId,
            body: input.body,
            createdById: user.userId,
          },
        },
      },
      include: { comments: true },
    });
    return { thread: this.commentThreadDto(thread) };
  }

  async addComment(
    user: AuthUser,
    documentId: string,
    threadId: string,
    input: AddCommentInput,
  ) {
    await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.editor,
    );
    const thread = await this.prisma.platformDocumentCommentThread.findFirst({
      where: { id: threadId, documentId, deletedAt: null },
    });
    if (!thread) {
      throw new NotFoundException({
        code: 'COMMENT_THREAD_NOT_FOUND',
        msg: 'Comment thread not found.',
      });
    }
    const comment = await this.prisma.platformDocumentComment.create({
      data: {
        threadId,
        documentId,
        body: input.body,
        createdById: user.userId,
      },
    });
    await this.prisma.platformDocumentCommentThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
    });
    return { comment: this.commentDto(comment) };
  }

  async resolveCommentThread(
    user: AuthUser,
    documentId: string,
    threadId: string,
  ) {
    await this.permissions.requireDocumentRole(
      user.userId,
      documentId,
      ProjectMemberRole.editor,
    );
    const existing = await this.prisma.platformDocumentCommentThread.findFirst({
      where: { id: threadId, documentId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'COMMENT_THREAD_NOT_FOUND',
        msg: 'Comment thread not found.',
      });
    }
    const thread = await this.prisma.platformDocumentCommentThread.update({
      where: { id: existing.id },
      data: {
        status: PlatformDocumentCommentStatus.resolved,
        resolvedById: user.userId,
        resolvedAt: new Date(),
      },
      include: {
        comments: {
          where: { deletedAt: null },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    return { thread: this.commentThreadDto(thread) };
  }

  private documentDto(document: PlatformDocument, opts?: { detail?: boolean }) {
    return {
      id: document.id,
      workspaceId: document.workspaceId,
      projectId: document.projectId,
      type: document.type,
      status: document.status,
      title: document.title,
      slug: document.slug,
      schemaVersion: document.schemaVersion,
      collaborationDialect: document.collaborationDialect,
      collaborationRoomId: document.collaborationRoomId,
      currentSequence: document.currentSequence,
      // The op sequence already folded into crdtState — a CRDT client bootstraps
      // by loading crdtState then replaying operations after this sequence.
      snapshotSequence: document.snapshotSequence,
      currentVersionId: document.currentVersionId,
      version: document.version,
      contentSnapshot: opts?.detail ? document.contentSnapshot : undefined,
      // Compacted CRDT state (detail only — omitted from list payloads and null
      // for non-CRDT documents like the storyboard).
      crdtStateBase64:
        opts?.detail && document.crdtState
          ? Buffer.from(document.crdtState).toString('base64')
          : undefined,
      lastCompactedAt: document.lastCompactedAt?.toISOString() ?? null,
      createdById: document.createdById,
      updatedById: document.updatedById,
      createdAt: document.createdAt.toISOString(),
      updatedAt: document.updatedAt.toISOString(),
      archivedAt: document.archivedAt?.toISOString() ?? null,
    };
  }

  private operationDto(operation: PlatformDocumentOperation) {
    return {
      id: operation.id,
      documentId: operation.documentId,
      sequence: operation.sequence,
      operationType: operation.operationType,
      actorUserId: operation.actorUserId,
      clientMutationId: operation.clientMutationId,
      baseSequence: operation.baseSequence,
      patch: operation.patch,
      yjsUpdateBase64: operation.yjsUpdate
        ? Buffer.from(operation.yjsUpdate).toString('base64')
        : undefined,
      snapshot: operation.snapshot,
      metadata: operation.metadata,
      createdAt: operation.createdAt.toISOString(),
    };
  }

  private versionDto(version: PlatformDocumentVersion) {
    return {
      id: version.id,
      documentId: version.documentId,
      versionNumber: version.versionNumber,
      schemaVersion: version.schemaVersion,
      sequence: version.sequence,
      title: version.title,
      label: version.label,
      source: version.source,
      sourceId: version.sourceId,
      snapshot: version.snapshot,
      crdtStateBase64: version.crdtState
        ? Buffer.from(version.crdtState).toString('base64')
        : undefined,
      metadata: version.metadata,
      createdById: version.createdById,
      createdAt: version.createdAt.toISOString(),
    };
  }

  private presenceDto(presence: PlatformDocumentPresence) {
    return {
      id: presence.id,
      documentId: presence.documentId,
      userId: presence.userId,
      connectionId: presence.connectionId,
      cursor: presence.cursor,
      selection: presence.selection,
      metadata: presence.metadata,
      lastSeenAt: presence.lastSeenAt.toISOString(),
      expiresAt: presence.expiresAt.toISOString(),
    };
  }

  private commentThreadDto(
    thread: PlatformDocumentCommentThread & {
      comments?: PlatformDocumentComment[];
    },
  ) {
    return {
      id: thread.id,
      documentId: thread.documentId,
      blockId: thread.blockId,
      anchor: thread.anchor,
      title: thread.title,
      status: thread.status,
      createdById: thread.createdById,
      resolvedById: thread.resolvedById,
      resolvedAt: thread.resolvedAt?.toISOString() ?? null,
      createdAt: thread.createdAt.toISOString(),
      updatedAt: thread.updatedAt.toISOString(),
      comments:
        thread.comments?.map((comment) => this.commentDto(comment)) ?? [],
    };
  }

  private commentDto(comment: PlatformDocumentComment) {
    return {
      id: comment.id,
      threadId: comment.threadId,
      documentId: comment.documentId,
      body: comment.body,
      createdById: comment.createdById,
      createdAt: comment.createdAt.toISOString(),
      editedAt: comment.editedAt?.toISOString() ?? null,
    };
  }
}

function jsonOrNull(
  value: Record<string, unknown> | undefined,
): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return value === undefined ? Prisma.DbNull : (value as Prisma.InputJsonValue);
}
