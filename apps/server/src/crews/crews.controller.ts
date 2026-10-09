/**
 * /aurora/crews/*  — crew CRUD endpoints.
 *
 *   POST   /aurora/crews                Create
 *   GET    /aurora/crews                List (public — visitors see brief cards)
 *   GET    /aurora/crews/my             "My Crews" — founded + joined for /profile tab
 *   GET    /aurora/crews/by-user/:userId  Public: a user's LISTED crews (visitor profile tab)
 *   GET    /aurora/crews/:id            Detail (public; pending-app count hidden from non-owners)
 *   GET    /aurora/crews/:id/conversation  The crew's one group chat (members only; 404 otherwise)
 *   PATCH  /aurora/crews/:id            Edit (owner only)
 *   PATCH  /aurora/crews/:id/listing    Show / hide in Crew Hall (owner only)
 *   DELETE /aurora/crews/:id            Soft delete (owner only)
 */
import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AuthService, CurrentUser, Public, ViewerCookie } from '../auth';
import type { AuthUser } from '../auth';
import { CURRENT_CELL } from '../common/region/current-cell';
import { CrewsService } from './crews.service';
import { CrewStudioWorkspaceService } from './production/studio-workspace.service';
import {
  CreateCrewSchema,
  type CreateCrewInput,
  CreateCrewReportSchema,
  type CreateCrewReportInput,
  UpdateCrewSchema,
  type UpdateCrewInput,
  UpdateCrewListingSchema,
  type UpdateCrewListingInput,
  TransferCrewOwnerSchema,
  type TransferCrewOwnerInput,
} from './dto';
import { parseIdParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod.pipe';

@Controller('crews')
export class CrewsController {
  constructor(
    private readonly svc: CrewsService,
    private readonly authService: AuthService,
    private readonly studioWorkspaces: CrewStudioWorkspaceService,
  ) {}

  @Get('creation-eligibility')
  @Header('Cache-Control', 'no-store')
  async creationEligibility(@CurrentUser() user: AuthUser) {
    return {
      ...this.svc.creationEligibility(user),
      workspaces: await this.studioWorkspaces.optionsForCreate(user.userId),
    };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async create(
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
    @Body(new ZodValidationPipe(CreateCrewSchema)) body: CreateCrewInput,
  ) {
    await this.assertCreateAllowed(cookie);
    return this.svc.create(user, body);
  }

  @Public()
  @Get()
  list(
    @CurrentUser() user?: AuthUser,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.svc.list(
      {
        limit: limit ? Number.parseInt(limit, 10) : undefined,
        cursor: cursor || undefined,
      },
      user?.userId ?? null,
    );
  }

  @Get('my')
  my(@CurrentUser() user: AuthUser) {
    return this.svc.myCrews(user.userId);
  }

  // Public per-user list — the creator profile's Crews tab for visitors.
  // Two-segment path so it never collides with the one-segment `:id` route.
  @Public()
  @Get('by-user/:userId')
  listByUser(
    @Param('userId') userIdRaw: string,
    @CurrentUser() user?: AuthUser,
  ) {
    const userId = parseIdParam(userIdRaw, 'userId');
    return this.svc.listPublicCreatorCrews(userId, user?.userId ?? null);
  }

  /**
   * The crew's group chat — the crew workspace's chat panel resolves
   * its thread here and then talks to `/aurora/conversations/*` like
   * any other conversation.
   *
   * Authenticated (no `@Public()`): a crew page is public, its chat is
   * not. Non-members get 404, never 403 — see
   * {@link CrewsService.conversation}. Declared above `@Get(':id')`
   * only for readability; a `:id` segment cannot span a slash, so the
   * two never compete.
   */
  @Get(':id/conversation')
  conversation(@Param('id') idRaw: string, @CurrentUser() user: AuthUser) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.conversation(id, user.userId);
  }

  @Put(':id/like')
  likeAndJoinCommunity(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.joinFanCommunity(
      parseIdParam(id, 'crewId'),
      user.userId,
      true,
    );
  }

  @Post(':id/fan-community')
  joinFanCommunity(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.svc.joinFanCommunity(parseIdParam(id, 'crewId'), user.userId);
  }

  /** Separate community channel. Members enter directly; others join publicly or by invitation. */
  @Get(':id/community-conversation')
  communityConversation(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.communityConversation(id, user.userId);
  }

  @Public()
  @Get(':id')
  detail(@Param('id') idRaw: string, @CurrentUser() user?: AuthUser) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.detail(id, user?.userId ?? null);
  }

  @Patch(':id')
  update(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewSchema)) body: UpdateCrewInput,
  ) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.update(id, user.userId, body);
  }

  @Patch(':id/listing')
  updateListing(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateCrewListingSchema))
    body: UpdateCrewListingInput,
  ) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.updateListing(id, user.userId, body);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id') idRaw: string, @CurrentUser() user: AuthUser) {
    const id = parseIdParam(idRaw, 'id');
    await this.svc.softDelete(id, user.userId);
  }

  /**
   * Hand ownership to another member (owner only). Self-service, so the
   * target must already be an active member and the caller must be the
   * current founder.
   */
  @Post(':id/transfer-owner')
  transferOwner(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(TransferCrewOwnerSchema))
    body: TransferCrewOwnerInput,
  ) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.transferOwnership(id, body.toUserId, {
      actor: { type: 'member', userId: user.userId },
      requireTargetActiveMember: true,
      removeOldOwner: body.removeOldOwner,
      expectedVersion: body.expectedVersion,
    });
  }

  @Post(':id/reports')
  report(
    @Param('id') idRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateCrewReportSchema))
    body: CreateCrewReportInput,
  ) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.report(id, user.userId, body);
  }

  @Post(':id/blocks')
  block(@Param('id') idRaw: string, @CurrentUser() user: AuthUser) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.block(id, user.userId);
  }

  @Post(':id/blocks/remove')
  unblock(@Param('id') idRaw: string, @CurrentUser() user: AuthUser) {
    const id = parseIdParam(idRaw, 'id');
    return this.svc.unblock(id, user.userId);
  }

  private async assertCreateAllowed(cookie: string) {
    if (CURRENT_CELL !== 'cn') return;

    const needsKyc = await this.authService.needsRealNameVerification(cookie);
    if (needsKyc === false) return;
    if (needsKyc === true) {
      throw new ForbiddenException({
        message: 'Identity verification required before creating a crew',
      });
    }

    throw new ServiceUnavailableException({
      message: 'Could not verify identity status; please try again',
    });
  }
}
