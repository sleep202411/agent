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
import { mastraFetch } from '../mastra-fetch';

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
      upstream = await mastraFetch(url, init);
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

  // ─── Batch run-status lookup ───────────────────────────────────────
  // Frontend's composer pill calls this every ~30s for the runIds it
  // still believes are queued/running. Returns each run's authoritative
  // server-side status so the pill can drop runs that already terminated
  // server-side but whose `tool-workflow_failed`/`completed` chat
  // message never made it into Redux (WS race, missed message_added).
  // Without this fallback, "Queued · N" could stick at N indefinitely.
  // Body: { runIds: string[] (cap 100) }, returns { [runId]: { status, workflowName? } }.
  @Post('status')
  async status(
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = String(body?.projectId ?? '');
    const runIds = Array.isArray(body?.runIds)
      ? (body.runIds.filter(
          (r): r is string => typeof r === 'string',
        ) as string[])
      : [];
    const context = this.buildContext(
      user,
      projectId ? { projectId } : undefined,
    );
    return this.forward('/workflow/status', {
      method: 'POST',
      headers: this.buildHeaders(req, context, true),
      body: JSON.stringify({ runIds }),
    });
  }

  // ─── Liveness heartbeat ────────────────────────────────────────────
  // Frontend pings every ~10s while the chat is open. Stamps the
  // run's lastHeartbeatAt; if the client stops pinging, the agent's
  // reaper cancels the run after a grace window. Hot path — keep the
  // controller body trivial and never throw on transient upstream
  // hiccups (frontend doesn't act on the result either way).
  @Post(':runId/heartbeat')
  async heartbeat(
    @Param('runId') runId: string,
    @Body() body: JsonBody,
    @CurrentUser() user: AuthUser,
    @Req() req: Request,
  ) {
    const projectId = String(body?.projectId ?? '');
    if (!projectId)
      throw new HttpException('projectId required', HttpStatus.BAD_REQUEST);
    const context = this.buildContext(user, { projectId });
    try {
      return await this.forward(
        `/workflow/${encodeURIComponent(runId)}/heartbeat`,
        {
          method: 'POST',
          headers: this.buildHeaders(req, context, true),
          body: JSON.stringify({}),
        },
      );
    } catch (err) {
      // Heartbeat is best-effort: if Mastra is down for a moment, we
      // shouldn't surface a 502 to the client (it polls every 10s, the
      // next tick will likely succeed). Log and return ok so the
      // client's retry loop doesn't pile up alerts.
      this.logger.warn(
        `[heartbeat] upstream error for runId=${runId}: ${err instanceof Error ? err.message : String(err)}`,
      );
      return { ok: false };
    }
  }

  // ─── Cancel-on-leave (sendBeacon target) ───────────────────────────
  // Browser fires this from `pagehide` via navigator.sendBeacon when
  // the user closes the tab / navigates away. sendBeacon's payload is
  // a Blob (Content-Type usually defaults to text/plain when given a
  // string), so we decouple this from the regular cancel route which
  // expects a JSON body with projectId. Here projectId comes from the
  // URL via a query param — sendBeacon makes that the only reliable
  // way to pass auxiliary data without depending on body parsing.
  //
  // The semantics are identical to /:runId/cancel — same Mastra
  // upstream call. We just tolerate sendBeacon's body quirks.
  @Post(':runId/cancel-on-leave')
  async cancelOnLeave(
    @Param('runId') runId: string,
    @Req() req: Request,
    @CurrentUser() user: AuthUser,
  ) {
    const projectId = String(req.query?.projectId ?? '');
    if (!projectId)
      throw new HttpException(
        'projectId query param required',
        HttpStatus.BAD_REQUEST,
      );
    const context = this.buildContext(user, { projectId });
    return this.forward(`/workflow/${encodeURIComponent(runId)}/cancel`, {
      method: 'POST',
      headers: this.buildHeaders(req, context, true),
      body: JSON.stringify({}),
    });
  }
}
