import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { CreateInviteSchema, type CreateInviteInput } from './dto';
import { WorkspaceInvitesService } from './workspace-invites.service';

@Controller('workspaces/:workspaceId/invites')
export class WorkspaceInvitesController {
  constructor(private readonly invites: WorkspaceInvitesService) {}

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return { code: 200, data: await this.invites.list(workspaceId, user) };
  }

  @Post()
  async create(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateInviteSchema)) body: CreateInviteInput,
  ) {
    return {
      code: 200,
      data: await this.invites.create(workspaceId, user, body),
    };
  }

  @Delete(':inviteId')
  async revoke(
    @Param('workspaceId') workspaceId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.invites.revoke(workspaceId, user, inviteId);
    return { code: 200, data: { revoked: true } };
  }
}
