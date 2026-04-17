/**
 * Proxies GET /drafts/:runId from frontend to Mastra. Same pattern as
 * WorkflowProxyController — we forward auth context via `x-storyos-context`.
 */
import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../auth';

@Controller('drafts')
export class DraftsProxyController {
  private readonly logger = new Logger(DraftsProxyController.name);

  private get mastraUrl(): string {
    return (process.env.MASTRA_URL ?? 'http://localhost:4111').replace(
      /\/$/,
      '',
    );
  }

  @Get(':runId')
  async listByRun(
    @Param('runId') runId: string,
    @Query('projectId') projectId: string,
    @Query('entityType') entityType: string | undefined,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }

    const context = {
      userId: user.userId,
      projectId,
      userTier: user.userLevel ?? 'free',
    };

    const qs = entityType
      ? `?entityType=${encodeURIComponent(entityType)}`
      : '';
    const url = `${this.mastraUrl}/drafts/${encodeURIComponent(runId)}${qs}`;

    const headers: Record<string, string> = {
      Accept: 'application/json',
      'accept-language':
        (req.headers['accept-language'] as string | undefined) ?? 'zh-CN',
      'x-storyos-context': JSON.stringify(context),
    };
    const cookie = req.headers.cookie as string | undefined;
    if (cookie) headers.cookie = cookie;

    let upstream: globalThis.Response;
    try {
      upstream = await fetch(url, { method: 'GET', headers });
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
      throw new HttpException(
        { message: text.slice(0, 400) || 'Mastra error' },
        upstream.status === 404 ? HttpStatus.NOT_FOUND : HttpStatus.BAD_GATEWAY,
      );
    }
    return (await upstream.json()) as Record<string, unknown>;
  }
}
