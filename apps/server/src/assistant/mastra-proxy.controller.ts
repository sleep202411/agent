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
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import { CurrentUser, type AuthUser } from '../auth';
import { isForcedPersonaKey, type ForcedPersonaKey } from '@repo/shared';
import {
  collectAttachmentRefs,
  preprocessMessages,
  ingestAttachmentBuffer,
} from './message-preprocess';
import { WorkspaceService } from './workspace.service';
import {
  MessageStoreService,
  type StoredMessage,
} from './chat/message-store.service';
import { AgentStreamService } from './chat/agent-stream.service';
import { mastraFetch } from './mastra-fetch';
import { AgentStateService } from './chat/agent-state.service';
import { EntityEventsService } from './chat/entity-events.service';

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
    targetEpisodeCount?: unknown;
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
    /** Surfaced in the <PROJECT_PARAMS_CONFIRMED /> marker for supervisor. */
    targetEpisodeCount?: unknown;
    /** Same — threaded via marker + context. */
    shotsPerEpisode?: unknown;
  };
};

@Controller('assistant')
export class MastraProxyController {
  private readonly logger = new Logger(MastraProxyController.name);

  constructor(
    private readonly workspace: WorkspaceService,
    private readonly store: MessageStoreService,
    private readonly agentStream: AgentStreamService,
    private readonly agentState: AgentStateService,
    private readonly entityEvents: EntityEventsService,
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
            targetEpisodeCount:
              typeof body.confirmProjectParams.targetEpisodeCount ===
                'number' &&
              Number.isFinite(body.confirmProjectParams.targetEpisodeCount) &&
              body.confirmProjectParams.targetEpisodeCount > 0
                ? body.confirmProjectParams.targetEpisodeCount
                : undefined,
            shotsPerEpisode:
              typeof body.confirmProjectParams.shotsPerEpisode === 'number' &&
              Number.isFinite(body.confirmProjectParams.shotsPerEpisode) &&
              body.confirmProjectParams.shotsPerEpisode > 0
                ? body.confirmProjectParams.shotsPerEpisode
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
      targetEpisodeCount:
        typeof body.workspaceContext?.targetEpisodeCount === 'number' &&
        Number.isFinite(body.workspaceContext.targetEpisodeCount) &&
        body.workspaceContext.targetEpisodeCount > 0
          ? body.workspaceContext.targetEpisodeCount
          : undefined,
      userTier: user.userLevel ?? 'free',
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

    // Server-side guarantee that the persona always sees the user's
    // uploaded source material, even when the supervisor LLM forgets
    // to thread `textRef` through to its `ask_*` tool calls. We
    // collect every `att_xxx` ref still present in the chat history
    // (newest last) and pass them through `x-storyos-context` →
    // `requestContext.attachmentRefs`. The ask_* tool wrappers fall
    // back to the latest ref when the LLM doesn't pass one, so the
    // 14k-char source we cached on upload reliably reaches the
    // persona regardless of supervisor diligence — fixes the
    // "ctxBytes=506" symptom where personas were inventing content
    // because they never saw the file.
    const attachmentRefs = (() => {
      try {
        return collectAttachmentRefs(messages);
      } catch (err) {
        this.logger.warn(
          `collectAttachmentRefs failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        return [];
      }
    })();
    const ctxWithAttachments: Record<string, unknown> = { ...context };
    if (attachmentRefs.length > 0) {
      ctxWithAttachments.attachmentRefs = attachmentRefs;
    }

    // ── Short-circuit: PROJECT_PARAMS_CONFIRMED button (no LLM needed) ──
    //
    // Form submit provides the 4 core params (+ optional targetEpisodeCount /
    // shotsPerEpisode). We save to Java, kick cover generation as a fire-and-
    // forget side effect, and seed a canned "规划完成" ack message. No LLM turn.
    if (confirmProjectParams) {
      return this.handleConfirmProjectParamsShortCircuit({
        body,
        originalMessages,
        confirmProjectParams,
        user,
        req,
        res,
      });
    }

    // Button-driven signals: inject XML-style markers into the last user
    // message so the supervisor LLM sees them. Markers never hit the UI —
    // frontend Redux keeps the clean label; injection happens on the wire.
    const markers: string[] = [];

    // Per-turn workspace snapshot so the supervisor knows what the user is
    // currently focused on (episode / world). Without it the LLM asks
    // "which episode?" for every `这一集` reference because x-storyos-context
    // is only visible to tool executions, not to the model itself.
    // Episode switches are free — next turn carries the new id.
    const wsAttrs: string[] = [];
    if (context.worldId) wsAttrs.push(`worldId="${context.worldId}"`);
    if (context.episodeId) wsAttrs.push(`episodeId="${context.episodeId}"`);
    if (wsAttrs.length > 0) {
      markers.push(`<WORKSPACE_CONTEXT ${wsAttrs.join(' ')} />`);
    }

    // Forced-persona pin: user pinned a designer in the composer
    // (Storyboard / Character / Scene / Prop). The metadata rides on
    // the latest user message; we trust the field after schema-
    // validating against the shared whitelist. Marker is injected for
    // the LLM's eyes only — the stored copy still carries clean
    // metadata.forcedPersona so chat history can render the chip.
    const forcedPersona = readLatestForcedPersona(messages);
    if (forcedPersona) {
      markers.push(`<FORCED_PERSONA persona="${forcedPersona}" />`);
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
            last.text = `${last.text}${markerText}`;
          } else {
            parts.push({ type: 'text', text: markerText.trimStart() });
          }
        } else if (typeof m.content === 'string') {
          m.content = `${m.content}${markerText}`;
        }
        break;
      }
    }

    // ── Agent-state gate ───────────────────────────────────────────────
    // Keep one running supervisor turn per project. Concurrent write turns
    // can race on StoryOS commits, duplicate costs, and interleave chat
    // bubbles in ways users cannot reason about.
    //
    // The production stuck-lock issue is handled by the safety rails below:
    // a 15-min Redis TTL, stream heartbeat, and a 10-min hard upstream
    // timeout. That gives users recovery without allowing overlapping
    // commit-capable turns.
    const turnId = randomUUID();
    const gate = await this.agentState.transition(
      body.projectId,
      ['idle', 'failed', 'cancelled'],
      { kind: 'running', turnId },
    );
    if (!gate.ok) {
      this.logger.warn(
        `submit blocked: project=${body.projectId} state=${gate.current.kind} turn=${gate.current.turnId ?? '-'}`,
      );
      throw new HttpException(
        {
          code: 'AGENT_BUSY',
          message: 'There is already an active turn for this project',
          current: gate.current,
        },
        HttpStatus.CONFLICT,
      );
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

    const cookie = req.headers.cookie ?? '';
    const acceptLanguage = req.headers['accept-language'] ?? 'zh-CN';

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'text/event-stream',
      'accept-language': acceptLanguage,
      'x-storyos-context': JSON.stringify(ctxWithAttachments),
    };
    if (cookie) headers.cookie = cookie;

    // ── Abort controller (hard timeout only) ─────────────────────────────
    // Wires an AbortController into the upstream fetch so we never sit on
    // a permanently-stalled SSE stream. Releases the agent_state lock via
    // the catch path when fired.
    //
    // Idle timeout REMOVED 2026-05-22 evening. History:
    //   - First attempt: 90s idle → fired on every legitimate persona
    //     call (Qwen ask_* takes 80-120s with zero chunks streaming
    //     because supervisor is awaiting tool result). ~60% false abort.
    //   - Second attempt: 240s idle → still fired on storyboarder × 5
    //     batches (5 × ~80s = 400s of silence is the design, not a bug).
    //     Measured 100% of remaining aborts triggered at idleMs ~255_000.
    //   - Decision: drop idle entirely. Rely only on the 10-min hard
    //     timeout, which is comfortably longer than any legitimate chain
    //     and short enough that truly stuck fetches still self-recover.
    //
    // True fix (deferred): have Mastra emit keepalive chunks during tool
    // execution so the SSE stream isn't actually silent. Until that
    // lands, no idle threshold value is correct — either we false-abort
    // legitimate work, or we wait so long the threshold is useless.
    const HARD_TIMEOUT_MS = 10 * 60 * 1000;
    const streamAbortController = new AbortController();
    const hardTimeoutKiller = setTimeout(() => {
      if (!streamAbortController.signal.aborted) {
        this.logger.warn(
          `mastra stream hard-timeout project=${body.projectId} (>${HARD_TIMEOUT_MS}ms); aborting`,
        );
        streamAbortController.abort(
          new Error(`hard-timeout-${HARD_TIMEOUT_MS}ms`),
        );
      }
    }, HARD_TIMEOUT_MS);

    let upstreamResponse: globalThis.Response;
    try {
      upstreamResponse = await mastraFetch(upstream, {
        method: 'POST',
        headers,
        body: JSON.stringify({ messages: sanitizedMessages }),
        signal: streamAbortController.signal,
      });
    } catch (err) {
      clearTimeout(hardTimeoutKiller);
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Mastra upstream fetch failed: ${msg}`);
      // Release the gate so the user can retry. Without this the
      // project would stay stuck at running until the TTL expired.
      await this.agentState.set(body.projectId, {
        kind: 'failed',
        lastError: `Mastra upstream unavailable: ${msg}`,
      });
      throw new HttpException(
        { message: `Mastra upstream unavailable: ${msg}` },
        HttpStatus.BAD_GATEWAY,
      );
    }

    if (!upstreamResponse.ok) {
      clearTimeout(hardTimeoutKiller);
      const text = await upstreamResponse.text().catch(() => '');
      this.logger.error(
        `Mastra returned ${upstreamResponse.status}: ${text.slice(0, 300)}`,
      );
      await this.agentState.set(body.projectId, {
        kind: 'failed',
        lastError: `Mastra ${upstreamResponse.status}: ${text.slice(0, 200)}`,
      });
      throw new HttpException(
        { message: `Mastra error: ${text.slice(0, 300)}` },
        upstreamResponse.status === 401
          ? HttpStatus.UNAUTHORIZED
          : HttpStatus.BAD_GATEWAY,
      );
    }

    if (!upstreamResponse.body) {
      clearTimeout(hardTimeoutKiller);
      await this.agentState.set(body.projectId, {
        kind: 'failed',
        lastError: 'Mastra returned no body',
      });
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
        abortController: streamAbortController,
      })
      .catch((err) => {
        this.logger.warn(
          `agentStream.consume failed project=${body.projectId}: ${err instanceof Error ? err.message : err}`,
        );
      })
      .finally(() => {
        clearTimeout(hardTimeoutKiller);
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

  /**
   * Direct attachment ingestion — replaces the old "upload to OSS,
   * then have message-preprocess re-fetch" dance with a single
   * round-trip. Web POSTs the raw file body via multipart, Nest
   * extracts text in-process, caches it in Redis under a fresh
   * `attachment:{ref}` key, and returns the ref + a short excerpt
   * for the file card UI. The user's chat message simply embeds
   * the ref; downstream `preprocessMessages` reads the cached text
   * via the same code path it always used. OSS no longer participates
   * in the chat flow — eliminates the "NoSuchKey" failure mode where
   * uploads landed in a different bucket than Nest tried to read.
   */
  @Post('upload-attachment')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 25 * 1024 * 1024 }, // 25 MB cap.
    }),
  )
  async uploadAttachment(
    @UploadedFile()
    file:
      | {
          originalname?: string;
          mimetype?: string;
          buffer?: Buffer;
          size?: number;
        }
      | undefined,
    @CurrentUser() _user: AuthUser,
  ) {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw new HttpException(
        'file (multipart field) is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const filename = file.originalname ?? 'file';
    const mimeType = file.mimetype ?? 'application/octet-stream';
    try {
      const result = await ingestAttachmentBuffer({
        buffer: file.buffer,
        filename,
        mimeType,
      });
      return {
        ref: result.ref,
        filename,
        mimeType,
        size: file.size ?? file.buffer.length,
        chars: result.chars,
        excerpt: result.excerpt,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'extract failed';
      throw new HttpException(
        { code: 'EXTRACT_FAILED', message: msg },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
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

  /**
   * ProjectParamsForm submit short-circuit — no LLM turn.
   *
   * Flow:
   *   1. Persist user's button-label message
   *   2. Save 4 core params to Java
   *   3. Fire-and-forget cover generation (idempotent; skipped if
   *      project already has imagePath)
   *   4. Seed a canned "规划完成" ack message with the user's picked
   *      values interpolated
   */
  private async handleConfirmProjectParamsShortCircuit(args: {
    body: MastraChatBody;
    originalMessages: unknown[];
    confirmProjectParams: {
      aspectRatioType: string;
      chapterLength: number;
      stylePainting: string;
      dialogLanguage: string;
      targetEpisodeCount?: number;
      shotsPerEpisode?: number;
    };
    user: AuthUser;
    req: Request;
    res: Response;
  }): Promise<void> {
    const { body, originalMessages, confirmProjectParams, user, req, res } =
      args;
    const projectId = body.projectId!;
    const cookie = req.headers.cookie;
    const acceptLanguage = req.headers['accept-language'] ?? 'zh-CN';

    // See handleConfirmWorkflowShortCircuit — running→idle guarantees a
    // state transition, without this the final idle gets dedup'd and the
    // frontend composer never clears sending.
    await this.store.setAgentState(projectId, 'running').catch(() => {});

    try {
      await this.persistInboundMessages(projectId, originalMessages);
    } catch (err) {
      this.logger.warn(
        `persistInboundMessages (params short-circuit) failed project=${projectId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    // Save core params to Java — reuses the same carry-over strategy as
    // the legacy path (fetch current, overlay picked fields, PUT back).
    let projectName = '';
    try {
      const javaHeaders: Record<string, string> = {
        'accept-language': acceptLanguage,
      };
      if (cookie) javaHeaders.cookie = cookie;
      const current = await this.workspace.getProjectDetail(
        javaHeaders,
        projectId,
      );
      projectName = typeof current.name === 'string' ? current.name : '';
      const worldIdForSave = body.workspaceContext?.worldId
        ? String(body.workspaceContext.worldId)
        : current.worldId;
      await this.workspace.updateProject(javaHeaders, {
        id: projectId,
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
        `confirmProjectParams short-circuit saved for ${projectId}: ${confirmProjectParams.aspectRatioType}/${confirmProjectParams.chapterLength}/${confirmProjectParams.stylePainting}/${confirmProjectParams.dialogLanguage} targetEpisodeCount=${confirmProjectParams.targetEpisodeCount ?? '-'} shotsPerEpisode=${confirmProjectParams.shotsPerEpisode ?? '-'}`,
      );
      await this.entityEvents.publish(user.userId, {
        entity: 'project',
        action: 'updated',
        id: projectId,
        projectId,
        source: 'confirmProjectParams',
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`confirmProjectParams Java save failed: ${msg}`);
      throw new HttpException(
        { message: `保存项目参数失败: ${msg}` },
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Agent-facing context — used for the cover fire-and-forget below.
    const agentContext = {
      userId: user.userId,
      projectId,
      worldId: body.workspaceContext?.worldId
        ? String(body.workspaceContext.worldId)
        : undefined,
      episodeId: body.workspaceContext?.episodeId
        ? String(body.workspaceContext.episodeId)
        : undefined,
      locale:
        typeof body.workspaceContext?.locale === 'string'
          ? body.workspaceContext.locale
          : undefined,
      dialogLanguage: confirmProjectParams.dialogLanguage,
      stylePainting: confirmProjectParams.stylePainting,
      shotsPerEpisode: confirmProjectParams.shotsPerEpisode,
      targetEpisodeCount: confirmProjectParams.targetEpisodeCount,
      userTier: user.userLevel ?? 'free',
    };
    const agentHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'accept-language': acceptLanguage,
      'x-storyos-context': JSON.stringify(agentContext),
    };
    if (cookie) agentHeaders.cookie = cookie;

    // Fire-and-forget: generate_project_cover is idempotent, so we don't
    // block the response on it. If it fails the user still gets the ack
    // and the next LLM turn can retry.
    void mastraFetch(`${this.mastraUrl}/project/cover/generate`, {
      method: 'POST',
      headers: agentHeaders,
      body: JSON.stringify({}),
    }).catch((err) => {
      this.logger.warn(
        `project cover fire-and-forget failed project=${projectId}: ${err instanceof Error ? err.message : err}`,
      );
    });

    // Synthesize a personalized-ish "规划完成" ack using the form values.
    const aspectLabel =
      ASPECT_LABELS[confirmProjectParams.aspectRatioType] ??
      confirmProjectParams.aspectRatioType;
    const dialogLabel =
      DIALOG_LANGUAGE_LABELS[confirmProjectParams.dialogLanguage] ??
      confirmProjectParams.dialogLanguage;
    const episodesSummary =
      typeof confirmProjectParams.targetEpisodeCount === 'number'
        ? `共 ${confirmProjectParams.targetEpisodeCount} 集、`
        : '';
    const projectPart = projectName ? ` 《${projectName}》` : '';
    const ackText = [
      '规划完成',
      '',
      '• 参数已同步给团队。',
      `• 团队将根据您确认的 ${aspectLabel}、单集 ${confirmProjectParams.chapterLength} 分钟、${episodesSummary}${dialogLabel} 对白的需求继续推进${projectPart}。`,
      '• 下一步等您发出下一个创作指令。',
    ].join('\n');
    const ackId = randomUUID();
    await this.store.addMessage(projectId, {
      id: ackId,
      role: 'assistant',
      parts: [{ type: 'text', text: ackText, state: 'done' }],
    } as StoredMessage);

    await this.store.setAgentState(projectId, 'idle').catch((err) => {
      this.logger.warn(
        `confirmProjectParams short-circuit setAgentState(idle) failed: ${err instanceof Error ? err.message : err}`,
      );
    });

    res.status(HttpStatus.ACCEPTED).json({
      agentInstanceId: randomUUID(),
      conversationId: projectId,
      seedMessageId: ackId,
    });
  }
}

/** Aspect-ratio id → human-readable label (used in params ack narration). */
const ASPECT_LABELS: Record<string, string> = {
  _16_9: '16:9',
  _9_16: '9:16',
  _1_1: '1:1',
  _4_3: '4:3',
  _21_9: '21:9',
  _3_4: '3:4',
};

/** Dialogue language code → native label (used in params ack narration). */
const DIALOG_LANGUAGE_LABELS: Record<string, string> = {
  'zh-CN': '简体中文',
  'zh-HK': '繁体中文',
  'en-US': '英文',
};

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

/**
 * Pluck `metadata.forcedPersona` off the most recent user message in
 * the inbound payload. Validates against the shared whitelist before
 * returning — we never trust a client string verbatim into the LLM.
 */
function readLatestForcedPersona(
  messages: unknown,
): ForcedPersonaKey | undefined {
  if (!Array.isArray(messages)) return undefined;
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i] as Record<string, unknown> | null | undefined;
    if (!m || m.role !== 'user') continue;
    const md = m.metadata as Record<string, unknown> | undefined;
    const candidate = md?.forcedPersona;
    return isForcedPersonaKey(candidate) ? candidate : undefined;
  }
  return undefined;
}
