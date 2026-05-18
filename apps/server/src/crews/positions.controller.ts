/**
 *   GET    /aurora/crews/:crewId/positions              List
 *   POST   /aurora/crews/:crewId/positions              Create  (owner)
 *   PATCH  /aurora/crews/:crewId/positions/:positionId  Update  (owner)
 *   DELETE /aurora/crews/:crewId/positions/:positionId  Delete  (owner, no pending apps)
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
} from '@nestjs/common';
import { CurrentUser, Public } from '../auth';
import type { AuthUser } from '../auth';
import {
  CreatePositionSchema,
  type CreatePositionInput,
  UpdatePositionSchema,
  type UpdatePositionInput,
} from './dto';
import { parseIdParam } from './params';
import { PositionsService } from './positions.service';
import { ZodValidationPipe } from './zod.pipe';

@Controller('crews/:crewId/positions')
export class PositionsController {
  constructor(private readonly svc: PositionsService) {}

  @Public()
  @Get()
  list(@Param('crewId') crewIdRaw: string) {
    return this.svc.list(parseIdParam(crewIdRaw, 'crewId'));
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
