import {
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { CurrentUser, type AuthUser } from '../auth';
import { preprocessMessages } from './message-preprocess';
import { WorkspaceService } from './workspace.service';
import {
  MessageStoreService,
  type StoredMessage,
} from './chat/message-store.service';
import { AgentStreamService } from './chat/agent-stream.service';

type MastraChatBody = {
  projectId?: string;
  messages?: unknown[];
  workspaceContext?: {
    worldId?: unknown;
    episodeId?: unknown;
    activeTab?: unknown;
    activePanel?: unknown;
    locale?: unknown;
    dialogLanguage?: unknown;
    stylePainting?: unknown;
    shotsPerEpisode?: unknown;
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
  /**
   * User clicked "儲存並繼續" on the ProjectParamsForm. Nest saves to Java and
   * tags the user message with <PROJECT_PARAMS_CONFIRMED /> so supervisor
   * narrates the confirmation without re-doing the save.
   */
  confirmProjectParams?: {
    aspectRatioType?: unknown;
    chapterLength?: unknown;
    stylePainting?: unknown;
    dialogLanguage?: unknown;
  };
};

@Controller('assistant')
export class MastraProxyController {
  private readonly logger = new Logger(MastraProxyController.name);

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly store: MessageStoreService,
    private readonly agentStream: AgentStreamService,
  ) {}

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

    // Extract confirmProjectParams (ProjectParamsForm 儲存並繼續 button).
    const confirmProjectParams =
      body.confirmProjectParams &&
      typeof body.confirmProjectParams.aspectRatioType === 'string' &&
      typeof body.confirmProjectParams.stylePainting === 'string' &&
      typeof body.confirmProjectParams.chapterLength === 'number' &&
      body.confirmProjectParams.chapterLength > 0
        ? {
            aspectRatioType: body.confirmProjectParams.aspectRatioType,
            chapterLength: body.confirmProjectParams.chapterLength,
            stylePainting: body.confirmProjectParams.stylePainting,
            dialogLanguage:
              typeof body.confirmProjectParams.dialogLanguage === 'string'
                ? body.confirmProjectParams.dialogLanguage
                : 'zh-CN',
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
      // Project-level params — user picks in ProjectParamsForm, flows
      // through every submit. Not persisted by Java yet (client mirrors
      // in localStorage), so we rely on the client to resend them.
      dialogLanguage:
        typeof body.workspaceContext?.dialogLanguage === 'string'
          ? body.workspaceContext.dialogLanguage
          : undefined,
      stylePainting:
        typeof body.workspaceContext?.stylePainting === 'string'
          ? body.workspaceContext.stylePainting
          : undefined,
      shotsPerEpisode:
        typeof body.workspaceContext?.shotsPerEpisode === 'number' &&
        Number.isFinite(body.workspaceContext.shotsPerEpisode)
          ? body.workspaceContext.shotsPerEpisode
          : undefined,
      userTier: user.userLevel ?? 'free',
      ...(forceEnterWorkflow ? { forceEnterWorkflow } : {}),
    };

    // Extract attachment text server-side, strip file parts. See
    // message-preprocess.ts for rationale — OSS/Java URLs aren't fetchable
    // by Mastra's downloadFromUrl, so we resolve them here first.
    const messages = body.messages as Parameters<typeof preprocessMessages>[0];
    // Snapshot the ORIGINAL client messages before preprocess mutates them
    // in place. The preprocessed version is LLM-facing (preview + textRef +
    // instructions block); the user's chat bubble should keep showing the
    // raw text + file card, so we persist from this snapshot instead.
    const originalMessages: unknown[] = Array.isArray(messages)
      ? messages.map((m) => structuredClone(m))
      : [];
    try {
      await preprocessMessages(messages);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Message preprocess failed: ${msg}`);
      // Keep going — text parts still reach the agent.
    }

    // Persist project params BEFORE streaming the LLM response. We fetch the
    // current detail so we can carry over name/description/type/imagePath
    // (Java does a full replace, not a patch) and overlay the user-picked
    // fields on top.
    if (confirmProjectParams) {
      try {
        const headers: Record<string, string> = {
          'accept-language':
            (req.headers['accept-language'] as string | undefined) ?? 'zh-CN',
        };
        const cookie = req.headers.cookie as string | undefined;
        if (cookie) headers.cookie = cookie;
        const current = await this.workspace.getProjectDetail(
          headers,
          body.projectId,
        );
        const worldIdForSave = body.workspaceContext?.worldId
          ? String(body.workspaceContext.worldId)
          : current.worldId;
        await this.workspace.updateProject(headers, {
          id: body.projectId,
          worldId: worldIdForSave,
          name: current.name,
          description: current.description,
          type: current.type,
          episode: current.episode,
          imagePath: current.imagePath,
          aspectRatioType: confirmProjectParams.aspectRatioType,
          chapterLength: confirmProjectParams.chapterLength,
          stylePainting: confirmProjectParams.stylePainting,
          dialogLanguage: confirmProjectParams.dialogLanguage,
        });
        this.logger.log(
          `confirmProjectParams saved for ${body.projectId}: ${confirmProjectParams.aspectRatioType}/${confirmProjectParams.chapterLength}/${confirmProjectParams.stylePainting}/${confirmProjectParams.dialogLanguage}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.error(`confirmProjectParams Java save failed: ${msg}`);
        throw new HttpException(
          { message: `保存项目参数失败: ${msg}` },
          HttpStatus.BAD_GATEWAY,
        );
      }
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
    if (confirmProjectParams) {
      markers.push(
        `<PROJECT_PARAMS_CONFIRMED aspectRatioType="${confirmProjectParams.aspectRatioType}" chapterLength="${confirmProjectParams.chapterLength}" stylePainting="${confirmProjectParams.stylePainting}" dialogLanguage="${confirmProjectParams.dialogLanguage}" />`,
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

    // Strip synthetic workflow-lifecycle parts from the history we forward
    // to the supervisor LLM. These `tool-workflow_*` parts are rendered as
    // chat cards for the user, but the supervisor never actually called
    // them — they're published directly to Redis by the workflow engine
    // (see packages/shared/src/workflow-messages.ts). Leaving them in the
    // LLM's view of the history causes it to hallucinate future calls to
    // `workflow_progress` / `workflow_completed` / `workflow_suspended` as
    // if they were registered tools, which then fail with output-error
    // and pollute the next assistant message. Also drops empty messages
    // (parts become []) so no ghost bubbles reach Mastra either.
    const sanitizedMessages = sanitizeHistoryForSupervisor(messages);

    // AI SDK v5-compatible chat endpoint (registered by chatRoute in apps/agent).
    // Emits UIMessageChunk events that match readUIMessageStream in the web client.
    const upstream = `${this.mastraUrl}/chat/storyos`;
    this.logger.log(
      `POST /assistant/submit-message-to-agent → ${upstream} userId=${user.userId} project=${body.projectId} messages=${sanitizedMessages.length} (raw=${messages.length})`,
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
        body: JSON.stringify({ messages: sanitizedMessages }),
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

    if (!upstreamResponse.body) {
      throw new HttpException(
        { message: 'Mastra returned no body' },
        HttpStatus.BAD_GATEWAY,
      );
    }

    // ── Fully WS-based pipeline (oii-aligned) ──
    //   • POST returns a small JSON envelope immediately.
    //   • The client relies on its project-scoped WS (opened on panel mount)
    //     to receive `message_added` / `message_updated` / `agent_state`
    //     events, then pulls content via POST /aurora/chat/get-messages.
    //   • The Mastra SSE stream is consumed SERVER-SIDE only — parsed into
    //     UIMessages and written to Redis by AgentStreamService. No tee,
    //     no SSE pipe to the browser anymore.
    const agentInstanceId = randomUUID();
    const seedAssistantId = randomUUID();

    // Persist the user's ORIGINAL (pre-preprocess) messages so the UI sees
    // raw text + file card, not the LLM-facing preview/textRef block. Await
    // so the subsequent message_added for the user bubble hits the WS
    // before the assistant seed.
    try {
      await this.persistInboundMessages(body.projectId, originalMessages);
    } catch (err) {
      this.logger.warn(
        `persistInboundMessages failed project=${body.projectId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Fire-and-forget: consume Mastra SSE straight into Redis. Any error is
    // surfaced via the agent_state="failed" event the consumer publishes.
    const seedMessage: StoredMessage = {
      id: seedAssistantId,
      role: 'assistant',
      parts: [],
    };
    void this.agentStream
      .consume({
        projectId: body.projectId,
        seedMessage,
        rawStream:
          upstreamResponse.body as unknown as ReadableStream<Uint8Array>,
      })
      .catch((err) => {
        this.logger.warn(
          `agentStream.consume failed project=${body.projectId}: ${err instanceof Error ? err.message : err}`,
        );
      });

    res.status(HttpStatus.ACCEPTED).json({
      agentInstanceId,
      conversationId: body.projectId,
      seedMessageId: seedAssistantId,
    });
  }

  // ─── Stage C reader API — preview ─────────────────────────────────────
  //
  // Once the web client migrates to "POST submit + WS subscribe + GET content"
  // (Stage C), these two endpoints become the only chat read path. For now
  // they coexist with the legacy SSE pipe above.

  @Get('conversation/:projectId/messages')
  async listMessageIds(
    @Param('projectId') projectId: string,
    @CurrentUser() _user: AuthUser,
  ) {
    const messageIds = await this.store.getMessageIds(projectId);
    const agentState = await this.store.getAgentState(projectId);
    return { projectId, messageIds, agentState };
  }

  @Post('get-messages')
  async getMessages(
    @Body() body: { projectId?: string; messageIds?: unknown },
    @CurrentUser() _user: AuthUser,
  ) {
    if (!body.projectId || !Array.isArray(body.messageIds)) {
      throw new HttpException(
        'projectId and messageIds[] are required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const ids = (body.messageIds as unknown[]).filter(
      (v): v is string => typeof v === 'string' && v.length > 0,
    );
    const messages = await this.store.getMessages(body.projectId, ids);
    return { projectId: body.projectId, messages };
  }

  /**
   * Walk the inbound messages array and persist anything we don't already
   * have in the store. Keeps user bubbles + existing assistant history
   * in Redis so a WS-only client can catch up without replaying SSE.
   */
  private async persistInboundMessages(
    projectId: string,
    messages: unknown,
  ): Promise<void> {
    if (!Array.isArray(messages)) return;
    const existing = new Set(await this.store.getMessageIds(projectId));
    for (const raw of messages as Array<Record<string, unknown>>) {
      if (!raw || typeof raw !== 'object') continue;
      const id = typeof raw.id === 'string' ? raw.id : null;
      if (!id || existing.has(id)) continue;
      // Skip empty-placeholder assistant messages the web client prepends.
      if (raw.role === 'assistant' && this.isEmptyAssistant(raw)) continue;
      await this.store.addMessage(projectId, raw as StoredMessage);
      existing.add(id);
    }
  }

  private isEmptyAssistant(message: Record<string, unknown>): boolean {
    const parts = message.parts;
    if (!Array.isArray(parts) || parts.length === 0) return true;
    return parts.every((p) => {
      const part = p as Record<string, unknown>;
      return part?.type === 'text' && (!part.text || part.text === '');
    });
  }
}

/**
 * Remove synthetic workflow-lifecycle parts from the message history
 * forwarded to the supervisor LLM.
 *
 * Background: the workflow engine publishes synthetic assistant messages
 * (one per lifecycle transition — started/progress/suspended/completed/
 * failed) directly to Redis, with parts shaped like AI SDK v5 tool calls
 * (`type: "tool-workflow_progress"` etc.) so the frontend can render them
 * as generative-UI cards. These parts are NOT actual supervisor tool
 * calls — the supervisor has no `workflow_progress` tool registered.
 *
 * If we leave them in the history we send back to the LLM, the model
 * reads them as "I called these tools in the previous turn" and starts
 * hallucinating more calls to them on the next turn, which Mastra then
 * flags as output-error (unknown tool) and breaks the response.
 *
 * Also drops `step-start` placeholders that surround the stripped tool
 * parts, and any message whose `parts` becomes empty after the strip —
 * those become ghost bubbles on Mastra's side otherwise.
 */
function sanitizeHistoryForSupervisor(
  messages: unknown,
): Record<string, unknown>[] {
  if (!Array.isArray(messages)) return [];
  const WORKFLOW_TOOL_PREFIXES = [
    'tool-workflow_started',
    'tool-workflow_progress',
    'tool-workflow_suspended',
    'tool-workflow_completed',
    'tool-workflow_failed',
  ];
  const isWorkflowToolPart = (part: unknown): boolean => {
    if (!part || typeof part !== 'object') return false;
    const type = (part as { type?: unknown }).type;
    if (typeof type !== 'string') return false;
    return WORKFLOW_TOOL_PREFIXES.some((p) => type === p);
  };
  // Anthropic rejects text content blocks with empty strings (400
  // "text content blocks must be non-empty"). DeepSeek silently tolerates
  // them. Previous assistant messages that streamed only tool calls —
  // or tool-card renderings whose text was stripped earlier — can leave
  // behind `{type: "text", text: ""}` parts that break Claude every
  // turn. Drop them before forwarding.
  const isEmptyTextPart = (part: unknown): boolean => {
    if (!part || typeof part !== 'object') return false;
    const p = part as { type?: unknown; text?: unknown };
    if (p.type !== 'text') return false;
    return typeof p.text !== 'string' || p.text.trim().length === 0;
  };
  const out: Record<string, unknown>[] = [];
  for (const raw of messages as Array<Record<string, unknown>>) {
    if (!raw || typeof raw !== 'object') continue;
    const parts = raw.parts;
    if (!Array.isArray(parts)) {
      out.push(raw);
      continue;
    }
    const filtered = (parts as unknown[]).filter(
      (p) => !isWorkflowToolPart(p) && !isEmptyTextPart(p),
    );
    // Drop leading/trailing `step-start` parts that are now orphaned (no
    // tool call follows) — these used to bracket the removed workflow
    // tool parts and just add noise without them.
    while (
      filtered.length > 0 &&
      (filtered[0] as { type?: unknown })?.type === 'step-start'
    ) {
      filtered.shift();
    }
    while (
      filtered.length > 0 &&
      (filtered[filtered.length - 1] as { type?: unknown })?.type ===
        'step-start'
    ) {
      filtered.pop();
    }
    if (filtered.length === 0) continue;
    out.push({ ...raw, parts: filtered });
  }
  return out;
}
