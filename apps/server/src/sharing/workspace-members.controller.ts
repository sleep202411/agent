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
import { WorkspaceMembersService } from './workspace-members.service';

@Controller('workspaces/:workspaceId/members')
export class WorkspaceMembersController {
  constructor(private readonly members: WorkspaceMembersService) {}

  @Get()
  async list(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
  ) {
    return {
      code: 200,
      data: await this.members.list(workspaceId, user, cookie),
    };
  }

  @Post()
  async add(
    @Param('workspaceId') workspaceId: string,
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
    @Body(new ZodValidationPipe(AddMemberSchema)) body: AddMemberInput,
  ) {
    return {
      code: 200,
      data: await this.members.add(workspaceId, user, cookie, body),
    };
  }

  @Patch(':memberId')
  async updateRole(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateMemberRoleSchema))
    body: UpdateMemberRoleInput,
  ) {
    return {
      code: 200,
      data: await this.members.updateRole(workspaceId, user, memberId, body),
    };
  }

  @Delete(':memberId')
  async remove(
    @Param('workspaceId') workspaceId: string,
    @Param('memberId') memberId: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.members.remove(workspaceId, user, memberId);
    return { code: 200, data: { removed: true } };
  }
}
