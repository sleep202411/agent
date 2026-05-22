/**
 *   GET    /aurora/crews/:crewId/members              List (members only)
 *   POST   /aurora/crews/:crewId/members              Add manually (owner)
 *   PATCH  /aurora/crews/:crewId/members/:memberId    Toggle finance (owner)
 *   DELETE /aurora/crews/:crewId/members/:memberId    Remove (owner)
 */
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import { CurrentUser, ViewerCookie } from '../auth';
import type { AuthUser } from '../auth';
import {
  AddMemberSchema,
  type AddMemberInput,
  UpdateMemberSchema,
  type UpdateMemberInput,
} from './dto';
import { MembersService } from './members.service';
import { parseIdParam } from '../common/params';
import { ZodValidationPipe } from '../common/zod.pipe';

@Controller('crews/:crewId/members')
export class MembersController {
  constructor(private readonly svc: MembersService) {}

  @Get()
  list(@Param('crewId') crewIdRaw: string, @CurrentUser() user: AuthUser) {
    return this.svc.list(parseIdParam(crewIdRaw, 'crewId'), user.userId);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  add(
    @Param('crewId') crewIdRaw: string,
    @CurrentUser() user: AuthUser,
    @ViewerCookie() cookie: string,
    @Body(new ZodValidationPipe(AddMemberSchema)) body: AddMemberInput,
  ) {
    return this.svc.add(
      parseIdParam(crewIdRaw, 'crewId'),
      user.userId,
      cookie,
      body,
    );
  }

  @Patch(':memberId')
  update(
    @Param('crewId') crewIdRaw: string,
    @Param('memberId') memberIdRaw: string,
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(UpdateMemberSchema)) body: UpdateMemberInput,
  ) {
    return this.svc.update(
      parseIdParam(crewIdRaw, 'crewId'),
      parseIdParam(memberIdRaw, 'memberId'),
      user.userId,
      body,
    );
  }

  @Delete(':memberId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(
    @Param('crewId') crewIdRaw: string,
    @Param('memberId') memberIdRaw: string,
    @CurrentUser() user: AuthUser,
  ) {
    await this.svc.remove(
      parseIdParam(crewIdRaw, 'crewId'),
      parseIdParam(memberIdRaw, 'memberId'),
      user.userId,
    );
  }
}
