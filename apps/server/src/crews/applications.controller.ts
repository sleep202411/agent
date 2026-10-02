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
  Query,
  Req,
} from '@nestjs/common';
import { z } from 'zod';
import type { Request } from 'express';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ApplicationsService } from './applications.service';
import {
  ApplySchema,
  type ApplyInput,
  ListCrewApplicationsQuerySchema,
  type ListCrewApplicationsQuery,
} from './dto';
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
    @Req() request: Request,
  ) {
    return this.svc.apply(
      parseIdParam(crewIdRaw, 'crewId'),
      parseIdParam(positionIdRaw, 'positionId'),
      user.userId,
      body,
      request.headers.cookie,
    );
  }

  @Get('applications/:applicationId')
  thread(@Param('applicationId') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.getThread(parseIdParam(id, 'applicationId'), user.userId);
  }

  @Get('me/crew-applications')
  mine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewApplicationsQuerySchema))
    query: ListCrewApplicationsQuery,
  ) {
    return this.svc.listMine(user.userId, query);
  }

  @Get('crews/:crewId/applications')
  list(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewApplicationsQuerySchema))
    query: ListCrewApplicationsQuery,
  ) {
    return this.svc.listForOwner(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      query,
    );
  }

  @Get('crews/:crewId/applications/:applicationId')
  get(
    @Param('crewId') crewIdRaw: string,
    @Param('applicationId') applicationIdRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.svc.getForOwner(
      parseIdParam(crewIdRaw, 'crewId'),
      parseIdParam(applicationIdRaw, 'applicationId'),
      user.userId,
    );
  }

  @Post('applications/:applicationId/accept-offer')
  @HttpCode(HttpStatus.OK)
  acceptOffer(
    @Param('applicationId') id: string,
    @CurrentUser() user: AuthUser,
    @Body(
      new ZodValidationPipe(
        z
          .object({ version: z.number().int().positive().max(2147483647) })
          .strict(),
      ),
    )
    body: { version: number },
    @Req() request: Request,
  ) {
    return this.svc.acceptOffer(
      parseIdParam(id, 'applicationId'),
      user.userId,
      body.version,
      request.headers.cookie,
    );
  }

  @Post('applications/:applicationId/approve')
  @HttpCode(HttpStatus.OK)
  approve(
    @Param('applicationId') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Req() request: Request,
  ) {
    return this.svc.approve(
      parseIdParam(idRaw, 'applicationId'),
      user.userId,
      request.headers.cookie,
    );
  }

  @Post('applications/:applicationId/reject')
  @HttpCode(HttpStatus.OK)
  reject(@Param('applicationId') idRaw: string, @CurrentUser() user: AuthUser) {
    return this.svc.reject(parseIdParam(idRaw, 'applicationId'), user.userId);
  }
}
