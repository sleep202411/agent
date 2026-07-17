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
  ApproveStoryReferenceVersionSchema,
  CreateStoryReferenceReviewSchema,
  CreateStoryReferenceSlotsBatchSchema,
  CreateStoryReferenceVersionSchema,
  PutStoryReferenceSlotSchema,
  StoryProjectIdParamsSchema,
  StoryReferenceSlotParamsSchema,
  StoryReferenceVersionParamsSchema,
  StoryUuidSchema,
  type ApproveStoryReferenceVersionInput,
  type CreateStoryReferenceReviewInput,
  type CreateStoryReferenceSlotsBatchInput,
  type CreateStoryReferenceVersionInput,
  type PutStoryReferenceSlotInput,
  type StoryProjectIdParams,
  type StoryReferenceSlotParams,
  type StoryReferenceVersionParams,
} from './dto';
import { StoryReferenceService } from './story-reference.service';

@Controller('story-projects')
export class StoryReferenceController {
  constructor(private readonly references: StoryReferenceService) {}

  @Get(':projectId/reference-slots')
  async listSlots(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
  ) {
    return {
      code: 200,
      data: await this.references.listSlots(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
      ),
    };
  }

  @Post(':projectId/reference-slots')
  @HttpCode(HttpStatus.CREATED)
  async createSlots(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryProjectIdParamsSchema))
    params: StoryProjectIdParams,
    @Body(new ZodValidationPipe(CreateStoryReferenceSlotsBatchSchema))
    body: CreateStoryReferenceSlotsBatchInput,
  ) {
    return {
      code: 200,
      data: await this.references.createSlots(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        body,
      ),
    };
  }

  @Put(':projectId/reference-slots/:slotId')
  async putSlot(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryReferenceSlotParamsSchema))
    params: StoryReferenceSlotParams,
    @Body(new ZodValidationPipe(PutStoryReferenceSlotSchema))
    body: PutStoryReferenceSlotInput,
  ) {
    return {
      code: 200,
      data: await this.references.putSlot(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.slotId,
        body,
      ),
    };
  }

  @Get(':projectId/reference-slots/:slotId/versions')
  async listVersions(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryReferenceSlotParamsSchema))
    params: StoryReferenceSlotParams,
  ) {
    return {
      code: 200,
      data: await this.references.listVersions(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.slotId,
      ),
    };
  }

  @Post(':projectId/reference-slots/:slotId/versions')
  @HttpCode(HttpStatus.CREATED)
  async createVersion(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Headers('idempotency-key') idempotency: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryReferenceSlotParamsSchema))
    params: StoryReferenceSlotParams,
    @Body(new ZodValidationPipe(CreateStoryReferenceVersionSchema))
    body: CreateStoryReferenceVersionInput,
  ) {
    return {
      code: 200,
      data: await this.references.createVersion(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.slotId,
        body,
        requiredIdempotencyKey(idempotency),
      ),
    };
  }

  @Post(
    ':projectId/reference-slots/:slotId/versions/:referenceVersionId/reviews',
  )
  @HttpCode(HttpStatus.CREATED)
  async reviewVersion(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryReferenceVersionParamsSchema))
    params: StoryReferenceVersionParams,
    @Body(new ZodValidationPipe(CreateStoryReferenceReviewSchema))
    body: CreateStoryReferenceReviewInput,
  ) {
    return {
      code: 200,
      data: await this.references.reviewVersion(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.slotId,
        params.referenceVersionId,
        body,
      ),
    };
  }

  @Post(':projectId/reference-slots/:slotId/approval')
  @HttpCode(HttpStatus.CREATED)
  async approveVersion(
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id') workspace: string | string[] | undefined,
    @Param(new ZodValidationPipe(StoryReferenceSlotParamsSchema))
    params: StoryReferenceSlotParams,
    @Body(new ZodValidationPipe(ApproveStoryReferenceVersionSchema))
    body: ApproveStoryReferenceVersionInput,
  ) {
    return {
      code: 200,
      data: await this.references.approveVersion(
        user,
        requiredWorkspaceId(workspace),
        params.projectId,
        params.slotId,
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
