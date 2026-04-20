/**
 * Proxies the frontend's /aurora/assets/* traffic through to Mastra's
 * corresponding /assets/* routes. Injects x-storyos-context so Mastra's
 * middleware can populate requestContext with userId/projectId.
 *
 * Two endpoints today:
 *   - GET /aurora/assets/image-status?projectId=X
 *   - POST /aurora/assets/:assetType/:assetId/regenerate-image
 *
 * Both are frontend-facing and go through AuthGuard like the rest of the
 * v3 proxies.
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
import { CurrentUser, type AuthUser } from '../auth';

type ContextHeader = {
  userId: string;
  projectId: string;
  worldId?: string;
  episodeId?: string;
  locale?: string;
  userTier?: string;
};

@Controller('assets')
export class AssetsProxyController {
  private readonly logger = new Logger(AssetsProxyController.name);

  private get mastraUrl(): string {
    return (process.env.MASTRA_URL ?? 'http://localhost:4111').replace(
      /\/$/,
      '',
    );
  }

  private buildHeaders(
    req: Request,
    context: ContextHeader,
    hasBody: boolean,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'accept-language':
        (req.headers['accept-language'] as string | undefined) ?? 'zh-CN',
      'x-storyos-context': JSON.stringify(context),
    };
    if (hasBody) headers['Content-Type'] = 'application/json';
    const cookie = req.headers.cookie as string | undefined;
    if (cookie) headers.cookie = cookie;
    return headers;
  }

  private buildContext(
    user: AuthUser,
    workspaceContext: { projectId: string; worldId?: string },
  ): ContextHeader {
    return {
      userId: user.userId,
      projectId: workspaceContext.projectId,
      worldId: workspaceContext.worldId,
      userTier: user.userLevel ?? 'free',
    };
  }

  private async forward<T = unknown>(
    path: string,
    init: {
      method: 'GET' | 'POST';
      headers: Record<string, string>;
      body?: string;
    },
  ): Promise<T> {
    const url = `${this.mastraUrl}${path}`;
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(url, init);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Mastra assets fetch failed (${path}): ${msg}`);
      throw new HttpException(
        { message: `Mastra unavailable: ${msg}` },
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      // Pass 4xx through unchanged; 5xx / unreachables become 502.
      const code =
        upstream.status >= 400 && upstream.status < 500
          ? upstream.status
          : HttpStatus.BAD_GATEWAY;
      throw new HttpException(
        { message: text.slice(0, 400) || 'Mastra error' },
        code,
      );
    }
    return (await upstream.json()) as T;
  }

  @Get('image-status')
  async imageStatus(
    @Query('projectId') projectId: string,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, { projectId });
    return this.forward('/assets/image-status', {
      method: 'GET',
      headers: this.buildHeaders(req, context, false),
    });
  }

  @Post(':assetType/:assetId/regenerate-image')
  async regenerate(
    @Param('assetType') assetType: string,
    @Param('assetId') assetId: string,
    @Body()
    body: {
      projectId?: string;
      worldId?: string;
      prompt?: string;
      assetName?: string;
    },
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    // Validate assetType before any body fields — cheap discriminator, and
    // tests that intentionally pass a bad type should see the right error
    // regardless of what else is in the body.
    if (assetType !== 'role' && assetType !== 'scene' && assetType !== 'prop') {
      throw new HttpException(
        'assetType must be role / scene / prop',
        HttpStatus.BAD_REQUEST,
      );
    }
    const projectId = String(body.projectId ?? '');
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    if (!body.prompt || !String(body.prompt).trim()) {
      throw new HttpException('prompt required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, {
      projectId,
      worldId: body.worldId ? String(body.worldId) : undefined,
    });
    return this.forward(
      `/assets/${encodeURIComponent(assetType)}/${encodeURIComponent(assetId)}/regenerate-image`,
      {
        method: 'POST',
        headers: this.buildHeaders(req, context, true),
        body: JSON.stringify({
          prompt: String(body.prompt),
          assetName: body.assetName ? String(body.assetName) : undefined,
        }),
      },
    );
  }
}
