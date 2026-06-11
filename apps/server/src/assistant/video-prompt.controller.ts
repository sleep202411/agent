/**
 * Thin passthrough from the frontend to Mastra's video-prompt routes.
 * Reachable at `/aurora/video-prompt/{expand,translate}` thanks to the
 * Next.js rewrite that strips the `/aurora` prefix.
 *
 * Auth/context handling mirrors WorkflowProxyController so the upstream
 * routes see the same `x-storyos-context` shape — though these particular
 * routes don't inspect project/world today, it's cheap to keep consistent.
 */
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../auth';
import { mastraFetch } from './mastra-fetch';

type JsonBody = Record<string, unknown>;

@Controller('video-prompt')
export class VideoPromptController {
  private readonly logger = new Logger(VideoPromptController.name);

  private get mastraUrl(): string {
    return (process.env.MASTRA_URL ?? 'http://localhost:4111').replace(
      /\/$/,
      '',
    );
  }

  @Post('expand')
  async expand(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.proxy('expand', body, user, req);
  }

  @Post('translate')
  async translate(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    return this.proxy('translate', body, user, req);
  }

  private async proxy(
    op: 'expand' | 'translate',
    body: JsonBody,
    user: AuthUser,
    req: Request,
  ) {
    const url = `${this.mastraUrl}/video-prompt/${op}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'accept-language': req.headers['accept-language'] ?? 'zh-CN',
      'x-storyos-context': JSON.stringify({
        userId: user.userId,
        userTier: user.userLevel ?? 'free',
      }),
    };
    const cookie = req.headers.cookie;
    if (cookie) headers.cookie = cookie;

    let upstream: globalThis.Response;
    try {
      upstream = await mastraFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body ?? {}),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Mastra upstream fetch failed: ${msg}`);
      throw new HttpException(
        { message: `Mastra upstream unavailable: ${msg}` },
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      this.logger.warn(
        `Mastra video-prompt/${op} → ${upstream.status}: ${text.slice(0, 200)}`,
      );
      const code =
        upstream.status >= 400 && upstream.status < 500
          ? upstream.status
          : HttpStatus.BAD_GATEWAY;
      throw new HttpException(
        { message: text.slice(0, 400) || 'Mastra error' },
        code,
      );
    }
    return (await upstream.json()) as { prompt: string };
  }
}
