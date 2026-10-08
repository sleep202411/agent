import {
  Body,
  Controller,
  ForbiddenException,
  Header,
  Headers,
  Param,
  ParseUUIDPipe,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  AppearanceDesignRequestSchema,
  AppearanceWebActionSchema,
  type AppearanceDesignRequest,
  type AppearanceWebAction,
} from '@repo/game-agent-protocol';
import { CurrentUser, type AuthUser } from '../auth';
import { ZodValidationPipe } from '../common/zod.pipe';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { GameAgentWorkerClient } from './game-agent-worker.client';
import { GameAgentConfigService } from './game-agent.config';

/** Preview-only appearance generation. No project or runtime mutation. */
@Controller('game-agent/projects/:projectId/appearance')
export class GameAgentAppearanceController {
  constructor(
    private readonly permissions: StoryPermissionService,
    private readonly worker: GameAgentWorkerClient,
    private readonly config: GameAgentConfigService,
  ) {}

  @Post('web')
  @Header('Cache-Control', 'no-store')
  async web(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(AppearanceWebActionSchema))
    body: AppearanceWebAction,
    @Headers('origin') origin: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    if (origin !== this.config.value.studioOrigin)
      throw new ForbiddenException(
        'Game Agent requires the trusted Studio origin.',
      );
    const controller = new AbortController();
    const disconnect = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', disconnect);
    try {
      const { project, capabilities } = await this.permissions.requireProject(
        user.userId,
        projectId,
        'story.generate',
      );
      if (!capabilities.includes('story.edit'))
        throw new ForbiddenException(
          'You do not have permission to edit this story.',
        );
      if (response.destroyed) controller.abort();
      controller.signal.throwIfAborted();
      const action =
        body.action === 'open'
          ? {
              ...body,
              request: {
                ...body.request,
                context: {
                  ...body.request.context,
                  title: project.title.slice(0, 200),
                },
              },
            }
          : body;
      return {
        code: 200,
        data: await this.worker.controlAppearanceWeb(
          action,
          { userId: user.userId, projectId },
          controller.signal,
        ),
      };
    } finally {
      response.off('close', disconnect);
    }
  }

  @Post('design')
  @Header('Cache-Control', 'no-store')
  async design(
    @CurrentUser() user: AuthUser,
    @Param('projectId', ParseUUIDPipe) projectId: string,
    @Body(new ZodValidationPipe(AppearanceDesignRequestSchema))
    body: AppearanceDesignRequest,
    @Res({ passthrough: true }) response: Response,
  ) {
    const controller = new AbortController();
    const disconnect = () => {
      if (!response.writableEnded) controller.abort();
    };
    response.once('close', disconnect);
    try {
      // This also rejects archived, inaccessible and non-Story projects.
      const { project } = await this.permissions.requireProject(
        user.userId,
        projectId,
        'story.generate',
      );
      if (response.destroyed) controller.abort();
      controller.signal.throwIfAborted();
      const result = await this.worker.designAppearance(
        {
          ...body,
          context: { ...body.context, title: project.title.slice(0, 200) },
        },
        controller.signal,
      );
      return { code: 200, data: result };
    } finally {
      response.off('close', disconnect);
    }
  }
}
