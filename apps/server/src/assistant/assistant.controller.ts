import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  Req,
  Res,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AssistantService, MessageLimitError } from './assistant.service';
import { getLimitsForTier } from './conversation.service';
import { pipeWebResponseToExpress } from '../common/stream.util';
import { CurrentUser, type AuthUser } from '../auth';

@Controller('assistant')
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(private readonly assistant: AssistantService) {}

  /**
   * POST /assistant/chat
   * Client sends a single new user message. Server loads history, appends,
   * calls LLM, persists the assistant reply, and streams back.
   */
  @Post('chat')
  async chat(
    @Body()
    body: {
      projectId?: string;
      /** Single new user message */
      userMessage?: unknown;
      workspaceContext?: Record<string, unknown>;
      agentType?: string;
    },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.logger.log(
      `POST /assistant/chat userId=${user.userId} projectId=${body.projectId} agentType=${body.agentType ?? 'general'}`,
    );

    if (!body.projectId || !body.userMessage) {
      throw new HttpException(
        'projectId and userMessage are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const result = await this.assistant.chat(
        {
          projectId: body.projectId,
          userMessage: body.userMessage as never,
          workspaceContext: body.workspaceContext,
          agentType: body.agentType,
          userId: user.userId,
          userTier: user.userLevel ?? undefined,
        },
        req.headers as Record<string, string | string[] | undefined>,
      );

      const webResponse =
        result.toUIMessageStreamResponse() as unknown as globalThis.Response;
      return pipeWebResponseToExpress(webResponse, res);
    } catch (error) {
      if (error instanceof MessageLimitError) {
        throw new HttpException(
          {
            code: error.code,
            message: error.message,
            current: error.current,
            max: error.max,
          },
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }
      const message = error instanceof Error ? error.message : 'Internal error';
      this.logger.error(`Chat failed: ${message}`);
      throw new HttpException({ message }, HttpStatus.BAD_REQUEST);
    }
  }

  /**
   * GET /assistant/history/:projectId
   * Load conversation history for the current user + project.
   */
  @Get('history/:projectId')
  async history(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    this.logger.log(
      `GET /assistant/history userId=${user.userId} projectId=${projectId}`,
    );

    const result = await this.assistant.getHistory(
      user.userId,
      projectId,
      user.userLevel ?? undefined,
    );

    return {
      success: true,
      data: {
        conversationId: result.conversationId,
        messages: result.messages,
        messageCount: result.messageCount,
        retentionDays: result.retentionDays,
        messageLimit: result.messageLimit,
        tier: user.userLevel ?? 'free',
      },
    };
  }

  /**
   * POST /assistant/clear/:projectId
   * Clear conversation history (start new conversation).
   */
  @Post('clear/:projectId')
  async clear(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
    this.logger.log(
      `POST /assistant/clear userId=${user.userId} projectId=${projectId}`,
    );

    await this.assistant.clearHistory(user.userId, projectId);

    const limits = getLimitsForTier(user.userLevel ?? undefined);
    return {
      success: true,
      data: {
        messageCount: 0,
        messageLimit: limits.maxMessages,
      },
    };
  }
}
