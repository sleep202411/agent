import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser, type AuthUser } from '../auth';
import { AgentOsAttachmentService } from './agent-os-attachment.service';
import {
  AgentOsApprovalBodySchema,
  AgentOsStartRunBodySchema,
} from './agent-os-gateway.dto';
import { ok } from './agent-os-envelope';
import { AgentOsGatewayService } from './agent-os-gateway.service';

/**
 * Product control plane for Agent OS.
 * Routes are under /agent-os/* (studio rewrites /aurora/agent-os/*).
 *
 * Responses use `{ code, data }` for the Studio api client.
 * Phase 1: free, no rate limit. Auth + project permission required.
 */
@Controller('agent-os')
export class AgentOsGatewayController {
  constructor(
    private readonly gateway: AgentOsGatewayService,
    private readonly attachments: AgentOsAttachmentService,
  ) {}

  @Get('health')
  async health() {
    return ok(await this.gateway.health());
  }

  @Get('models')
  async listModels() {
    return ok(await this.gateway.listModels());
  }

  @Get('skills')
  async listSkills(
    @CurrentUser() user: AuthUser,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Query('workbenchMode') workbenchMode?: string,
  ) {
    if (!workbenchMode?.trim()) {
      throw new BadRequestException({
        code: 'AGENT_OS_WORKBENCH_MODE_REQUIRED',
        message: 'workbenchMode is required',
      });
    }
    return ok(
      await this.gateway.listSkills(user, projectId, workbenchMode.trim()),
    );
  }

  /**
   * Restore the actor's Agent OS transcript for a project (optional conversationId).
   * Used when the Studio panel remounts after close or hard refresh.
   */
  @Get('projects/:projectId/conversation')
  async getConversation(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Query('conversationId') conversationId?: string,
  ) {
    return ok(
      await this.gateway.getConversationHistory(
        user,
        projectId,
        conversationId?.trim() || undefined,
      ),
    );
  }

  @Get('projects/:projectId/skills')
  async getProjectSkills(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return ok(await this.gateway.getProjectSkills(user, projectId));
  }

  @Post('projects/:projectId/skills/defaults')
  async setProjectDefaultSkills(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body() body: unknown,
  ) {
    const defaultSkillIds =
      body &&
      typeof body === 'object' &&
      Array.isArray((body as { defaultSkillIds?: unknown }).defaultSkillIds)
        ? (body as { defaultSkillIds: unknown[] }).defaultSkillIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : null;
    if (!defaultSkillIds) {
      throw new BadRequestException({
        code: 'AGENT_OS_INVALID_BODY',
        message: 'defaultSkillIds array is required',
      });
    }
    return ok(
      await this.gateway.setProjectDefaultSkills(
        user,
        projectId,
        defaultSkillIds,
      ),
    );
  }

  @Post('runs')
  /**
   * Use HTTP 200 + envelope code 200 so Studio's api client and Next rewrites
   * never treat a long agent turn as an empty Accepted response.
   */
  async startRun(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const parsed = AgentOsStartRunBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'AGENT_OS_INVALID_BODY',
        message: parsed.error.message,
      });
    }
    return ok(await this.gateway.startRun(user, parsed.data));
  }

  @Post('runs/:runId/approvals')
  async approve(
    @CurrentUser() user: AuthUser,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() body: unknown,
  ) {
    const parsed = AgentOsApprovalBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new BadRequestException({
        code: 'AGENT_OS_INVALID_BODY',
        message: parsed.error.message,
      });
    }
    return ok(await this.gateway.resolveApproval(user, runId, parsed.data));
  }

  @Get('runs/:runId/events')
  async events(
    @CurrentUser() user: AuthUser,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Query('projectId', ParseUUIDPipe) projectId: string,
    @Query('after') afterRaw?: string,
  ) {
    const after = afterRaw ? Number(afterRaw) : 0;
    if (!Number.isFinite(after) || after < 0) {
      throw new BadRequestException({
        code: 'AGENT_OS_INVALID_AFTER',
        message: 'after must be a non-negative number',
      });
    }
    return ok(await this.gateway.listEvents(user, runId, projectId, after));
  }

  @Post('runs/:runId/cancel')
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('runId', ParseUUIDPipe) runId: string,
    @Body() body: unknown,
  ) {
    const projectId =
      body &&
      typeof body === 'object' &&
      typeof (body as { projectId?: unknown }).projectId === 'string'
        ? (body as { projectId: string }).projectId
        : '';
    if (!projectId) {
      throw new BadRequestException({
        code: 'AGENT_OS_INVALID_BODY',
        message: 'projectId is required',
      });
    }
    const reason =
      body &&
      typeof body === 'object' &&
      typeof (body as { reason?: unknown }).reason === 'string'
        ? (body as { reason: string }).reason
        : undefined;
    return ok(await this.gateway.cancelRun(user, runId, projectId, reason));
  }

  /**
   * Short-lived Ably TokenRequest for one conversation channel.
   * Cache-Control: no-store — response is a bearer credential.
   */
  @Post('realtime/token')
  @Header('Cache-Control', 'no-store')
  async realtimeToken(@CurrentUser() user: AuthUser, @Body() body: unknown) {
    const projectId =
      body &&
      typeof body === 'object' &&
      typeof (body as { projectId?: unknown }).projectId === 'string'
        ? (body as { projectId: string }).projectId
        : '';
    const conversationId =
      body &&
      typeof body === 'object' &&
      typeof (body as { conversationId?: unknown }).conversationId === 'string'
        ? (body as { conversationId: string }).conversationId
        : '';
    if (!projectId || !conversationId) {
      throw new BadRequestException({
        code: 'AGENT_OS_INVALID_BODY',
        message: 'projectId and conversationId are required',
      });
    }
    return ok(
      await this.gateway.issueRealtimeToken(user, projectId, conversationId),
    );
  }

  @Get('projects/:projectId/characters')
  async listCharacters(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return ok(await this.gateway.listProjectCharacters(user, projectId));
  }

  @Get('projects/:projectId/attachments')
  async listAttachments(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
  ) {
    return ok(await this.attachments.list(user.userId, projectId));
  }

  @Post('projects/:projectId/attachments')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 20 * 1024 * 1024 },
    }),
  )
  async uploadAttachment(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @UploadedFile()
    file:
      | {
          originalname: string;
          mimetype: string;
          size: number;
          buffer: Buffer;
        }
      | undefined,
  ) {
    if (!file) {
      throw new BadRequestException({
        code: 'AGENT_OS_ATTACHMENT_MISSING',
        message: 'Multipart field "file" is required.',
      });
    }
    return ok(await this.attachments.upload(user.userId, projectId, file));
  }
}
