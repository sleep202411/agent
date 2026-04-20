/**
 * Proxies workflow + drafts REST traffic from the frontend to the Mastra
 * agent server. Upstream routes live in apps/agent's Mastra `apiRoutes`;
 * we inject the authenticated `x-storyos-context` header so Mastra's
 * middleware can populate the requestContext.
 *
 * Mirrors the shape of the existing `/assistant/submit-message-to-agent` proxy.
 */
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { CurrentUser, type AuthUser } from '../../auth';

type JsonBody = Record<string, unknown>;

type ContextHeader = {
  userId: string;
  projectId: string;
  worldId?: string;
  episodeId?: string;
  locale?: string;
  userTier?: string;
};

@Controller('workflow')
export class WorkflowProxyController {
  private readonly logger = new Logger(WorkflowProxyController.name);

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
    workspaceContext?: Record<string, unknown>,
  ): ContextHeader {
    return {
      userId: user.userId,
      projectId: String(workspaceContext?.projectId ?? ''),
      worldId: workspaceContext?.worldId
        ? String(workspaceContext.worldId)
        : undefined,
      episodeId: workspaceContext?.episodeId
        ? String(workspaceContext.episodeId)
        : undefined,
      locale:
        typeof workspaceContext?.locale === 'string'
          ? workspaceContext.locale
          : undefined,
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
      this.logger.error(`Mastra upstream fetch failed (${path}): ${msg}`);
      throw new HttpException(
        { message: `Mastra upstream unavailable: ${msg}` },
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (!upstream.ok) {
      const text = await upstream.text().catch(() => '');
      this.logger.warn(
        `Mastra ${init.method} ${path} → ${upstream.status}: ${text.slice(0, 200)}`,
      );
      // Pass through client-error codes (400/401/403/404/409/422) so the
      // frontend sees a meaningful status instead of a generic 502. Only
      // genuine upstream server errors (5xx) or unreachables become 502.
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

  // ─── Deterministic start (button-bypass) ───────────────────────────
  // Frontend "continue" buttons hit this when they know the exact next
  // workflow to run, skipping the supervisor LLM.

  @Post('start')
  async start(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = String(body.projectId ?? '');
    const workflowName = String(body.workflowName ?? '');
    if (!projectId || !workflowName) {
      throw new HttpException(
        'projectId and workflowName required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const worldId = body.worldId ? String(body.worldId) : undefined;
    const context = this.buildContext(user, { projectId, worldId });
    return this.forward('/workflow/start', {
      method: 'POST',
      headers: this.buildHeaders(req, context, true),
      body: JSON.stringify({
        workflowName,
        inputData: body.inputData ?? {},
      }),
    });
  }

  // ─── Confirm / cancel ──────────────────────────────────────────────

  @Post(':runId/confirm')
  async confirm(
    @Param('runId') runId: string,
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = String(body.projectId ?? '');
    if (!projectId)
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    const context = this.buildContext(user, { projectId });
    const payload = {
      approved: Boolean(body.approved ?? false),
      feedback: body.feedback,
      acceptedClientRefIds: body.acceptedClientRefIds,
    };
    return this.forward(`/workflow/${encodeURIComponent(runId)}/confirm`, {
      method: 'POST',
      headers: this.buildHeaders(req, context, true),
      body: JSON.stringify(payload),
    });
  }

  @Post(':runId/cancel')
  async cancel(
    @Param('runId') runId: string,
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = String(body.projectId ?? '');
    if (!projectId)
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    const context = this.buildContext(user, { projectId });
    return this.forward(`/workflow/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers: this.buildHeaders(req, context, true),
      body: JSON.stringify({}),
    });
  }
}
