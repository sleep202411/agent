import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AssistantService } from './assistant.service';
import { pipeWebResponseToExpress } from '../common/stream.util';
import { CurrentUser, type AuthUser } from '../auth';

@Controller('assistant')
export class AssistantController {
  private readonly logger = new Logger(AssistantController.name);

  constructor(private readonly assistant: AssistantService) {}

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
      `POST /assistant/chat userId=${user.userId} projectId=${body.projectId} agentType=${body.agentType ?? 'general'} messages=${body.messages?.length ?? 0}`,
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
          userId: user.userId,
          userTier: user.userLevel ?? 'free',
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
