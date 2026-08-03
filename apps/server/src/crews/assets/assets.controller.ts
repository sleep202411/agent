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
  Put,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../../auth';
import type { AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import { CrewAssetsService } from './assets.service';
import {
  AttachCrewAssetFileSchema,
  type AttachCrewAssetFileInput,
  CreateCrewAssetFolderSchema,
  type CreateCrewAssetFolderInput,
  ListCrewAssetsSchema,
  type ListCrewAssetsQuery,
  SetCrewAssetFavoriteSchema,
  type SetCrewAssetFavoriteInput,
  SetCrewAssetPermissionsSchema,
  type SetCrewAssetPermissionsInput,
  UpdateCrewAssetNodeSchema,
  type UpdateCrewAssetNodeInput,
} from './dto';
import { CrewAssetAccessService } from './asset-access.service';

@Controller('crews/:crewId/assets')
export class CrewAssetsController {
  constructor(
    private readonly assets: CrewAssetsService,
    private readonly access: CrewAssetAccessService,
  ) {}

  @Get('context')
  context(@Param('crewId') crewIdRaw: string, @CurrentUser() user: AuthUser) {
    return this.assets.context(parseIdParam(crewIdRaw, 'crewId'), user.userId);
  }

  @Get()
  list(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewAssetsSchema))
    query: ListCrewAssetsQuery,
  ) {
    return this.assets.list(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      query,
    );
  }

  @Get('folders')
  listFolders(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assets.listFolders(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
    );
  }

  @Get('nodes/:nodeId')
  locate(
    @Param('crewId') crewIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assets.locate(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      nodeId,
    );
  }

  @Post('folders')
  @HttpCode(HttpStatus.CREATED)
  createFolder(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewAssetFolderSchema))
    body: CreateCrewAssetFolderInput,
  ) {
    return this.assets.createFolder(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      body,
    );
  }

  @Post('files')
  @HttpCode(HttpStatus.CREATED)
  attachFile(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AttachCrewAssetFileSchema))
    body: AttachCrewAssetFileInput,
  ) {
    return this.assets.attachFile(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      body,
    );
  }

  @Delete('uploads/:mediaAssetId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async discardPendingUpload(
    @Param('crewId') crewIdRaw: string,
    @Param('mediaAssetId') mediaAssetId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assets.discardPendingUpload(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      mediaAssetId,
    );
  }

  @Patch(':nodeId')
  update(
    @Param('crewId') crewIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewAssetNodeSchema))
    body: UpdateCrewAssetNodeInput,
  ) {
    return this.assets.update(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      nodeId,
      body,
    );
  }

  @Delete(':nodeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async trash(
    @Param('crewId') crewIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assets.trash(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      nodeId,
    );
  }

  @Post(':nodeId/restore')
  restore(
    @Param('crewId') crewIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.assets.restore(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      nodeId,
    );
  }

  @Delete(':nodeId/permanent')
  @HttpCode(HttpStatus.NO_CONTENT)
  async removePermanently(
    @Param('crewId') crewIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.assets.removePermanently(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      nodeId,
    );
  }

  @Put(':nodeId/favorite')
  setFavorite(
    @Param('crewId') crewIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SetCrewAssetFavoriteSchema))
    body: SetCrewAssetFavoriteInput,
  ) {
    return this.assets.setFavorite(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      nodeId,
      body.favorite,
    );
  }

  @Get(':nodeId/permissions')
  permissions(
    @Param('crewId') crewIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.access.getPermissions(
      parseIdParam(crewIdRaw, 'crewId'),
      nodeId,
      user.userId,
    );
  }

  @Get(':nodeId/permissions/events')
  permissionEvents(
    @Param('crewId') crewIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.access.listPermissionEvents(
      parseIdParam(crewIdRaw, 'crewId'),
      nodeId,
      user.userId,
    );
  }

  @Put(':nodeId/permissions')
  setPermissions(
    @Param('crewId') crewIdRaw: string,
    @Param('nodeId') nodeId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(SetCrewAssetPermissionsSchema))
    body: SetCrewAssetPermissionsInput,
  ) {
    return this.assets.setPermissions(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      nodeId,
      body,
    );
  }
}

/**
 * Read-only project-canvas adapter over the crew cloud drive. It deliberately
 * resolves the crew server-side from the production/task project relation so
 * the client cannot substitute an unrelated crew id.
 */
@Controller('projects/:projectId/crew-assets')
export class ProjectCrewAssetsController {
  constructor(private readonly assets: CrewAssetsService) {}

  @Get('context')
  async context(
    @Param('projectId') projectIdRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    return {
      code: 200,
      data: await this.assets.projectContext(
        parseIdParam(projectIdRaw, 'projectId'),
        user.userId,
      ),
    };
  }

  @Get()
  async list(
    @Param('projectId') projectIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewAssetsSchema))
    query: ListCrewAssetsQuery,
  ) {
    return {
      code: 200,
      data: await this.assets.listForProject(
        parseIdParam(projectIdRaw, 'projectId'),
        user.userId,
        query,
      ),
    };
  }
}
