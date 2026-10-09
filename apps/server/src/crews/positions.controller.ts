/**
 *   GET    /aurora/crews/:crewId/positions              List
 *   POST   /aurora/crews/:crewId/positions              Create  (owner)
 *   PATCH  /aurora/crews/:crewId/positions/:positionId  Update  (owner)
 *   DELETE /aurora/crews/:crewId/positions/:positionId  Delete  (owner, no pending apps)
 *   GET    /aurora/positions                            Public discovery
 */
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
import { AuthService, CurrentUser, Public, ViewerCookie } from '../auth';
import type { AuthUser } from '../auth';
import {
  CreatePositionSchema,
  type CreatePositionInput,
  ListCrewPositionsQuerySchema,
  type ListCrewPositionsQuery,
  ListPublicPositionsQuerySchema,
  type ListPublicPositionsQuery,
  UpdatePositionSchema,
  type UpdatePositionInput,
} from './dto';
import { parseIdParam } from '../common/params';
import { PositionsService } from './positions.service';
import { ZodValidationPipe } from '../common/zod.pipe';

@Controller('crews/:crewId/positions')
export class PositionsController {
  constructor(
    private readonly svc: PositionsService,
    private readonly authService: AuthService,
  ) {}

  @Public()
  @Get()
  list(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser | undefined,
    @Query(new ZodValidationPipe(ListCrewPositionsQuerySchema))
    query: ListCrewPositionsQuery,
  ) {
    return this.svc.list(
      parseIdParam(crewIdRaw, 'crewId'),
      user?.userId ?? null,
      query,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
    @Body(new ZodValidationPipe(CreatePositionSchema))
    body: CreatePositionInput,
  ) {
    const fresh =
      body.recruitmentVisibility !== 'private'
        ? await this.authService.validateToken(cookie, { bypassCache: true })
        : user;
    return this.svc.create(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      body,
      fresh?.userId === user.userId ? fresh.levelIds : [],
    );
  }

  @Patch(':positionId')
  async update(
    @Param('crewId') crewIdRaw: string,
    @Param('positionId') positionIdRaw: string,
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
    @Body(new ZodValidationPipe(UpdatePositionSchema))
    body: UpdatePositionInput,
  ) {
    const fresh =
      body.status === 'open'
        ? await this.authService.validateToken(cookie, { bypassCache: true })
        : user;
    return this.svc.update(
      parseIdParam(crewIdRaw, 'crewId'),
      parseIdParam(positionIdRaw, 'positionId'),
      user.userId,
      body,
      fresh?.userId === user.userId ? fresh.levelIds : [],
    );
  }

  @Delete(':positionId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('crewId') crewIdRaw: string,
    @Param('positionId') positionIdRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.svc.delete(
      parseIdParam(crewIdRaw, 'crewId'),
      parseIdParam(positionIdRaw, 'positionId'),
      user.userId,
    );
  }
}

@Controller('positions')
export class PositionsDiscoveryController {
  constructor(private readonly svc: PositionsService) {}

  @Public()
  @Get()
  list(
    @Query(new ZodValidationPipe(ListPublicPositionsQuerySchema))
    query: ListPublicPositionsQuery,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.svc.listPublic(query, user?.userId);
  }
  @Get(':positionId/saved')
  saved(@Param('positionId') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.saved(parseIdParam(id, 'positionId'), user.userId);
  }
  @Put(':positionId/saved')
  save(@Param('positionId') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.save(parseIdParam(id, 'positionId'), user.userId, true);
  }
  @Delete(':positionId/saved')
  unsave(@Param('positionId') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.save(parseIdParam(id, 'positionId'), user.userId, false);
  }
}
