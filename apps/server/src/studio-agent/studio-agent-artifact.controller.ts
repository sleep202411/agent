import { Body, Controller, Delete, Param, Post } from '@nestjs/common';
import {
  StudioAgentRegisterAttachmentRequestSchema,
  type StudioAgentRegisterAttachmentRequest,
} from '@repo/shared/studio-agent-api';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import {
  StudioAgentArtifactParamsSchema,
  StudioAgentThreadParamsSchema,
  type StudioAgentArtifactParams,
  type StudioAgentThreadParams,
} from './studio-agent.dto';
import { StudioAgentArtifactService } from './studio-agent-artifact.service';

@Controller('studio-agent/threads/:threadId/attachments')
export class StudioAgentArtifactController {
  constructor(private readonly artifacts: StudioAgentArtifactService) {}

  @Post()
  async register(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentThreadParamsSchema))
    params: StudioAgentThreadParams,
    @Body(new ZodValidationPipe(StudioAgentRegisterAttachmentRequestSchema))
    body: StudioAgentRegisterAttachmentRequest,
  ) {
    return {
      code: 200,
      data: await this.artifacts.register(user, params.threadId, body),
    };
  }

  @Delete(':artifactId')
  async deleteUnbound(
    @CurrentUser() user: AuthUser,
    @Param(new ZodValidationPipe(StudioAgentArtifactParamsSchema))
    params: StudioAgentArtifactParams,
  ) {
    return {
      code: 200,
      data: await this.artifacts.deleteUnbound(
        user,
        params.threadId,
        params.artifactId,
      ),
    };
  }
}
