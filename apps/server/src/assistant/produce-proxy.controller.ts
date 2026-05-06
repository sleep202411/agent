/**
 * Proxies /aurora/produce/* to Mastra's produce-mode routes.
 *
 * Produce mode is intentionally outside the StoryOS chat message stream:
 * Step 1 creates an ephemeral draft, and only /commit persists it.
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

type JsonBody = Record<string, unknown>;

type ContextHeader = {
  userId: string;
  projectId: string;
  worldId?: string;
  locale?: string;
  dialogLanguage?: string;
  userTier?: string;
};

@Controller('produce')
export class ProduceProxyController {
  private readonly logger = new Logger(ProduceProxyController.name);

  private get mastraUrl(): string {
    return (process.env.MASTRA_URL ?? 'http://localhost:4111').replace(
      /\/$/,
      '',
    );
  }

  private buildHeaders(
    req: Request,
    context: ContextHeader,
  ): Record<string, string> {
    const acceptLanguage = req.headers['accept-language'];
    const headers: Record<string, string> = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'accept-language':
        (Array.isArray(acceptLanguage)
          ? acceptLanguage.join(',')
          : acceptLanguage) ?? 'zh-CN',
      'x-storyos-context': JSON.stringify(context),
    };
    const cookie = req.headers.cookie;
    if (cookie) headers.cookie = cookie;
    return headers;
  }

  private buildContext(user: AuthUser, body: JsonBody): ContextHeader {
    const seed =
      body.seed && typeof body.seed === 'object'
        ? (body.seed as Record<string, unknown>)
        : {};
    const projectId = scalarString(body.projectId) ?? '';
    const worldId = scalarString(body.worldId) ?? scalarString(seed.worldId);
    const language = scalarString(seed.language);
    return {
      userId: user.userId,
      projectId,
      worldId,
      dialogLanguage: language,
      userTier: user.userLevel ?? 'free',
    };
  }

  private async forward<T = unknown>(
    path: string,
    req: Request,
    context: ContextHeader,
    body: JsonBody,
  ): Promise<T> {
    const url = `${this.mastraUrl}${path}`;
    let upstream: globalThis.Response;
    try {
      upstream = await fetch(url, {
        method: 'POST',
        headers: this.buildHeaders(req, context),
        body: JSON.stringify(body),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`Mastra produce fetch failed (${path}): ${msg}`);
      throw new HttpException(
        { message: `Mastra unavailable: ${msg}` },
        HttpStatus.BAD_GATEWAY,
      );
    }
    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
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

  @Post('script-draft/start')
  async start(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = scalarString(body.projectId);
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, body);
    return this.forward('/produce/script-draft/start', req, context, body);
  }

  @Post('script-draft/status')
  async status(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const context = this.buildContext(user, body);
    return this.forward('/produce/script-draft/status', req, context, body);
  }

  @Post('script-draft/cancel')
  async cancel(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const context = this.buildContext(user, body);
    return this.forward('/produce/script-draft/cancel', req, context, body);
  }

  @Post('script-draft/commit')
  async commit(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = scalarString(body.projectId);
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, body);
    return this.forward('/produce/script-draft/commit', req, context, body);
  }

  @Post('script-draft/committed')
  async committed(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = scalarString(body.projectId);
    if (!projectId) {
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    }
    const context = this.buildContext(user, body);
    return this.forward('/produce/script-draft/committed', req, context, body);
  }
}

function scalarString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}
