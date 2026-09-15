import { z } from 'zod';
import { CrewStudioWorkspaceService } from './studio-workspace.service';
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import {
  CreateCrewEpisodeSchema,
  type CreateCrewEpisodeInput,
  CreateProductionResourceSchema,
  type CreateProductionResourceInput,
  CreateProductionActivitySchema,
  type CreateProductionActivityInput,
  ListProductionActivityQuerySchema,
  type ListProductionActivityQuery,
  LinkCrewStudioProjectSchema,
  type LinkCrewStudioProjectInput,
  ReorderCrewEpisodeSchema,
  type ReorderCrewEpisodeInput,
  ReviewEpisodeDeliverySchema,
  type ReviewEpisodeDeliveryInput,
  SubmitEpisodeDeliverySchema,
  type SubmitEpisodeDeliveryInput,
  UpdateCrewEpisodeSchema,
  type UpdateCrewEpisodeInput,
  UpdateProductionDocumentSchema,
  type UpdateProductionDocumentInput,
  UpdateProductionPropertiesSchema,
  type UpdateProductionPropertiesInput,
} from './production.dto';
import { CrewProductionService } from './production.service';

@Controller()
export class CrewProductionController {
  constructor(
    private readonly production: CrewProductionService,
    private readonly workspaces: CrewStudioWorkspaceService,
  ) {}

  @Get('crews/:crewId/studio-workspace-options')
  workspaceOptions(@Param('crewId') id: string, @CurrentUser() user: AuthUser) {
    return this.workspaces.options(parseIdParam(id, 'crewId'), user.userId);
  }

  @Patch('crews/:crewId/studio-workspace')
  linkWorkspace(
    @Param('crewId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(
      new ZodValidationPipe(
        z.object({ workspaceId: z.string().uuid().nullable() }).strict(),
      ),
    )
    input: { workspaceId: string | null },
  ) {
    return this.workspaces.link(
      parseIdParam(id, 'crewId'),
      user.userId,
      input.workspaceId,
    );
  }

  @Get('crews/:crewId/production-overview')
  overview(@Param('crewId') crewIdRaw: string, @CurrentUser() user: AuthUser) {
    return this.production.overview(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
    );
  }

  @Get('crews/:crewId/studio-project-options')
  studioProjectOptions(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.production.studioProjectOptions(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
    );
  }

  @Patch('crews/:crewId/studio-project')
  linkStudioProject(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(LinkCrewStudioProjectSchema))
    input: LinkCrewStudioProjectInput,
  ) {
    return this.production.linkStudioProject(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      input,
    );
  }

  @Patch('crews/:crewId/production-overview/document')
  updateDocument(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateProductionDocumentSchema))
    input: UpdateProductionDocumentInput,
  ) {
    return this.production.updateDocument(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      input,
    );
  }

  @Patch('crews/:crewId/production-overview/properties')
  updateProperties(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateProductionPropertiesSchema))
    input: UpdateProductionPropertiesInput,
  ) {
    return this.production.updateProperties(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      input,
    );
  }

  @Post('crews/:crewId/production-resources')
  @HttpCode(HttpStatus.CREATED)
  createResource(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateProductionResourceSchema))
    input: CreateProductionResourceInput,
  ) {
    return this.production.createResource(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      input,
    );
  }

  @Delete('crew-production-resources/:resourceId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteResource(
    @Param('resourceId') resourceIdRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.production.deleteResource(
      parseIdParam(resourceIdRaw, 'resourceId'),
      user.userId,
    );
  }

  @Get('crews/:crewId/production-activity')
  activity(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListProductionActivityQuerySchema))
    query: ListProductionActivityQuery,
  ) {
    return this.production.listActivity(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      query,
    );
  }

  @Post('crews/:crewId/production-activity')
  @HttpCode(HttpStatus.CREATED)
  createActivity(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateProductionActivitySchema))
    input: CreateProductionActivityInput,
  ) {
    return this.production.createActivity(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      input,
    );
  }

  @Get('crews/:crewId/episodes')
  episodes(@Param('crewId') crewIdRaw: string, @CurrentUser() user: AuthUser) {
    return this.production.listEpisodes(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
    );
  }

  @Post('crews/:crewId/episodes')
  @HttpCode(HttpStatus.CREATED)
  createEpisode(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewEpisodeSchema))
    input: CreateCrewEpisodeInput,
  ) {
    return this.production.createEpisode(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      input,
    );
  }

  @Patch('crew-episodes/:episodeId')
  updateEpisode(
    @Param('episodeId') episodeIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewEpisodeSchema))
    input: UpdateCrewEpisodeInput,
  ) {
    return this.production.updateEpisode(
      parseIdParam(episodeIdRaw, 'episodeId'),
      user.userId,
      input,
    );
  }

  @Post('crew-episodes/:episodeId/reorder')
  reorderEpisode(
    @Param('episodeId') episodeIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ReorderCrewEpisodeSchema))
    input: ReorderCrewEpisodeInput,
  ) {
    return this.production.reorderEpisode(
      parseIdParam(episodeIdRaw, 'episodeId'),
      user.userId,
      input,
    );
  }

  @Delete('crew-episodes/:episodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteEpisode(
    @Param('episodeId') episodeIdRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.production.deleteEpisode(
      parseIdParam(episodeIdRaw, 'episodeId'),
      user.userId,
    );
  }

  @Post('crew-episodes/:episodeId/deliveries')
  @HttpCode(HttpStatus.CREATED)
  submitDelivery(
    @Param('episodeId') episodeIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SubmitEpisodeDeliverySchema))
    input: SubmitEpisodeDeliveryInput,
  ) {
    return this.production.submitDelivery(
      parseIdParam(episodeIdRaw, 'episodeId'),
      user.userId,
      input,
    );
  }

  @Post('crew-episode-deliveries/:deliveryId/review')
  reviewDelivery(
    @Param('deliveryId') deliveryIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ReviewEpisodeDeliverySchema))
    input: ReviewEpisodeDeliveryInput,
  ) {
    return this.production.reviewDelivery(
      parseIdParam(deliveryIdRaw, 'deliveryId'),
      user.userId,
      input,
    );
  }
}
