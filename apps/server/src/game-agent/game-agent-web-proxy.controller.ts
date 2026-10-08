import {
  All,
  Controller,
  Param,
  ParseUUIDPipe,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { CurrentUser, type AuthUser } from '../auth';
import { GameAgentWebTransportService } from './game-agent-web-transport.service';

@Controller('game-agent/projects/:projectId/appearance')
export class GameAgentWebProxyController {
  constructor(private readonly transport: GameAgentWebTransportService) {}

  @All(['web/:id', 'web/:id/{*path}'])
  proxy(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Req() request: Request,
    @Res() response: Response,
  ) {
    return this.transport.proxy(user, projectId, id, request, response);
  }
}
