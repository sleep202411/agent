/**
 * Scope-agnostic invite acceptance. A raw token is opaque about its scope, so
 * preview/accept hash it once and resolve against the workspace table first,
 * then the project table (tokenHash is unique within each; a cross-table
 * collision is cryptographically negligible). The per-scope create/list/revoke
 * endpoints live on WorkspaceInvitesController / ProjectInvitesController.
 */
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../auth';
import type { AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { AcceptInviteSchema, type AcceptInviteInput } from './dto';
import { hashInviteToken } from './invite-token';
import { ProjectInvitesService } from './project-invites.service';
import { WorkspaceInvitesService } from './workspace-invites.service';

@Controller('invites')
export class InvitesController {
  constructor(
    private readonly workspaceInvites: WorkspaceInvitesService,
    private readonly projectInvites: ProjectInvitesService,
  ) {}

  @Get('preview')
  async preview(@Query('token') token: string | undefined) {
    if (!token || token.trim().length < 8) {
      throw new BadRequestException({
        code: 'INVALID_TOKEN',
        msg: 'A valid invite token is required.',
      });
    }
    const tokenHash = hashInviteToken(token);
    const ws = await this.workspaceInvites.findByHash(tokenHash);
    if (ws) return { code: 200, data: await this.workspaceInvites.preview(ws) };
    const proj = await this.projectInvites.findByHash(tokenHash);
    if (proj)
      return { code: 200, data: await this.projectInvites.preview(proj) };
    throw new NotFoundException({
      code: 'INVITE_NOT_FOUND',
      msg: 'This invite link is invalid.',
    });
  }

  @Post('accept')
  async accept(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AcceptInviteSchema)) body: AcceptInviteInput,
  ) {
    const tokenHash = hashInviteToken(body.token);
    const ws = await this.workspaceInvites.findByHash(tokenHash);
    if (ws)
      return { code: 200, data: await this.workspaceInvites.accept(ws, user) };
    const proj = await this.projectInvites.findByHash(tokenHash);
    if (proj) {
      return { code: 200, data: await this.projectInvites.accept(proj, user) };
    }
    throw new NotFoundException({
      code: 'INVITE_NOT_FOUND',
      msg: 'This invite link is invalid.',
    });
  }
}
