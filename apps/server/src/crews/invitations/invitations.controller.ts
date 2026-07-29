import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, ViewerCookie } from '../../auth';
import type { AuthUser } from '../../auth';
import { parseIdParam } from '../../common/params';
import { ZodValidationPipe } from '../../common/zod.pipe';
import {
  CreateCrewInvitationSchema,
  type CreateCrewInvitationInput,
  ListCrewInvitationsQuerySchema,
  type ListCrewInvitationsQuery,
} from '../dto';
import { CrewInvitationsService } from './invitations.service';

@Controller()
export class CrewInvitationsController {
  constructor(private readonly invitations: CrewInvitationsService) {}

  @Get('crews/:crewId/invitations')
  list(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewInvitationsQuerySchema))
    query: ListCrewInvitationsQuery,
  ) {
    return this.invitations.listForCrew(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      query,
    );
  }

  @Post('crews/:crewId/invitations')
  @HttpCode(HttpStatus.CREATED)
  create(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
    @Body(new ZodValidationPipe(CreateCrewInvitationSchema))
    body: CreateCrewInvitationInput,
  ) {
    return this.invitations.create(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      cookie,
      body,
    );
  }

  @Get('crew-invitations')
  mine(
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewInvitationsQuerySchema))
    query: ListCrewInvitationsQuery,
  ) {
    return this.invitations.listMine(user.userId, query);
  }

  @Get('crew-invitations/:invitationId')
  getMine(
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invitations.getMine(
      parseIdParam(invitationId, 'invitationId'),
      user.userId,
    );
  }

  @Post('crew-invitations/:invitationId/accept')
  accept(
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invitations.accept(
      parseIdParam(invitationId, 'invitationId'),
      user.userId,
    );
  }

  @Post('crew-invitations/:invitationId/decline')
  decline(
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invitations.decline(
      parseIdParam(invitationId, 'invitationId'),
      user.userId,
    );
  }

  @Delete('crew-invitations/:invitationId')
  @HttpCode(HttpStatus.OK)
  revoke(
    @Param('invitationId') invitationId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.invitations.revoke(
      parseIdParam(invitationId, 'invitationId'),
      user.userId,
    );
  }
}
