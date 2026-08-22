import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  AddCommentSchema,
  AppendDocumentOperationSchema,
  CreateCommentThreadSchema,
  CreateDocumentSchema,
  CreateDocumentVersionSchema,
  DocumentParamsSchema,
  DocumentThreadParamsSchema,
  ListDocumentOperationsQuerySchema,
  ListProjectDocumentsQuerySchema,
  ProjectDocumentEnsureParamsSchema,
  ProjectDocumentsParamsSchema,
  StoryCanvasDocumentParamsSchema,
  StoryChapterDocumentParamsSchema,
  UpdateDocumentSchema,
  UpsertDocumentPresenceSchema,
  type AddCommentInput,
  type AppendDocumentOperationInput,
  type CreateCommentThreadInput,
  type CreateDocumentInput,
  type CreateDocumentVersionInput,
  type DocumentParams,
  type DocumentThreadParams,
  type ListDocumentOperationsQuery,
  type ListProjectDocumentsQuery,
  type ProjectDocumentEnsureParams,
  type ProjectDocumentsParams,
  type StoryCanvasDocumentParams,
  type StoryChapterDocumentParams,
  type UpdateDocumentInput,
  type UpsertDocumentPresenceInput,
} from './dto';
import { DocumentsService } from './documents.service';

@Controller()
export class DocumentsController {
  constructor(private readonly documents: DocumentsService) {}

  @Get('projects/:projectId/documents')
  async listProjectDocuments(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectDocumentsParamsSchema))
    params: ProjectDocumentsParams,
    @Query(new ZodValidationPipe(ListProjectDocumentsQuerySchema))
    query: ListProjectDocumentsQuery,
  ) {
    return {
      code: 200,
      data: await this.documents.listProjectDocuments(
        user,
        params.projectId,
        query,
      ),
    };
  }

  @Post('projects/:projectId/documents')
  async createDocument(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectDocumentsParamsSchema))
    params: ProjectDocumentsParams,
    @Body(new ZodValidationPipe(CreateDocumentSchema))
    body: CreateDocumentInput,
  ) {
    return {
      code: 200,
      data: await this.documents.createDocument(user, params.projectId, body),
    };
  }

  /**
   * Idempotent bootstrap for a project-level document mode. Returns the detail DTO (incl.
   * crdtStateBase64 + snapshotSequence) so a CRDT client can rebuild and then
   * replay operations after the snapshot horizon. POST — has a write side effect.
   */
  @Post('projects/:projectId/documents/:type/ensure')
  async ensurePrimaryDocument(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(ProjectDocumentEnsureParamsSchema))
    params: ProjectDocumentEnsureParams,
  ) {
    return {
      code: 200,
      data: await this.documents.ensurePrimaryDocument(
        user,
        params.projectId,
        params.type,
      ),
    };
  }

  @Get('documents/:documentId')
  async getDocument(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentParamsSchema)) params: DocumentParams,
  ) {
    return {
      code: 200,
      data: await this.documents.getDocument(user, params.documentId),
    };
  }

  @Post('story-projects/:projectId/documents/canvas/ensure')
  async ensureStoryCanvasDocument(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryCanvasDocumentParamsSchema))
    params: StoryCanvasDocumentParams,
  ) {
    return {
      code: 200,
      data: await this.documents.ensureStoryCanvasDocument(
        user,
        params.projectId,
      ),
    };
  }

  @Post('story-projects/:projectId/chapters/:chapterId/documents/script/ensure')
  async ensureStoryScriptDocument(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StoryChapterDocumentParamsSchema))
    params: StoryChapterDocumentParams,
  ) {
    return {
      code: 200,
      data: await this.documents.ensureStoryScriptDocument(
        user,
        params.projectId,
        params.chapterId,
      ),
    };
  }

  @Patch('documents/:documentId')
  async updateDocument(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentParamsSchema)) params: DocumentParams,
    @Body(new ZodValidationPipe(UpdateDocumentSchema))
    body: UpdateDocumentInput,
  ) {
    return {
      code: 200,
      data: await this.documents.updateDocument(user, params.documentId, body),
    };
  }

  @Get('documents/:documentId/operations')
  async listOperations(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentParamsSchema)) params: DocumentParams,
    @Query(new ZodValidationPipe(ListDocumentOperationsQuerySchema))
    query: ListDocumentOperationsQuery,
  ) {
    return {
      code: 200,
      data: await this.documents.listOperations(user, params.documentId, query),
    };
  }

  @Post('documents/:documentId/operations')
  async appendOperation(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentParamsSchema)) params: DocumentParams,
    @Body(new ZodValidationPipe(AppendDocumentOperationSchema))
    body: AppendDocumentOperationInput,
  ) {
    return {
      code: 200,
      data: await this.documents.appendOperation(user, params.documentId, body),
    };
  }

  @Post('documents/:documentId/versions')
  async createVersion(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentParamsSchema)) params: DocumentParams,
    @Body(new ZodValidationPipe(CreateDocumentVersionSchema))
    body: CreateDocumentVersionInput,
  ) {
    return {
      code: 200,
      data: await this.documents.createVersion(user, params.documentId, body),
    };
  }

  @Get('documents/:documentId/versions')
  async listVersions(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentParamsSchema)) params: DocumentParams,
  ) {
    return {
      code: 200,
      data: await this.documents.listVersions(user, params.documentId),
    };
  }

  @Get('documents/:documentId/presence')
  async listPresence(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentParamsSchema)) params: DocumentParams,
  ) {
    return {
      code: 200,
      data: await this.documents.listPresence(user, params.documentId),
    };
  }

  @Post('documents/:documentId/presence')
  async upsertPresence(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentParamsSchema)) params: DocumentParams,
    @Body(new ZodValidationPipe(UpsertDocumentPresenceSchema))
    body: UpsertDocumentPresenceInput,
  ) {
    return {
      code: 200,
      data: await this.documents.upsertPresence(user, params.documentId, body),
    };
  }

  @Get('documents/:documentId/comments')
  async listCommentThreads(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentParamsSchema)) params: DocumentParams,
  ) {
    return {
      code: 200,
      data: await this.documents.listCommentThreads(user, params.documentId),
    };
  }

  @Post('documents/:documentId/comments')
  async createCommentThread(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentParamsSchema)) params: DocumentParams,
    @Body(new ZodValidationPipe(CreateCommentThreadSchema))
    body: CreateCommentThreadInput,
  ) {
    return {
      code: 200,
      data: await this.documents.createCommentThread(
        user,
        params.documentId,
        body,
      ),
    };
  }

  @Post('documents/:documentId/comments/:threadId/replies')
  async addComment(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentThreadParamsSchema))
    params: DocumentThreadParams,
    @Body(new ZodValidationPipe(AddCommentSchema)) body: AddCommentInput,
  ) {
    return {
      code: 200,
      data: await this.documents.addComment(
        user,
        params.documentId,
        params.threadId,
        body,
      ),
    };
  }

  @Post('documents/:documentId/comments/:threadId/resolve')
  async resolveCommentThread(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(DocumentThreadParamsSchema))
    params: DocumentThreadParams,
  ) {
    return {
      code: 200,
      data: await this.documents.resolveCommentThread(
        user,
        params.documentId,
        params.threadId,
      ),
    };
  }
}
