import { Body, Controller, Delete, Get, Param, Post } from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { CreateInviteSchema, type CreateInviteInput } from './dto';
import { ProjectInvitesService } from './project-invites.service';

@Controller('projects/:projectId/invites')
export class ProjectInvitesController {
  constructor(private readonly invites: ProjectInvitesService) {}

  @Get()
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    return { code: 200, data: await this.invites.list(projectId, user) };
  }

  @Post()
  async create(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(CreateInviteSchema)) body: CreateInviteInput,
  ) {
    return {
      code: 200,
      data: await this.invites.create(projectId, user, body),
    };
  }

  @Delete(':inviteId')
  async revoke(
    @Param('projectId') projectId: string,
    @Param('inviteId') inviteId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.invites.revoke(projectId, user, inviteId);
    return { code: 200, data: { revoked: true } };
  }
}
