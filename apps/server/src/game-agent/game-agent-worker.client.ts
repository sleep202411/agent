import {
  BadGatewayException,
  BadRequestException,
  ForbiddenException,
  GoneException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  AppearanceDesignResultSchema,
  AppearanceWebOpenResultSchema,
  AppearanceWebPollResultSchema,
  AppearanceWebCloseResultSchema,
  type AppearanceDesignRequest,
  type AppearanceWebAction,
} from '@repo/game-agent-protocol';
import { z } from 'zod';
import { GameAgentConfigService } from './game-agent.config';

const WORKING_COPY = {
  'en-US': {
    working: 'Updating the appearance…',
    workingFor: 'Updating the appearance · {duration}',
  },
  'zh-CN': {
    working: '正在调整样式…',
    workingFor: '正在调整样式 · {duration}',
  },
  'zh-HK': {
    working: '正在調整樣式…',
    workingFor: '正在調整樣式 · {duration}',
  },
} as const;

@Injectable()
export class GameAgentWorkerClient {
  constructor(private readonly config: GameAgentConfigService) {}

  async controlAppearanceWeb(
    action: AppearanceWebAction,
    scope: { userId: string; projectId: string },
    signal: AbortSignal,
  ) {
    const body = {
      ...action,
      scope,
      ...(action.action === 'open'
        ? {
            parentOrigin: this.config.value.studioOrigin,
            copy: WORKING_COPY[action.request.locale],
          }
        : {}),
    };
    const result = await this.requestJson(
      '/v1/game-agent/appearance/web',
      body,
      signal,
    );
    if (action.action === 'open') {
      const parsed = AppearanceWebOpenResultSchema.safeParse(result);
      if (!parsed.success || parsed.data.leaseId !== action.leaseId)
        throw new BadGatewayException(
          'Game Agent session does not match this request.',
        );
      return {
        ...parsed.data,
        // The listener is private worker infrastructure, never a browser URL.
        url: `/aurora/game-agent/projects/${scope.projectId}/appearance/web/${parsed.data.id}/`,
      };
    }
    const parsed =
      action.action === 'poll'
        ? AppearanceWebPollResultSchema.safeParse(result)
        : AppearanceWebCloseResultSchema.safeParse(result);
    if (!parsed.success)
      throw new BadGatewayException(
        'Game Agent returned an invalid session response.',
      );
    return parsed.data;
  }

  async designAppearance(body: AppearanceDesignRequest, signal: AbortSignal) {
    const json = await this.requestJson(
      '/v1/game-agent/appearance/design',
      body,
      signal,
    );
    const parsed = AppearanceDesignResultSchema.safeParse(json);
    if (!parsed.success || parsed.data.requestId !== body.requestId)
      throw new BadGatewayException(
        'Game Agent result does not match this request.',
      );
    return parsed.data;
  }

  private async requestJson(path: string, body: unknown, signal: AbortSignal) {
    signal.throwIfAborted();
    let response: Response;
    try {
      response = await fetch(`${this.config.value.workerBaseUrl}${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-game-agent-internal-token': this.config.value.internalToken,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.any([signal, AbortSignal.timeout(125_000)]),
      });
    } catch {
      signal.throwIfAborted();
      throw new ServiceUnavailableException('Game Agent is unavailable.');
    }
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      throw new BadGatewayException(
        'Game Agent returned an invalid JSON response.',
      );
    }
    if (!response.ok) {
      const error = z
        .object({ error: z.object({ message: z.string() }) })
        .safeParse(json);
      const failure = {
        code: 'GAME_AGENT_DESIGN_FAILED',
        message: error.success
          ? error.data.error.message.replaceAll(
              this.config.value.internalToken,
              '[redacted]',
            )
          : `Game Agent returned HTTP ${response.status}.`,
      };
      if (response.status === 404) throw new NotFoundException(failure);
      if (response.status === 410) throw new GoneException(failure);
      if (response.status === 403) throw new ForbiddenException(failure);
      if (response.status === 400) throw new BadRequestException(failure);
      throw new ServiceUnavailableException(failure);
    }
    return json;
  }
}
