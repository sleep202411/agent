import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../auth';
import type {
  StoryTrailerVideoSummaryDto,
  StoryVideoGenerationDto,
} from './dto';
import { StoryVideoProductionService } from './story-video-production.service';
import type {
  CreateStoryTrailerVideoGenerationInput,
  PutStoryTrailerVideoSelectionInput,
} from './story-video-production.schema';

/**
 * Project-trailer facade. All generation, selection-version, media-integrity,
 * and reconciliation rules live in the unified video production service.
 */
@Injectable()
export class StoryTrailerProductionService {
  constructor(private readonly production: StoryVideoProductionService) {}

  getTrailer(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
  ): Promise<StoryTrailerVideoSummaryDto> {
    return this.production.getTrailerSummary(user, workspaceId, projectId);
  }

  createGeneration(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: CreateStoryTrailerVideoGenerationInput,
    idempotencyKey: string,
  ): Promise<StoryVideoGenerationDto> {
    return this.production.createTrailerGeneration(
      user,
      workspaceId,
      projectId,
      input,
      idempotencyKey,
    );
  }

  putCurrentVideo(
    user: AuthUser,
    workspaceId: string,
    projectId: string,
    input: PutStoryTrailerVideoSelectionInput,
  ): Promise<StoryTrailerVideoSummaryDto> {
    return this.production.putTrailerCurrentVideo(
      user,
      workspaceId,
      projectId,
      input,
    );
  }
}
