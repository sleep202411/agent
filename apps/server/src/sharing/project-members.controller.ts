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
import {
  AddMemberSchema,
  UpdateMemberRoleSchema,
  type AddMemberInput,
  type UpdateMemberRoleInput,
} from './dto';
import { ProjectMembersService } from './project-members.service';

@Controller('projects/:projectId/members')
export class ProjectMembersController {
  constructor(private readonly members: ProjectMembersService) {}

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
    @Body(new ZodValidationPipe(AddMemberSchema)) body: AddMemberInput,
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
    @Body(new ZodValidationPipe(UpdateMemberRoleSchema))
    body: UpdateMemberRoleInput,
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
