import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Res,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { Response } from 'express';

import { CurrentUser, Public, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { AgentPlatformCredentialsService } from './agent-platform-credentials.service';
import {
  AgentAttachmentRegisterRequestSchema,
  AgentAttachmentRevokeRequestSchema,
  AgentAttachmentStatusRequestSchema,
  type AgentAttachmentRegisterRequest,
  type AgentAttachmentRevokeRequest,
  type AgentAttachmentStatusRequest,
} from './agent-platform-attachment.dto';
import { AgentPlatformAttachmentIngestService } from './agent-platform-attachment-ingest.service';
import { AgentPlatformAttachmentService } from './agent-platform-attachment.service';
import { AgentPlatformDocumentAnalysisDispatcherService } from './agent-platform-document-analysis-dispatcher.service';
import {
  AgentCancellationGatewayRequestSchema,
  AgentConversationCreateRequestSchema,
  AgentConversationPreferenceRequestSchema,
  AgentConversationResolveRequestSchema,
  AgentHistoryGatewayRequestSchema,
  AgentInvocationGatewayRequestSchema,
  AgentInvocationStatusRequestSchema,
  AgentSessionGrantRequestSchema,
  type AgentCancellationGatewayRequest,
  type AgentConversationCreateRequest,
  type AgentConversationPreferenceRequest,
  type AgentConversationResolveRequest,
  type AgentHistoryGatewayRequest,
  type AgentInvocationGatewayRequest,
  type AgentInvocationStatusRequest,
  type AgentSessionGrantRequest,
} from './agent-platform-gateway.dto';
import { AgentPlatformGatewayService } from './agent-platform-gateway.service';
import { AgentAdmissionRejectedException } from './agent-platform-invocation.service';

@Controller('agent-platform')
export class AgentPlatformGatewayController {
  constructor(
    private readonly gateway: AgentPlatformGatewayService,
    private readonly credentials: AgentPlatformCredentialsService,
    private readonly attachments: AgentPlatformAttachmentService,
    private readonly attachmentIngest: AgentPlatformAttachmentIngestService,
    private readonly documentAnalysis: AgentPlatformDocumentAnalysisDispatcherService,
  ) {}

  @Public()
  @Get('.well-known/jwks.json')
  @Header('Cache-Control', 'public, max-age=300, stale-while-revalidate=300')
  jwks() {
    return this.credentials.jwks();
  }

  @Public()
  @Get('health/ready')
  async readiness() {
    if (
      !(await this.gateway.isReady()) ||
      !(await this.attachmentIngest.isReady()) ||
      !(await this.documentAnalysis.isReady())
    ) {
      throw new ServiceUnavailableException({
        code: 'AGENT_PLATFORM_UNAVAILABLE',
        message: 'The Agent Platform is not ready.',
        retryable: true,
      });
    }
    return {
      status: 'ready',
      dependency: 'agent-platform',
    };
  }

  @Post('conversations/resolve')
  async resolveConversation(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AgentConversationResolveRequestSchema))
    request: AgentConversationResolveRequest,
  ) {
    return {
      code: 200,
      data: await this.gateway.resolveConversation(user, request),
    };
  }

  @Post('conversations')
  @HttpCode(HttpStatus.CREATED)
  async createConversation(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AgentConversationCreateRequestSchema))
    request: AgentConversationCreateRequest,
  ) {
    return {
      code: 200,
      data: await this.gateway.createConversation(user, request),
    };
  }

  @Post('sessions/authorize')
  async authorizeSession(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AgentSessionGrantRequestSchema))
    request: AgentSessionGrantRequest,
  ) {
    return {
      code: 200,
      data: await this.gateway.authorizeSession(user, request),
    };
  }

  @Patch('conversations/preference')
  async updateConversationPreference(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AgentConversationPreferenceRequestSchema))
    request: AgentConversationPreferenceRequest,
  ) {
    return {
      code: 200,
      data: await this.gateway.updateConversationPreference(user, request),
    };
  }

  @Post('attachments/register')
  @HttpCode(HttpStatus.ACCEPTED)
  async registerAttachment(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AgentAttachmentRegisterRequestSchema))
    request: AgentAttachmentRegisterRequest,
  ) {
    return {
      code: 200,
      data: await this.attachments.register(user, request),
    };
  }

  @Post('attachments/status')
  async attachmentStatus(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AgentAttachmentStatusRequestSchema))
    request: AgentAttachmentStatusRequest,
  ) {
    return {
      code: 200,
      data: await this.attachments.status(user, request),
    };
  }

  @Post('attachments/revoke')
  async revokeAttachment(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AgentAttachmentRevokeRequestSchema))
    request: AgentAttachmentRevokeRequest,
  ) {
    return {
      code: 200,
      data: await this.attachments.revoke(user, request),
    };
  }

  @Post('invocations')
  @HttpCode(HttpStatus.ACCEPTED)
  async invoke(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AgentInvocationGatewayRequestSchema))
    request: AgentInvocationGatewayRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    try {
      return {
        code: 200,
        data: await this.gateway.invoke(user, request),
      };
    } catch (error) {
      if (error instanceof AgentAdmissionRejectedException) {
        response.setHeader('Retry-After', String(error.retryAfterSeconds));
      }
      throw error;
    }
  }

  @Post('invocations/status')
  async invocationStatus(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AgentInvocationStatusRequestSchema))
    request: AgentInvocationStatusRequest,
  ) {
    return {
      code: 200,
      data: await this.gateway.invocationStatus(user, request),
    };
  }

  @Post('cancellations')
  async cancel(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AgentCancellationGatewayRequestSchema))
    request: AgentCancellationGatewayRequest,
  ) {
    return {
      code: 200,
      data: await this.gateway.cancel(user, request),
    };
  }

  @Post('history')
  async history(
    @CurrentUser() user: AuthUser,
    @Body(new ZodValidationPipe(AgentHistoryGatewayRequestSchema))
    request: AgentHistoryGatewayRequest,
  ) {
    return {
      code: 200,
      data: await this.gateway.history(user, request),
    };
  }
}
