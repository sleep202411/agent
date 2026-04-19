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
  /** Button-driven workflow trigger. Supervisor reads from requestContext and
   * skips LLM routing, dispatching the named workflow directly. */
  forceEnterWorkflow?: {
    workflowName?: unknown;
    inputData?: unknown;
  };
  /** HITL confirm/revise on an in-flight suspended workflow. */
  confirmWorkflow?: {
    runId?: unknown;
    approved?: unknown;
    feedback?: unknown;
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

  @Post('submit-message-to-agent')
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

    // Extract forceEnterWorkflow (button-driven dispatch).
    const forceEnterWorkflow =
      body.forceEnterWorkflow &&
      typeof body.forceEnterWorkflow.workflowName === 'string' &&
      body.forceEnterWorkflow.workflowName.length > 0
        ? {
            workflowName: body.forceEnterWorkflow.workflowName,
            inputData:
              body.forceEnterWorkflow.inputData &&
              typeof body.forceEnterWorkflow.inputData === 'object'
                ? (body.forceEnterWorkflow.inputData as Record<string, unknown>)
                : {},
          }
        : undefined;

    // Extract confirmWorkflow (HITL 满意 / 修改 button).
    const confirmWorkflow =
      body.confirmWorkflow &&
      typeof body.confirmWorkflow.runId === 'string' &&
      body.confirmWorkflow.runId.length > 0 &&
      typeof body.confirmWorkflow.approved === 'boolean'
        ? {
            runId: body.confirmWorkflow.runId,
            approved: body.confirmWorkflow.approved,
            feedback:
              typeof body.confirmWorkflow.feedback === 'string'
                ? body.confirmWorkflow.feedback
                : undefined,
          }
        : undefined;

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
      ...(forceEnterWorkflow ? { forceEnterWorkflow } : {}),
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

    // Button-driven signals: inject XML-style markers into the last user
    // message so the supervisor LLM sees them. Markers never hit the UI —
    // frontend Redux keeps the clean label; injection happens on the wire.
    const markers: string[] = [];
    if (forceEnterWorkflow) {
      markers.push(
        `<FORCE_WORKFLOW workflow="${forceEnterWorkflow.workflowName}" inputData=${JSON.stringify(
          forceEnterWorkflow.inputData ?? {},
        )} />`,
      );
    }
    if (confirmWorkflow) {
      const feedbackAttr = confirmWorkflow.feedback
        ? ` feedback=${JSON.stringify(confirmWorkflow.feedback)}`
        : '';
      markers.push(
        `<CONFIRM_WORKFLOW runId="${confirmWorkflow.runId}" approved=${confirmWorkflow.approved}${feedbackAttr} />`,
      );
    }
    if (markers.length > 0) {
      const markerText = `\n\n${markers.join('\n')}`;
      for (let i = (messages as unknown[]).length - 1; i >= 0; i--) {
        const m = (messages as Array<Record<string, unknown>>)[i];
        if (m?.role !== 'user') continue;
        const parts = m.parts as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(parts)) {
          const last = parts[parts.length - 1];
          if (last && last.type === 'text' && typeof last.text === 'string') {
            last.text = `${last.text as string}${markerText}`;
          } else {
            parts.push({ type: 'text', text: markerText.trimStart() });
          }
        } else if (typeof m.content === 'string') {
          m.content = `${m.content}${markerText}`;
        }
        break;
      }
    }

    // AI SDK v5-compatible chat endpoint (registered by chatRoute in apps/agent).
    // Emits UIMessageChunk events that match readUIMessageStream in the web client.
    const upstream = `${this.mastraUrl}/chat/storyos`;
    this.logger.log(
      `POST /assistant/submit-message-to-agent → ${upstream} userId=${user.userId} project=${body.projectId} messages=${messages.length}`,
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
