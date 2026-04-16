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
   * Client sends full messages array. Server validates, calls LLM, streams back.
   */
  @Post('chat')
  async chat(
    @Body()
    body: {
      projectId?: string;
      messages?: unknown[];
      workspaceContext?: Record<string, unknown>;
      agentType?: string;
    },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    this.logger.log(
      `POST /assistant/chat userId=${user.userId} projectId=${body.projectId} messages=${body.messages?.length ?? 0}`,
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

    // Check message limit from server-side count (authoritative, not client-supplied)
    const serverCount = await this.assistant.getServerMessageCount(
      user.userId,
      body.projectId,
    );
    const limits = getLimitsForTier(user.userLevel ?? undefined);
    if (serverCount >= limits.maxMessages) {
      throw new HttpException(
        {
          code: 'MESSAGE_LIMIT_REACHED',
          message: `Message limit reached (${serverCount}/${limits.maxMessages})`,
          current: serverCount,
          max: limits.maxMessages,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    try {
      const result = await this.assistant.chat(
        {
          projectId: body.projectId,
          messages: body.messages,
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
   * POST /assistant/save
   * Frontend saves messages to Redis after stream completes.
   */
  @Post('save')
  async save(
    @Body()
    body: {
      projectId?: string;
      messages?: unknown[];
    },
    @CurrentUser() user: AuthUser,
  ) {
    if (!body.projectId || !Array.isArray(body.messages)) {
      throw new HttpException(
        'projectId and messages are required',
        HttpStatus.BAD_REQUEST,
      );
    }

    await this.assistant.saveConversation(
      user.userId,
      body.projectId,
      body.messages,
      user.userLevel ?? undefined,
    );

    return { success: true };
  }

  /**
   * GET /assistant/history/:projectId
   */
  @Get('history/:projectId')
  async history(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
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
        messageLimit: result.messageLimit,
        retentionDays: result.retentionDays,
        tier: user.userLevel ?? 'free',
      },
    };
  }

  /**
   * POST /assistant/clear/:projectId
   */
  @Post('clear/:projectId')
  async clear(
    @Param('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
  ) {
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
