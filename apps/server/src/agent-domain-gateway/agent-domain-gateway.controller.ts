import {
  BadRequestException,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { Response } from 'express';
import {
  AgentInvocationLifecycleAcknowledgementSchema,
  AgentLongDocumentWorkflowInputSchema,
  AgentPublicErrorSchema,
} from '@repo/shared/agent-platform';

import { SkipEndUserAuth } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { AgentPlatformAttachmentService } from '../agent-platform-gateway/agent-platform-attachment.service';
import { AgentPlatformDocumentAnalysisService } from '../agent-platform-gateway/agent-platform-document-analysis.service';
import {
  AgentInvocationLifecycleRequestSchema,
  AgentPlatformInvocationService,
} from '../agent-platform-gateway/agent-platform-invocation.service';
import {
  AgentDomainAuthGuard,
  type AuthenticatedAgentDomainRequest,
} from './agent-domain-auth.guard';
import { AgentDomainExecutionService } from './agent-domain-execution.service';

@SkipEndUserAuth()
@UseGuards(AgentDomainAuthGuard)
@Controller('v1/agent')
export class AgentDomainGatewayController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly execution: AgentDomainExecutionService,
    private readonly attachments: AgentPlatformAttachmentService,
    private readonly documentAnalysis: AgentPlatformDocumentAnalysisService,
    private readonly invocations: AgentPlatformInvocationService,
  ) {}

  @Get('health/ready')
  async ready() {
    await this.prisma.$queryRaw(Prisma.sql`SELECT 1`);
    return {
      schemaVersion: 'agent-domain-readiness/v1',
      status: 'ready',
    };
  }

  @Post('tools/:toolId/execute')
  async execute(
    @Param('toolId') toolId: string,
    @Headers('idempotency-key') idempotencyKey: string,
    @Req() request: AuthenticatedAgentDomainRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.execution.execute({
      toolId,
      idempotencyKey,
      body: request.body,
    });
    response.status(result.httpStatus);
    response.setHeader('Idempotent-Replayed', String(result.replayed));
    return result.body;
  }

  @Post('attachments/resolve')
  async resolveAttachments(@Req() request: AuthenticatedAgentDomainRequest) {
    return this.attachments.resolveForModel(request.body);
  }

  @Post('document-analysis/:jobId/claim')
  async claimDocumentAnalysis(
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedAgentDomainRequest,
  ) {
    const input = AgentLongDocumentWorkflowInputSchema.parse(request.body);
    assertPathIdentity(jobId, input.jobId);
    return this.documentAnalysis.claim(jobId);
  }

  @Post('document-analysis/:jobId/sections/:chunkId/read')
  async readDocumentAnalysisSection(
    @Param('jobId') jobId: string,
    @Param('chunkId') chunkId: string,
  ) {
    return this.documentAnalysis.section(jobId, chunkId);
  }

  @Post('document-analysis/:jobId/artifacts/context')
  async readDocumentAnalysisArtifacts(
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedAgentDomainRequest,
  ) {
    assertPathIdentity(jobId, bodyJobId(request.body));
    return this.documentAnalysis.artifactsContext(request.body);
  }

  @Post('document-analysis/:jobId/artifacts')
  async writeDocumentAnalysisArtifact(
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedAgentDomainRequest,
  ) {
    assertPathIdentity(jobId, bodyJobId(request.body));
    return this.documentAnalysis.writeArtifact(request.body);
  }

  @Post('document-analysis/:jobId/complete')
  async completeDocumentAnalysis(
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedAgentDomainRequest,
  ) {
    assertPathIdentity(jobId, bodyJobId(request.body));
    return this.documentAnalysis.complete(request.body);
  }

  @Post('document-analysis/:jobId/fail')
  async failDocumentAnalysis(
    @Param('jobId') jobId: string,
    @Req() request: AuthenticatedAgentDomainRequest,
  ) {
    assertPathIdentity(jobId, bodyJobId(request.body));
    await this.documentAnalysis.fail(request.body);
    return {
      schemaVersion: 'agent-long-document-fail-ack/v1',
      jobId,
    };
  }

  @Post('invocations/:invocationId/lifecycle')
  async updateInvocationLifecycle(
    @Param('invocationId') invocationId: string,
    @Req() request: AuthenticatedAgentDomainRequest,
  ) {
    const lifecycle = AgentInvocationLifecycleRequestSchema.parse(request.body);
    if (lifecycle.invocationId !== invocationId) {
      throw new BadRequestException(
        AgentPublicErrorSchema.parse({
          code: 'AGENT_INVOCATION_LIFECYCLE_INVALID',
          messageKey: 'agent.error.runtime_protocol_conflict',
          message: 'The Agent lifecycle identity does not match this request.',
          retryable: false,
          diagnosticId: randomUUID(),
        }),
      );
    }
    await this.invocations.applyLifecycle(lifecycle);
    return AgentInvocationLifecycleAcknowledgementSchema.parse({
      schemaVersion: 'agent-invocation-lifecycle-ack/v1',
      invocationId,
      attemptId: lifecycle.attemptId,
      attemptOrdinal: lifecycle.attemptOrdinal,
    });
  }
}

function bodyJobId(value: unknown): string {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    typeof (value as Record<string, unknown>).jobId !== 'string'
  ) {
    throw new BadRequestException({
      code: 'AGENT_DOCUMENT_ANALYSIS_REQUEST_INVALID',
      message: 'The document analysis request is missing its job identity.',
    });
  }
  return (value as Record<string, string>).jobId;
}

function assertPathIdentity(pathJobId: string, bodyJobIdValue: string): void {
  if (pathJobId !== bodyJobIdValue) {
    throw new BadRequestException({
      code: 'AGENT_DOCUMENT_ANALYSIS_REQUEST_INVALID',
      message: 'The document analysis path and body identities do not match.',
    });
  }
}
