import {
  Controller,
  Post,
  Get,
  Param,
  Body,
  Req,
  Res,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AssistantService } from './assistant.service';
import { ScriptAgentService } from '../pipeline/script-agent.service';
import { pipeWebResponseToExpress } from '../common/stream.util';

@Controller('assistant')
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(
    private readonly assistant: AssistantService,
    private readonly scriptAgent: ScriptAgentService,
  ) {}

  /**
   * GET /assistant/progress/:sessionId
   * Returns analyze progress for frontend polling.
   */
  @Get('progress/:sessionId')
  async getProgress(@Param('sessionId') sessionId: string) {
    const progress = await this.scriptAgent.getProgress(sessionId);
    if (!progress) {
      return {
        phase: 'unknown',
        current: 0,
        total: 0,
        message: 'Session not found',
      };
    }
    return progress;
  }

  @Post('chat')
  async chat(
    @Body()
    body: {
      projectId?: string;
      messages?: unknown[];
      workspaceContext?: Record<string, unknown>;
      agentType?: string;
    },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.logger.log(
      `POST /assistant/chat projectId=${body.projectId} agentType=${body.agentType ?? 'general'} messages=${body.messages?.length ?? 0}`,
    );

    if (
      !body.projectId ||
      !Array.isArray(body.messages) ||
      body.messages.length === 0
    ) {
      throw new HttpException(
        'projectId and messages are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.assistant.chat(
        {
          projectId: body.projectId,
          messages: body.messages,
          workspaceContext: body.workspaceContext,
          agentType: body.agentType,
        },
        req.headers as Record<string, string | string[] | undefined>,
      );

      const webResponse =
        result.toUIMessageStreamResponse() as unknown as globalThis.Response;
      return pipeWebResponseToExpress(webResponse, res);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Internal error';
      this.logger.error(`Chat failed: ${message}`);
      throw new HttpException({ message }, HttpStatus.BAD_REQUEST);
    }
  }
}
