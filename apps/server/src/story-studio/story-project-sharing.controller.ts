import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, ViewerCookie } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { StoryProjectInvitesService } from './story-project-invites.service';
import { StoryProjectMembersService } from './story-project-members.service';
import {
  AddStoryMemberSchema,
  CreateStoryInviteSchema,
  UpdateStoryMemberRoleSchema,
  type AddStoryMemberInput,
  type CreateStoryInviteInput,
  type UpdateStoryMemberRoleInput,
} from './story-project-sharing.dto';

@Controller('story-projects/:projectId/members')
export class StoryProjectMembersController {
  constructor(private readonly members: StoryProjectMembersService) {}

  @Get()
  async list(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
  ) {
    return {
      code: 200,
      data: await this.members.list(projectId, user, cookie),
    };
  }

  @Post()
  async add(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
    @Body(new ZodValidationPipe(AddStoryMemberSchema))
    body: AddStoryMemberInput,
  ) {
    return {
      code: 200,
      data: await this.members.add(projectId, user, cookie, body),
    };
  }

  @Patch(':memberId')
  async updateRole(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateStoryMemberRoleSchema))
    body: UpdateStoryMemberRoleInput,
  ) {
    return {
      code: 200,
      data: await this.members.updateRole(projectId, user, memberId, body),
    };
  }

  @Delete(':memberId')
  async remove(
    @Param('projectId') projectId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.members.remove(projectId, user, memberId);
    return { code: 200, data: { removed: true } };
  }
}

@Controller('story-projects/:projectId/invites')
export class StoryProjectInvitesController {
  constructor(private readonly invites: StoryProjectInvitesService) {}

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
    @Body(new ZodValidationPipe(CreateStoryInviteSchema))
    body: CreateStoryInviteInput,
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
