import {
  Controller,
  Post,
  Body,
  Res,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import { AgentService } from './agent.service';
import { pipeWebResponseToExpress } from '../common/stream.util';

@Controller('agent')
export class AgentController {
  constructor(private readonly agent: AgentService) {}

  @Post('outline')
  async outline(
    @Body() body: { prompt?: string; text?: string },
    @Res() res: Response,
  ) {
    if (!body.prompt && !body.text) {
      throw new HttpException(
        'prompt or text is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.agent.generateOutline(body);
    return pipeWebResponseToExpress(
      result.toTextStreamResponse() as unknown as globalThis.Response,
      res,
    );
  }

  @Post('characters')
  async characters(
    @Body() body: { outline?: Record<string, unknown> },
    @Res() res: Response,
  ) {
    if (!body.outline) {
      throw new HttpException('outline is required', HttpStatus.BAD_REQUEST);
    }
    const result = await this.agent.generateCharacters(body as any);
    return pipeWebResponseToExpress(
      result.toTextStreamResponse() as unknown as globalThis.Response,
      res,
    );
  }

  @Post('storyboard')
  async storyboard(
    @Body()
    body: {
      outline?: Record<string, unknown>;
      characters?: unknown[];
      scenes?: unknown[];
    },
    @Res() res: Response,
  ) {
    if (!body.outline || !body.characters || !body.scenes) {
      throw new HttpException(
        'outline, characters, and scenes are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = await this.agent.generateStoryboard(body as any);
    return pipeWebResponseToExpress(
      result.toTextStreamResponse() as unknown as globalThis.Response,
      res,
    );
  }
}
