import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  ApproveFilmReferenceVersionSchema,
  CreateFilmReferenceReviewSchema,
  CreateFilmReferenceSlotsBatchSchema,
  CreateFilmReferenceVersionSchema,
  PutFilmClipReferencesSchema,
  PutFilmReferenceSlotSchema,
  StoryFilmClipParamsSchema,
  StoryFilmReferenceSlotParamsSchema,
  StoryFilmReferenceVersionParamsSchema,
  StoryRevisionParamsSchema,
  StoryUuidSchema,
  type ApproveFilmReferenceVersionInput,
  type CreateFilmReferenceReviewInput,
  type CreateFilmReferenceSlotsBatchInput,
  type CreateFilmReferenceVersionInput,
  type PutFilmClipReferencesInput,
  type PutFilmReferenceSlotInput,
  type StoryFilmClipParams,
  type StoryFilmReferenceSlotParams,
  type StoryFilmReferenceVersionParams,
  type StoryRevisionParams,
} from './dto';
import { StoryFilmReferenceService } from './story-film-reference.service';

@Controller('story-projects')
export class StoryFilmReferenceController {
  constructor(private readonly references: StoryFilmReferenceService) {}

  @Get(':projectId/revisions/:revisionId/reference-slots')
  async listSlots(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryRevisionParamsSchema))
    params: StoryRevisionParams,
  ) {
    return {
      code: 200,
      data: await this.references.listSlots(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.revisionId,
      ),
    };
  }

  @Post(':projectId/revisions/:revisionId/reference-slots')
  @HttpCode(HttpStatus.CREATED)
  async createSlots(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryRevisionParamsSchema))
    params: StoryRevisionParams,
    @Body(new ZodValidationPipe(CreateFilmReferenceSlotsBatchSchema))
    body: CreateFilmReferenceSlotsBatchInput,
  ) {
    return {
      code: 200,
      data: await this.references.createSlots(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.revisionId,
        body,
      ),
    };
  }

  @Put(':projectId/revisions/:revisionId/reference-slots/:slotId')
  async putSlot(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmReferenceSlotParamsSchema))
    params: StoryFilmReferenceSlotParams,
    @Body(new ZodValidationPipe(PutFilmReferenceSlotSchema))
    body: PutFilmReferenceSlotInput,
  ) {
    return {
      code: 200,
      data: await this.references.putSlot(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.revisionId,
        params.slotId,
        body,
      ),
    };
  }

  @Get(':projectId/revisions/:revisionId/reference-slots/:slotId/versions')
  async listVersions(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmReferenceSlotParamsSchema))
    params: StoryFilmReferenceSlotParams,
  ) {
    return {
      code: 200,
      data: await this.references.listVersions(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.revisionId,
        params.slotId,
      ),
    };
  }

  @Post(':projectId/revisions/:revisionId/reference-slots/:slotId/versions')
  @HttpCode(HttpStatus.CREATED)
  async createVersion(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Headers('idempotency-key') idempotency: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmReferenceSlotParamsSchema))
    params: StoryFilmReferenceSlotParams,
    @Body(new ZodValidationPipe(CreateFilmReferenceVersionSchema))
    body: CreateFilmReferenceVersionInput,
  ) {
    return {
      code: 200,
      data: await this.references.createVersion(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.revisionId,
        params.slotId,
        body,
        requiredIdempotencyKey(idempotency),
      ),
    };
  }

  @Post(
    ':projectId/revisions/:revisionId/reference-slots/:slotId/versions/:referenceVersionId/reviews',
  )
  @HttpCode(HttpStatus.CREATED)
  async reviewVersion(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmReferenceVersionParamsSchema))
    params: StoryFilmReferenceVersionParams,
    @Body(new ZodValidationPipe(CreateFilmReferenceReviewSchema))
    body: CreateFilmReferenceReviewInput,
  ) {
    return {
      code: 200,
      data: await this.references.reviewVersion(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.revisionId,
        params.slotId,
        params.referenceVersionId,
        body,
      ),
    };
  }

  @Post(':projectId/revisions/:revisionId/reference-slots/:slotId/approval')
  @HttpCode(HttpStatus.CREATED)
  async approveVersion(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmReferenceSlotParamsSchema))
    params: StoryFilmReferenceSlotParams,
    @Body(new ZodValidationPipe(ApproveFilmReferenceVersionSchema))
    body: ApproveFilmReferenceVersionInput,
  ) {
    return {
      code: 200,
      data: await this.references.approveVersion(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.revisionId,
        params.slotId,
        body,
      ),
    };
  }

  @Put(':projectId/revisions/:revisionId/clips/:clipId/references')
  async putClipReferences(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryFilmClipParamsSchema))
    params: StoryFilmClipParams,
    @Body(new ZodValidationPipe(PutFilmClipReferencesSchema))
    body: PutFilmClipReferencesInput,
  ) {
    return {
      code: 200,
      data: await this.references.putClipReferences(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.revisionId,
        params.clipId,
        body,
      ),
    };
  }
}

function requiredWorkspaceId(value: string | string[] | undefined): string {
  const normalized = firstHeader(value)?.trim();
  const parsed = StoryUuidSchema.safeParse(normalized);
  if (!parsed.success) {
    throw new BadRequestException({
      code: normalized
        ? 'WORKSPACE_HEADER_INVALID'
        : 'WORKSPACE_HEADER_REQUIRED',
      message: normalized
        ? 'x-fizz-workspace-id must be a valid UUID.'
        : 'x-fizz-workspace-id is required.',
    });
  }
  return parsed.data;
}

function requiredIdempotencyKey(value: string | string[] | undefined): string {
  const normalized = firstHeader(value)?.trim();
  if (!normalized || normalized.length > 160) {
    throw new BadRequestException({
      code: normalized ? 'IDEMPOTENCY_KEY_INVALID' : 'IDEMPOTENCY_KEY_REQUIRED',
      message: normalized
        ? 'Idempotency-Key must be at most 160 characters.'
        : 'Idempotency-Key is required for reference candidates.',
    });
  }
  return normalized;
}

function firstHeader(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}
