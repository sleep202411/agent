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
  CreateCrewInviteLinkSchema,
  type CreateCrewInviteLinkInput,
  ListCrewInviteLinksQuerySchema,
  type ListCrewInviteLinksQuery,
  ListCrewInvitationsQuerySchema,
  type ListCrewInvitationsQuery,
} from '../dto';
import { CrewInvitationsService } from './invitations.service';
import { CrewInviteLinksService } from './invite-links.service';

@Controller()
export class CrewInvitationsController {
  constructor(
    private readonly invitations: CrewInvitationsService,
    private readonly inviteLinks: CrewInviteLinksService,
  ) {}

  // ── Shareable links ────────────────────────────────────────────────────
  // Redemption is not here: a visitor holding a token has no crew context
  // yet, so preview/accept live on the scope-agnostic InvitesController.

  @Get('crews/:crewId/invite-links')
  listLinks(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Query(new ZodValidationPipe(ListCrewInviteLinksQuerySchema))
    query: ListCrewInviteLinksQuery,
  ) {
    if (query.paginated === 'true') {
      return this.inviteLinks.listPage(
        parseIdParam(crewId, 'crewId'),
        user.userId,
        query,
      );
    }
    return this.inviteLinks.list(parseIdParam(crewId, 'crewId'), user.userId);
  }

  @Post('crews/:crewId/invite-links')
  @HttpCode(HttpStatus.CREATED)
  createLink(
    @Param('crewId') crewId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewInviteLinkSchema))
    body: CreateCrewInviteLinkInput,
  ) {
    return this.inviteLinks.create(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      body,
    );
  }

  @Delete('crews/:crewId/invite-links/:linkId')
  @HttpCode(HttpStatus.NO_CONTENT)
  revokeLink(
    @Param('crewId') crewId: string,
    @Param('linkId') linkId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return this.inviteLinks.revoke(
      parseIdParam(crewId, 'crewId'),
      user.userId,
      parseIdParam(linkId, 'linkId'),
    );
  }

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
