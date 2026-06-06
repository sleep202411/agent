/**
 * Proxies GET /drafts/:runId from frontend to Mastra. Same pattern as
 * WorkflowProxyController — we forward auth context via `x-storyos-context`.
 */
import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../../auth';
import { mastraFetch } from '../mastra-fetch';

@Controller('drafts')
export class DraftsProxyController {
  private readonly logger = new Logger(DraftsProxyController.name);

  private get mastraUrl(): string {
    return (process.env.MASTRA_URL ?? 'http://localhost:4111').replace(
      /\/$/,
      '',
    );
  }

  private buildContextHeaders(
    user: AuthUser,
    projectId: string,
    req: Request,
  ): Record<string, string> {
    const context = {
      userId: user.userId,
      projectId,
      userTier: user.userLevel ?? 'free',
    };
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'accept-language': req.headers['accept-language'] ?? 'zh-CN',
      'x-storyos-context': JSON.stringify(context),
    };
    const cookie = req.headers.cookie;
    if (cookie) headers.cookie = cookie;
    return headers;
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

    const qs = entityType
      ? `?entityType=${encodeURIComponent(entityType)}`
      : '';
    const url = `${this.mastraUrl}/drafts/${encodeURIComponent(runId)}${qs}`;

    const headers = this.buildContextHeaders(user, projectId, req);

    let upstream: globalThis.Response;
    try {
      upstream = await mastraFetch(url, { method: 'GET', headers });
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

  /**
   * Patch a pending draft's `data` fields — used by the chat panel's
   * DraftDetailDialog to persist inline prompt edits (e.g. the Seedance
   * 2.0 wrapper) before the user confirms the workflow.
   */
  @Post(':runId/:clientRefId')
  async updateDraft(
    @Param('runId') runId: string,
    @Param('clientRefId') clientRefId: string,
    @Query('projectId') projectId: string,
    @Body() body: { data?: Record<string, unknown> },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    if (!body?.data || typeof body.data !== 'object') {
      throw new HttpException(
        'body.data must be an object',
        HttpStatus.BAD_REQUEST,
      );
    }

    const url = `${this.mastraUrl}/drafts/${encodeURIComponent(
      runId,
    )}/${encodeURIComponent(clientRefId)}`;
    const headers = {
      ...this.buildContextHeaders(user, projectId, req),
      'Content-Type': 'application/json',
    };

    let upstream: globalThis.Response;
    try {
      upstream = await mastraFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ data: body.data }),
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
      throw new HttpException(
        { message: text.slice(0, 400) || 'Mastra error' },
        upstream.status === 404
          ? HttpStatus.NOT_FOUND
          : upstream.status === 409
            ? HttpStatus.CONFLICT
            : HttpStatus.BAD_GATEWAY,
      );
    }
    return (await upstream.json()) as Record<string, unknown>;
  }
}
