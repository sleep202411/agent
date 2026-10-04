import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  StudioDocumentCommentStatus,
  StudioDocumentOperationType,
  StudioDocumentStatus,
  StudioDocumentType,
  StudioDocumentVersionSource,
  ProjectMemberRole,
  type StudioDocument,
  type StudioDocumentComment,
  type StudioDocumentCommentThread,
  type StudioDocumentOperation,
  type StudioDocumentPresence,
  type StudioDocumentVersion,
} from '@prisma/client';
import { Prisma } from '@prisma/client';
import type { AuthUser } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { PlatformAuditLogService } from '../workspaces/audit-log.service';
import { WorkspacePermissionService } from '../workspaces';
import { DocumentCompactionService } from './document-compaction.service';
import { DocumentStateBuilder, encodeDocumentSnapshot } from './document-crdt';
import { readDocumentCrdtState } from './document-persisted-state';
import {
  documentBinaryMediaSnapshot,
  protectDocumentOperationMedia,
  protectNewDocumentMedia,
} from './document-media-retention';
import { rootSchemaFor } from './document-modes';
import { resolveSyncWindow } from './document-sync';
import { StudioDocumentAccessService } from './studio-document-access.service';
import {
  ensureStoryScriptDocumentInTransaction,
  StoryScriptChapterNotFoundError,
} from './story-script-document';
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
    private readonly documentAccess: StudioDocumentAccessService,
    private readonly storyPermissions: StoryPermissionService,
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
    const documents = await this.prisma.studioDocument.findMany({
      where: {
        platformProjectId: projectId,
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
    if (
      input.type === StudioDocumentType.canvas ||
      input.type === StudioDocumentType.storyboard
    ) {
      throw new BadRequestException({
        code: 'SECTION_DOCUMENT_MANAGED',
        msg: 'Canvas and storyboard content are managed through project chapters.',
      });
    }
    const project = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.editor,
    );
    const initialState = encodeInitialState(input.type, input.contentSnapshot);

    const document = await this.prisma.$transaction(async (tx) => {
      await protectNewDocumentMedia(tx, {}, initialState.snapshot);
      const created = await tx.studioDocument.create({
        data: {
          workspaceId: project.workspaceId,
          platformProjectId: projectId,
          type: input.type,
          title: input.title,
          slug: input.slug,
          schemaVersion: input.schemaVersion,
          collaborationDialect: input.collaborationDialect,
          contentSnapshot:
            initialState.snapshot as unknown as Prisma.InputJsonValue,
          crdtState: initialState.state
            ? Buffer.from(initialState.state)
            : null,
          createdById: user.userId,
        },
      });
      const version = await tx.studioDocumentVersion.create({
        data: {
          documentId: created.id,
          versionNumber: 1,
          schemaVersion: created.schemaVersion,
          sequence: 0,
          title: created.title,
          source: StudioDocumentVersionSource.system,
          snapshot: created.contentSnapshot as Prisma.InputJsonValue,
          crdtState: created.crdtState,
          createdById: user.userId,
          metadata: { reason: 'initial_document_version' },
        },
      });
      return tx.studioDocument.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
      });
    });

    await this.audit.record({
      workspaceId: document.workspaceId,
      projectId: document.platformProjectId,
      actorUserId: user.userId,
      action: 'document.created',
      entityType: 'document',
      entityId: document.id,
      after: document,
    });

    return { document: this.documentDto(document) };
  }

  /**
   * Idempotent project-level document bootstrap for modes such as brief or
   * script. Section-owned canvas/storyboard content is deliberately rejected.
   * Concurrency-safe via a pg advisory lock keyed on (project, type).
   */
  async ensurePrimaryDocument(
    user: AuthUser,
    projectId: string,
    type: StudioDocumentType,
  ) {
    if (
      type === StudioDocumentType.canvas ||
      type === StudioDocumentType.storyboard
    ) {
      throw new BadRequestException({
        code: 'SECTION_DOCUMENT_MANAGED',
        msg: 'Canvas and storyboard content are resolved from the active chapter.',
      });
    }
    const project = await this.permissions.requireProjectRole(
      user.userId,
      projectId,
      ProjectMemberRole.viewer,
    );

    const existing = await this.prisma.studioDocument.findFirst({
      where: {
        platformProjectId: projectId,
        type,
        deletedAt: null,
        status: StudioDocumentStatus.active,
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
    const initialState = encodeInitialState(type, {});

    const document = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`document:primary-${type}:${projectId}`})::bigint)
      `;
      // Re-check inside the lock to avoid a race creating two docs.
      const found = await tx.studioDocument.findFirst({
        where: {
          platformProjectId: projectId,
          type,
          deletedAt: null,
          status: StudioDocumentStatus.active,
        },
        orderBy: [{ createdAt: 'asc' }],
      });
      if (found) return found;

      const created = await tx.studioDocument.create({
        data: {
          workspaceId: project.workspaceId,
          platformProjectId: projectId,
          type,
          title: project.name,
          contentSnapshot:
            initialState.snapshot as unknown as Prisma.InputJsonValue,
          crdtState: initialState.state
            ? Buffer.from(initialState.state)
            : null,
          createdById: user.userId,
        },
      });
      const version = await tx.studioDocumentVersion.create({
        data: {
          documentId: created.id,
          versionNumber: 1,
          schemaVersion: created.schemaVersion,
          sequence: 0,
          title: created.title,
          source: StudioDocumentVersionSource.system,
          snapshot: created.contentSnapshot as Prisma.InputJsonValue,
          crdtState: created.crdtState,
          createdById: user.userId,
          metadata: { reason: `initial_${type}` },
        },
      });
      return tx.studioDocument.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
      });
    });

    await this.audit.record({
      workspaceId: document.workspaceId,
      projectId: document.platformProjectId,
      actorUserId: user.userId,
      action: 'document.created',
      entityType: 'document',
      entityId: document.id,
      after: document,
    });

    return { document: this.documentDto(document, { detail: true }) };
  }

  async getDocument(user: AuthUser, documentId: string) {
    const document = await this.documentAccess.requireDocument(
      user.userId,
      documentId,
      'read',
    );
    return { document: this.documentDto(document, { detail: true }) };
  }

  /** Idempotent bootstrap for Story's shared canvas/storyboard document. */
  async ensureStoryCanvasDocument(user: AuthUser, storyProjectId: string) {
    return this.ensureStoryDocument(user, storyProjectId, {
      type: StudioDocumentType.canvas,
      lockKey: 'story-canvas',
      reason: 'initial_story_canvas',
    });
  }

  /** One chapter's free-form screenplay (the chapter pipeline's source). */
  async ensureStoryScriptDocument(
    user: AuthUser,
    storyProjectId: string,
    storyChapterId: string,
  ) {
    const { project } = await this.storyPermissions.requireProject(
      user.userId,
      storyProjectId,
      'story.read',
      { allowArchived: true },
    );
    const chapter = await this.prisma.storyChapter.findFirst({
      where: {
        id: storyChapterId,
        storyProjectId,
        archivedAt: null,
      },
      select: { id: true, title: true },
    });
    if (!chapter) {
      throw new NotFoundException({
        code: 'STORY_CHAPTER_NOT_FOUND',
        msg: 'The active story chapter was not found.',
      });
    }

    const existing = await this.prisma.studioDocument.findFirst({
      where: {
        storyProjectId,
        storyChapterId,
        type: StudioDocumentType.script,
        status: StudioDocumentStatus.active,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      return { document: this.documentDto(existing, { detail: true }) };
    }

    await this.storyPermissions.requireProject(
      user.userId,
      storyProjectId,
      'story.edit',
    );
    let ensured: Awaited<
      ReturnType<typeof ensureStoryScriptDocumentInTransaction>
    >;
    try {
      ensured = await this.prisma.$transaction((tx) =>
        ensureStoryScriptDocumentInTransaction(tx, {
          workspaceId: project.workspaceId,
          storyProjectId,
          storyChapterId,
          actorUserId: user.userId,
        }),
      );
    } catch (error) {
      if (error instanceof StoryScriptChapterNotFoundError) {
        throw new NotFoundException({
          code: 'STORY_CHAPTER_NOT_FOUND',
          msg: 'The active story chapter was not found.',
        });
      }
      throw error;
    }
    const { document } = ensured;

    if (ensured.created) {
      await this.audit.record({
        workspaceId: document.workspaceId,
        projectId: null,
        actorUserId: user.userId,
        action: 'studio_document.created',
        entityType: 'studio_document',
        entityId: document.id,
        after: document,
        metadata: {
          ownerKind: 'story_chapter',
          storyProjectId,
          storyChapterId,
        },
      });
    }
    return { document: this.documentDto(document, { detail: true }) };
  }

  /** Schedule compaction after a trusted cross-domain Yjs operation commits. */
  scheduleCompaction(documentId: string): void {
    this.compaction.schedule(documentId);
  }

  private async ensureStoryDocument(
    user: AuthUser,
    storyProjectId: string,
    kind: { type: StudioDocumentType; lockKey: string; reason: string },
  ) {
    // An archived Story project still opens read-only (the same contract
    // `StoryProjectsService.workbench` honours), so an existing document has
    // to resolve here. Creating one below stays behind the un-widened
    // `story.edit` gate, which keeps archived projects unwritable.
    const { project } = await this.storyPermissions.requireProject(
      user.userId,
      storyProjectId,
      'story.read',
      { allowArchived: true },
    );
    const existing = await this.prisma.studioDocument.findFirst({
      where: {
        storyProjectId,
        type: kind.type,
        status: StudioDocumentStatus.active,
        deletedAt: null,
      },
      orderBy: { createdAt: 'asc' },
    });
    if (existing) {
      return { document: this.documentDto(existing, { detail: true }) };
    }

    await this.storyPermissions.requireProject(
      user.userId,
      storyProjectId,
      'story.edit',
    );
    const initialState = encodeInitialState(kind.type, {});
    const document = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`studio-document:${kind.lockKey}:${storyProjectId}`})::bigint)
      `;
      const found = await tx.studioDocument.findFirst({
        where: {
          storyProjectId,
          type: kind.type,
          status: StudioDocumentStatus.active,
          deletedAt: null,
        },
        orderBy: { createdAt: 'asc' },
      });
      if (found) return found;
      const created = await tx.studioDocument.create({
        data: {
          workspaceId: project.workspaceId,
          storyProjectId,
          type: kind.type,
          title: project.title,
          contentSnapshot:
            initialState.snapshot as unknown as Prisma.InputJsonValue,
          crdtState: Buffer.from(initialState.state!),
          createdById: user.userId,
        },
      });
      const version = await tx.studioDocumentVersion.create({
        data: {
          documentId: created.id,
          versionNumber: 1,
          schemaVersion: created.schemaVersion,
          sequence: 0,
          title: created.title,
          source: StudioDocumentVersionSource.system,
          snapshot: created.contentSnapshot as Prisma.InputJsonValue,
          crdtState: created.crdtState,
          metadata: { reason: kind.reason },
          createdById: user.userId,
        },
      });
      return tx.studioDocument.update({
        where: { id: created.id },
        data: { currentVersionId: version.id },
      });
    });

    await this.audit.record({
      workspaceId: document.workspaceId,
      projectId: null,
      actorUserId: user.userId,
      action: 'studio_document.created',
      entityType: 'studio_document',
      entityId: document.id,
      after: document,
      metadata: { ownerKind: 'story_project', storyProjectId },
    });
    return { document: this.documentDto(document, { detail: true }) };
  }

  async updateDocument(
    user: AuthUser,
    documentId: string,
    input: UpdateDocumentInput,
  ) {
    const before = await this.documentAccess.requireDocument(
      user.userId,
      documentId,
      'edit',
    );
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${documentId}`})::bigint)`;
      if (input.contentSnapshot !== undefined) {
        const current = await tx.studioDocument.findFirst({
          where: { id: documentId, deletedAt: null },
        });
        if (!current) return { count: 0 };
        await protectNewDocumentMedia(
          tx,
          current.contentSnapshot,
          input.contentSnapshot,
        );
      }
      return tx.studioDocument.updateMany({
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
              : (input.status as StudioDocumentStatus),
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
    });
    if (result.count === 0) {
      throw new ConflictException({
        code: 'DOCUMENT_VERSION_CONFLICT',
        msg: 'Document was modified by another request.',
      });
    }

    const document = await this.prisma.studioDocument.findUniqueOrThrow({
      where: { id: documentId },
    });
    await this.audit.record({
      workspaceId: document.workspaceId,
      projectId: document.platformProjectId,
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
    await this.documentAccess.requireDocument(user.userId, documentId, 'read');
    const operations = await this.prisma.studioDocumentOperation.findMany({
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
    const document = await this.documentAccess.requireDocument(
      user.userId,
      documentId,
      'read',
    );
    const window = resolveSyncWindow(afterSequence, document.snapshotSequence);
    const operations = await this.prisma.studioDocumentOperation.findMany({
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
    options?: {
      /** Acquire cross-domain locks before the document advisory lock. */
      onTransactionStart?: (tx: Prisma.TransactionClient) => Promise<void>;
      /**
       * Trusted server hook for a cross-domain receipt. It runs after the
       * operation/document writes but before commit, under the document lock.
       */
      onBeforeCommit?: (
        tx: Prisma.TransactionClient,
        operation: StudioDocumentOperation,
        context: { replayed: boolean },
      ) => Promise<void>;
    },
  ) {
    await this.documentAccess.requireDocument(user.userId, documentId, 'edit');

    const operationType = input.operationType as StudioDocumentOperationType;
    // Two collaboration models share this op log:
    //  • patch/snapshot — NOT a CRDT. The client ships the authoritative
    //    materialized view, persisted inline so the next reader sees it at once,
    //    guarded by optimistic concurrency on baseSequence.
    //  • yjs_update — a CRDT. Updates are commutative (no baseSequence guard);
    //    contentSnapshot and crdtState are derived server-side from the merged op
    //    stream by DocumentCompactionService (the sole crdtState writer) and are
    //    NEVER trusted from the client nor written per-op on the hot path.
    const isCrdt = operationType === StudioDocumentOperationType.yjs_update;

    const result = await this.prisma.$transaction(async (tx) => {
      await options?.onTransactionStart?.(tx);
      // Serialize sequence assignment per document. The body is intentionally
      // tiny (find + small op insert + counter bump) so the lock is held
      // briefly; the expensive merge happens off the hot path in compaction.
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${documentId}`})::bigint)
      `;

      const document = await tx.studioDocument.findFirst({
        where: {
          id: documentId,
          status: StudioDocumentStatus.active,
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
        const existing = await tx.studioDocumentOperation.findFirst({
          where: { documentId, idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          await options?.onBeforeCommit?.(tx, existing, { replayed: true });
          return { operation: existing, scheduleCompaction: false };
        }
      }

      if (
        !isCrdt &&
        (operationType === StudioDocumentOperationType.patch ||
          operationType === StudioDocumentOperationType.snapshot) &&
        input.baseSequence != null &&
        input.baseSequence !== document.currentSequence
      ) {
        throw new ConflictException({
          code: 'DOCUMENT_SEQUENCE_CONFLICT',
          currentSequence: document.currentSequence,
          msg: 'Document changed before this operation could be applied.',
        });
      }

      await protectDocumentOperationMedia(tx, document, input);
      const sequence = document.currentSequence + 1;
      const created = await tx.studioDocumentOperation.create({
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

      await tx.studioDocument.update({
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

      await options?.onBeforeCommit?.(tx, created, { replayed: false });

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
    await this.documentAccess.requireDocument(user.userId, documentId, 'edit');
    const version = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${documentId}`})::bigint)
      `;
      const document = await tx.studioDocument.findFirst({
        where: { id: documentId, deletedAt: null },
      });
      if (!document) {
        throw new NotFoundException({
          code: 'DOCUMENT_NOT_FOUND',
          msg: 'Document not found.',
        });
      }
      // A checkpoint captures acknowledged edits, not merely the last
      // background compaction. Keep the JSON and binary defaults in sync.
      let currentSnapshot = document.contentSnapshot;
      let currentState = document.crdtState;
      let currentMedia: unknown = document.contentSnapshot;
      const schema = rootSchemaFor(document.type);
      if (schema) {
        const state = await readDocumentCrdtState(tx, documentId);
        if (state.crdt_state || state.updates?.length) {
          const builder = new DocumentStateBuilder(state.crdt_state, schema);
          try {
            for (const update of state.updates ?? [])
              builder.apply(Buffer.from(update, 'base64'));
            currentMedia = builder.retainedContent();
            const merged = builder.finish();
            currentSnapshot = merged.snapshot;
            currentState = Buffer.from(merged.state);
          } finally {
            builder.destroy();
          }
        }
      }
      const versionState = input.crdtStateBase64
        ? Buffer.from(input.crdtStateBase64, 'base64')
        : currentState;
      await protectNewDocumentMedia(
        tx,
        [currentSnapshot, currentMedia],
        [
          input.snapshot ?? currentSnapshot,
          documentBinaryMediaSnapshot(document.type, versionState),
        ],
      );
      const last = await tx.studioDocumentVersion.findFirst({
        where: { documentId },
        orderBy: { versionNumber: 'desc' },
      });
      const created = await tx.studioDocumentVersion.create({
        data: {
          documentId,
          versionNumber: (last?.versionNumber ?? 0) + 1,
          schemaVersion: document.schemaVersion,
          sequence: document.currentSequence,
          title: document.title,
          label: input.label,
          source: input.source as StudioDocumentVersionSource,
          sourceId: input.sourceId,
          snapshot:
            (input.snapshot as Prisma.InputJsonValue | undefined) ??
            (currentSnapshot as Prisma.InputJsonValue),
          crdtState: versionState,
          metadata: input.metadata as Prisma.InputJsonValue,
          createdById: user.userId,
        },
      });
      await tx.studioDocument.update({
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
      source: StudioDocumentVersionSource;
      label?: string | null;
      sourceId?: string | null;
      createdById: string;
    },
  ): Promise<string | null> {
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`
        SELECT pg_advisory_xact_lock(hashtext(${`platform-document:${documentId}`})::bigint)
      `;
      const document = await tx.studioDocument.findFirst({
        where: { id: documentId, deletedAt: null },
        select: { schemaVersion: true, currentSequence: true, title: true },
      });
      if (!document) return null;
      const last = await tx.studioDocumentVersion.findFirst({
        where: { documentId },
        orderBy: { versionNumber: 'desc' },
        select: { versionNumber: true },
      });
      const created = await tx.studioDocumentVersion.create({
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
    await this.documentAccess.requireDocument(user.userId, documentId, 'read');
    const versions = await this.prisma.studioDocumentVersion.findMany({
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
    await this.documentAccess.requireDocument(user.userId, documentId, 'read');
    const now = new Date();
    const expiresAt = new Date(now.getTime() + input.ttlSeconds * 1000);
    const presence = await this.prisma.studioDocumentPresence.upsert({
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
    await this.prisma.studioDocumentPresence.deleteMany({
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
    await this.documentAccess.requireDocument(user.userId, documentId, 'read');
    const now = new Date();
    await this.prisma.studioDocumentPresence.deleteMany({
      where: { documentId, expiresAt: { lt: now } },
    });
    const presences = await this.prisma.studioDocumentPresence.findMany({
      where: { documentId, expiresAt: { gte: now } },
      orderBy: { lastSeenAt: 'desc' },
    });
    return {
      presences: presences.map((presence) => this.presenceDto(presence)),
    };
  }

  async listCommentThreads(user: AuthUser, documentId: string) {
    await this.documentAccess.requireDocument(user.userId, documentId, 'read');
    const threads = await this.prisma.studioDocumentCommentThread.findMany({
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
    await this.documentAccess.requireDocument(
      user.userId,
      documentId,
      'comment',
    );
    const thread = await this.prisma.studioDocumentCommentThread.create({
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
    await this.documentAccess.requireDocument(
      user.userId,
      documentId,
      'comment',
    );
    const thread = await this.prisma.studioDocumentCommentThread.findFirst({
      where: { id: threadId, documentId, deletedAt: null },
    });
    if (!thread) {
      throw new NotFoundException({
        code: 'COMMENT_THREAD_NOT_FOUND',
        msg: 'Comment thread not found.',
      });
    }
    const comment = await this.prisma.studioDocumentComment.create({
      data: {
        threadId,
        documentId,
        body: input.body,
        createdById: user.userId,
      },
    });
    await this.prisma.studioDocumentCommentThread.update({
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
    await this.documentAccess.requireDocument(
      user.userId,
      documentId,
      'comment',
    );
    const existing = await this.prisma.studioDocumentCommentThread.findFirst({
      where: { id: threadId, documentId, deletedAt: null },
      select: { id: true },
    });
    if (!existing) {
      throw new NotFoundException({
        code: 'COMMENT_THREAD_NOT_FOUND',
        msg: 'Comment thread not found.',
      });
    }
    const thread = await this.prisma.studioDocumentCommentThread.update({
      where: { id: existing.id },
      data: {
        status: StudioDocumentCommentStatus.resolved,
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

  private documentDto(document: StudioDocument, opts?: { detail?: boolean }) {
    return {
      id: document.id,
      workspaceId: document.workspaceId,
      owner: document.platformProjectId
        ? {
            kind: 'platform_project' as const,
            projectId: document.platformProjectId,
          }
        : {
            kind: 'story_project' as const,
            projectId: document.storyProjectId!,
          },
      platformProjectId: document.platformProjectId,
      storyProjectId: document.storyProjectId,
      storyChapterId: document.storyChapterId,
      sectionId: document.sectionId,
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

  private operationDto(operation: StudioDocumentOperation) {
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

  private versionDto(version: StudioDocumentVersion) {
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

  private presenceDto(presence: StudioDocumentPresence) {
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
    thread: StudioDocumentCommentThread & {
      comments?: StudioDocumentComment[];
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

  private commentDto(comment: StudioDocumentComment) {
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

function encodeInitialState(
  type: StudioDocumentType,
  snapshot: unknown,
): { state: Uint8Array | null; snapshot: Record<string, unknown> } {
  const schema = rootSchemaFor(type);
  if (!schema) {
    return {
      state: null,
      snapshot:
        snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)
          ? (snapshot as Record<string, unknown>)
          : {},
    };
  }
  return encodeDocumentSnapshot(snapshot, schema);
}
