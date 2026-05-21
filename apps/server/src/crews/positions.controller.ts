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
  Query,
} from '@nestjs/common';
import { CurrentUser, Public } from '../auth';
import type { AuthUser } from '../auth';
import {
  CreatePositionSchema,
  type CreatePositionInput,
  UpdatePositionSchema,
  type UpdatePositionInput,
} from './dto';
import { parseIdParam } from '../common/params';
import { PositionsService } from './positions.service';
import { ZodValidationPipe } from '../common/zod.pipe';

@Controller('crews/:crewId/positions')
export class PositionsController {
  constructor(private readonly svc: PositionsService) {}

  @Public()
  @Get()
  list(@Param('crewId') crewIdRaw: string, @CurrentUser() user?: AuthUser) {
    return this.svc.list(
      parseIdParam(crewIdRaw, 'crewId'),
      user?.userId ?? null,
    );
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreatePositionSchema))
    body: CreatePositionInput,
  ) {
    return this.svc.create(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      body,
    );
  }

  @Patch(':positionId')
  update(
    @Param('crewId') crewIdRaw: string,
    @Param('positionId') positionIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdatePositionSchema))
    body: UpdatePositionInput,
  ) {
    return this.svc.update(
      parseIdParam(crewIdRaw, 'crewId'),
      parseIdParam(positionIdRaw, 'positionId'),
      user.userId,
      body,
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
  list(@Query('limit') limitRaw?: string, @Query('cursor') cursorRaw?: string) {
    const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
    return this.svc.listPublic({
      limit,
      cursor: cursorRaw ? parseIdParam(cursorRaw, 'cursor') : undefined,
    });
  }
}
