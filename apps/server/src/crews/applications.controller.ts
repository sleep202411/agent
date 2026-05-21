/**
 *   POST   /aurora/crews/:crewId/positions/:positionId/apply  Apply  (any logged-in user)
 *   GET    /aurora/crews/:crewId/applications                 List   (owner inbox)
 *   POST   /aurora/applications/:applicationId/approve        Approve (owner)
 *   POST   /aurora/applications/:applicationId/reject         Reject  (owner)
 */
import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ApplicationsService } from './applications.service';
import { ApplySchema, type ApplyInput } from './dto';
import { parseIdParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod.pipe';

@Controller()
export class ApplicationsController {
  constructor(private readonly svc: ApplicationsService) {}

  @Post('crews/:crewId/positions/:positionId/apply')
  @HttpCode(HttpStatus.CREATED)
  apply(
    @Param('crewId') crewIdRaw: string,
    @Param('positionId') positionIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(ApplySchema)) body: ApplyInput,
  ) {
    return this.svc.apply(
      parseIdParam(crewIdRaw, 'crewId'),
      parseIdParam(positionIdRaw, 'positionId'),
      user.userId,
      body,
    );
  }

  @Get('crews/:crewId/applications')
  list(@Param('crewId') crewIdRaw: string, @CurrentUser() user: AuthUser) {
    return this.svc.listForOwner(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
    );
  }

  @Post('applications/:applicationId/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('applicationId') idRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.approve(parseIdParam(idRaw, 'applicationId'), user.userId);
  }

  @Post('applications/:applicationId/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('applicationId') idRaw: string, @CurrentUser() user: AuthUser) {
    return this.svc.reject(parseIdParam(idRaw, 'applicationId'), user.userId);
  }
}
