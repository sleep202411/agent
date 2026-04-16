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
  outline(
    @Body() body: { prompt?: string; text?: string },
    @Res() res: Response,
  ) {
    if (!body.prompt && !body.text) {
      throw new HttpException(
        'prompt or text is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = this.agent.generateOutline(body);
    return pipeWebResponseToExpress(
      result.toTextStreamResponse() as unknown as globalThis.Response,
      res,
    );
  }

  @Post('characters')
  characters(
    @Body()
    body: {
      outline: {
        title: string;
        background: string;
        conflict: string;
        episodes: { title: string; script: string }[];
      };
    },
    @Res() res: Response,
  ) {
    if (!body.outline) {
      throw new HttpException('outline is required', HttpStatus.BAD_REQUEST);
    }
    const result = this.agent.generateCharacters(body);
    return pipeWebResponseToExpress(
      result.toTextStreamResponse() as unknown as globalThis.Response,
      res,
    );
  }

  @Post('storyboard')
  storyboard(
    @Body()
    body: {
      outline: {
        title: string;
        videoStyle: string;
        aspectRatio: string;
        episodes: { title: string; script: string }[];
      };
      characters: { name: string; appearance: string }[];
      scenes: { name: string; description: string }[];
    },
    @Res() res: Response,
  ) {
    if (!body.outline || !body.characters || !body.scenes) {
      throw new HttpException(
        'outline, characters, and scenes are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const result = this.agent.generateStoryboard(body);
    return pipeWebResponseToExpress(
      result.toTextStreamResponse() as unknown as globalThis.Response,
      res,
    );
  }
}
