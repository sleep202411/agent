import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { Readable } from 'stream';
import { CurrentUser, type AuthUser } from '../auth';
import { preprocessMessages } from './message-preprocess';

type MastraChatBody = {
  projectId?: string;
  messages?: unknown[];
  workspaceContext?: {
    worldId?: unknown;
    episodeId?: unknown;
    activeTab?: unknown;
    activePanel?: unknown;
    locale?: unknown;
  };
};

@Controller('assistant')
export class MastraProxyController {
  private readonly logger = new Logger(MastraProxyController.name);

  private get mastraUrl() {
    return (process.env.MASTRA_URL ?? 'http://localhost:4111').replace(
      /\/$/,
      '',
    );
  }

  @Post('stream-v2')
  async stream(
    @Body() body: MastraChatBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
    @Res() res: Response,
  ) {
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

    const context = {
      userId: user.userId,
      projectId: body.projectId,
      worldId: body.workspaceContext?.worldId
        ? String(body.workspaceContext.worldId)
        : undefined,
      episodeId: body.workspaceContext?.episodeId
        ? String(body.workspaceContext.episodeId)
        : undefined,
      activeTab:
        typeof body.workspaceContext?.activeTab === 'string'
          ? body.workspaceContext.activeTab
          : undefined,
      activePanel:
        typeof body.workspaceContext?.activePanel === 'string'
          ? body.workspaceContext.activePanel
          : undefined,
      locale:
        typeof body.workspaceContext?.locale === 'string'
          ? body.workspaceContext.locale
          : undefined,
      userTier: user.userLevel ?? 'free',
    };

    // Extract attachment text server-side, strip file parts. See
    // message-preprocess.ts for rationale — OSS/Java URLs aren't fetchable
    // by Mastra's downloadFromUrl, so we resolve them here first.
    const messages = body.messages as Parameters<typeof preprocessMessages>[0];
    try {
      await preprocessMessages(messages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Message preprocess failed: ${msg}`);
      // Keep going — text parts still reach the agent.
    }

    // AI SDK v5-compatible chat endpoint (registered by chatRoute in apps/agent).
    // Emits UIMessageChunk events that match readUIMessageStream in the web client.
    const upstream = `${this.mastraUrl}/chat/storyos`;
    this.logger.log(
      `POST /assistant/stream-v2 → ${upstream} userId=${user.userId} project=${body.projectId} messages=${messages.length}`,
    );

    const cookie = (req.headers.cookie as string | undefined) ?? '';
    const acceptLanguage =
      (req.headers['accept-language'] as string | undefined) ?? 'zh-CN';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'accept-language': acceptLanguage,
      'x-storyos-context': JSON.stringify(context),
    };
    if (cookie) headers.cookie = cookie;

    let upstreamResponse: globalThis.Response;
    try {
      upstreamResponse = await fetch(upstream, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages }),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Mastra upstream fetch failed: ${msg}`);
      throw new HttpException(
        { message: `Mastra upstream unavailable: ${msg}` },
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (!upstreamResponse.ok) {
      const text = await upstreamResponse.text().catch(() => '');
      this.logger.error(
        `Mastra returned ${upstreamResponse.status}: ${text.slice(0, 300)}`,
      );
      throw new HttpException(
        { message: `Mastra error: ${text.slice(0, 300)}` },
        upstreamResponse.status === 401
          ? HttpStatus.UNAUTHORIZED
          : HttpStatus.BAD_GATEWAY,
      );
    }

    upstreamResponse.headers.forEach((value, key) => {
      if (key.toLowerCase() === 'content-length') return;
      res.setHeader(key, value);
    });

    if (!upstreamResponse.body) {
      res.end();
      return;
    }

    const nodeStream = Readable.fromWeb(
      upstreamResponse.body as import('stream/web').ReadableStream,
    );

    // Must attach an error listener BEFORE pipe() — otherwise any upstream
    // failure (Mastra premature close, socket abort, etc.) crashes the whole
    // NestJS process with "Unhandled 'error' event".
    nodeStream.on('error', (err) => {
      this.logger.warn(
        `Upstream stream error: ${err instanceof Error ? err.message : err}`,
      );
      if (!res.headersSent) {
        res.status(HttpStatus.BAD_GATEWAY).json({ message: 'stream error' });
      } else {
        // Client already saw partial chunks; just end the response.
        res.end();
      }
    });
    res.on('error', (err) => {
      this.logger.warn(
        `Client response error: ${err instanceof Error ? err.message : err}`,
      );
    });
    res.on('close', () => {
      // If the browser closed first, stop reading upstream so we don't hang.
      if (!nodeStream.destroyed) nodeStream.destroy();
    });

    nodeStream.pipe(res);
  }
}
