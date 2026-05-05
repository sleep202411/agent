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
import {
  preprocessMessages,
  ingestAttachmentBuffer,
} from './message-preprocess';
import { WorkspaceService } from './workspace.service';
import {
  MessageStoreService,
  type StoredMessage,
} from './chat/message-store.service';
import { AgentStreamService } from './chat/agent-stream.service';
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
    /** parse_script-only opt-in to wipe existing episodes before commit. */
    replaceExisting?: unknown;
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
    /**
     * Not persisted by Java (no column yet) — client-only; we surface it
     * in the <PROJECT_PARAMS_CONFIRMED /> marker so the supervisor sees the
     * user's target episode count and threads it into invoke_workflow
     * inputData.
     */
    targetEpisodeCount?: unknown;
    /** Same story as targetEpisodeCount. Threaded via marker + context. */
    shotsPerEpisode?: unknown;
    /**
     * Workflow to auto-start once params are saved. Supervisor stashes this
     * in the require_project_params tool-call input when it already knows
     * the target; frontend forwards it verbatim. When present, Nest starts
     * the workflow directly (no LLM turn) and seeds a canned "规划完成" ack.
     */
    onConfirmWorkflow?: {
      workflowName?: unknown;
      inputData?: unknown;
    };
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
            replaceExisting:
              typeof body.confirmWorkflow.replaceExisting === 'boolean'
                ? body.confirmWorkflow.replaceExisting
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
            onConfirmWorkflow:
              body.confirmProjectParams.onConfirmWorkflow &&
              typeof (
                body.confirmProjectParams.onConfirmWorkflow as Record<
                  string,
                  unknown
                >
              ).workflowName === 'string' &&
              (
                (
                  body.confirmProjectParams.onConfirmWorkflow as Record<
                    string,
                    unknown
                  >
                ).workflowName as string
              ).length > 0
                ? {
                    workflowName: (
                      body.confirmProjectParams.onConfirmWorkflow as Record<
                        string,
                        unknown
                      >
                    ).workflowName as string,
                    inputData:
                      (
                        body.confirmProjectParams.onConfirmWorkflow as Record<
                          string,
                          unknown
                        >
                      ).inputData &&
                      typeof (
                        body.confirmProjectParams.onConfirmWorkflow as Record<
                          string,
                          unknown
                        >
                      ).inputData === 'object'
                        ? ((
                            body.confirmProjectParams
                              .onConfirmWorkflow as Record<string, unknown>
                          ).inputData as Record<string, unknown>)
                        : {},
                  }
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

    // ── Short-circuit: HITL confirm button (no LLM needed) ──
    //
    // User clicking "满意 / 我要修改" on a suspended workflow card is a
    // fully-specified action: we already know the runId + approved +
    // feedback. Routing it through the supervisor just so it can decode
    // a marker and call resume_workflow wastes an LLM turn and depends
    // on prompt quality for a mechanical operation. Skip LLM, call the
    // engine's resume endpoint directly, and seed a canned ack message.
    //
    // Gate: only when confirmWorkflow is the SOLE button-triggered
    // signal. If it rides together with forceEnterWorkflow or
    // confirmProjectParams (shouldn't happen in current UI, but the
    // transport type allows it), fall through to the normal LLM path.
    if (confirmWorkflow && !forceEnterWorkflow && !confirmProjectParams) {
      return this.handleConfirmWorkflowShortCircuit({
        body,
        originalMessages,
        confirmWorkflow,
        user,
        req,
        res,
      });
    }

    // ── Short-circuit: FORCE_WORKFLOW button (no LLM needed) ──
    //
    // Same idea as the confirmWorkflow path above. The frontend button
    // already provides {workflowName, inputData} — LLM's only role in
    // the legacy path was decoding the XML marker + generating warm
    // narration + calling invoke_workflow with the exact values. All
    // three are mechanical for phase-advance buttons; the user is
    // already inside a flow and a canned "已派发" is sufficient.
    //
    // Gate mirrors confirmWorkflow's: only when forceEnterWorkflow is
    // the SOLE button signal.
    if (forceEnterWorkflow && !confirmWorkflow && !confirmProjectParams) {
      return this.handleForceWorkflowShortCircuit({
        body,
        originalMessages,
        forceEnterWorkflow,
        user,
        req,
        res,
      });
    }

    // ── Short-circuit: PROJECT_PARAMS_CONFIRMED button (no LLM needed) ──
    //
    // Form submit provides the 4 core params + optional onConfirmWorkflow
    // (supervisor stashes it in the tool-call input when it already knows
    // the target). We: (1) save to Java, (2) kick cover generation as a
    // fire-and-forget side effect, (3) if onConfirmWorkflow is set, start
    // that workflow directly, (4) seed a "规划完成" ack. No LLM turn.
    if (confirmProjectParams && !confirmWorkflow && !forceEnterWorkflow) {
      return this.handleConfirmProjectParamsShortCircuit({
        body,
        originalMessages,
        confirmProjectParams,
        user,
        req,
        res,
      });
    }

    // ── Legacy path: confirmProjectParams rides together with another
    // button signal (shouldn't happen in current UI). Keep the old
    // save-to-Java + marker injection so the LLM handles it.
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
          `confirmProjectParams (legacy) saved for ${body.projectId}: ${confirmProjectParams.aspectRatioType}/${confirmProjectParams.chapterLength}/${confirmProjectParams.stylePainting}/${confirmProjectParams.dialogLanguage}`,
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

    if (confirmProjectParams) {
      const extras: string[] = [];
      if (typeof confirmProjectParams.targetEpisodeCount === 'number') {
        extras.push(
          `targetEpisodeCount="${confirmProjectParams.targetEpisodeCount}"`,
        );
      }
      if (typeof confirmProjectParams.shotsPerEpisode === 'number') {
        extras.push(
          `shotsPerEpisode="${confirmProjectParams.shotsPerEpisode}"`,
        );
      }
      const extrasSuffix = extras.length > 0 ? ` ${extras.join(' ')}` : '';
      markers.push(
        `<PROJECT_PARAMS_CONFIRMED aspectRatioType="${confirmProjectParams.aspectRatioType}" chapterLength="${confirmProjectParams.chapterLength}" stylePainting="${confirmProjectParams.stylePainting}" dialogLanguage="${confirmProjectParams.dialogLanguage}"${extrasSuffix} />`,
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

    // ── Agent-state gate ─────────────────────────────────────────
    // Acquire the project's "running" lock before doing any Mastra
    // dispatch. CAS-guarded in Redis so two concurrent submits
    // (multi-tab / double-click / retry storms) can't both win.
    // Released by AgentStreamService.consume on success / failure.
    // Short-circuit branches (confirmProjectParams / forceEnterWorkflow
    // / confirmWorkflow) above don't take the gate — they're follow-on
    // signals on top of an already-committed turn, not new dispatches.
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
   * HITL confirm button short-circuit — no LLM turn.
   *
   * Flow:
   *  1. Persist the user's button-label message so the chat history
   *     matches the normal path
   *  2. Call agent's `/workflow/:runId/confirm` directly (resume job
   *     enqueued without a supervisor roundtrip)
   *  3. Synthesize a canned assistant ack + write to the message store
   *  4. Return the usual envelope so the frontend's WS pipeline can pick
   *     up the ack via `message_added`
   */
  private async handleConfirmWorkflowShortCircuit(args: {
    body: MastraChatBody;
    originalMessages: unknown[];
    confirmWorkflow: {
      runId: string;
      approved: boolean;
      feedback: string | undefined;
      replaceExisting: boolean | undefined;
    };
    user: AuthUser;
    req: Request;
    res: Response;
  }): Promise<void> {
    const { body, originalMessages, confirmWorkflow, user, req, res } = args;
    const projectId = body.projectId!;

    // Flip to 'running' FIRST so the terminal 'idle' at end is a real
    // transition (chat-session dedups identical states). Without this, if
    // state was already 'idle' the final setAgentState('idle') is a no-op
    // on client and `finalizeTurnOnIdle` never fires → sending UI stays.
    await this.store.setAgentState(projectId, 'running').catch(() => {});

    try {
      await this.persistInboundMessages(projectId, originalMessages);
    } catch (err) {
      this.logger.warn(
        `persistInboundMessages (confirm short-circuit) failed project=${projectId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    const resumeContext = {
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
      userTier: user.userLevel ?? 'free',
    };
    const cookie = req.headers.cookie as string | undefined;
    const acceptLanguage =
      (req.headers['accept-language'] as string | undefined) ?? 'zh-CN';
    const resumeHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'accept-language': acceptLanguage,
      'x-storyos-context': JSON.stringify(resumeContext),
    };
    if (cookie) resumeHeaders.cookie = cookie;

    const resumeUrl = `${this.mastraUrl}/workflow/${encodeURIComponent(confirmWorkflow.runId)}/confirm`;
    let completionPayload: unknown = null;
    let failurePayload: unknown = null;
    try {
      const resp = await fetch(resumeUrl, {
        method: 'POST',
        headers: resumeHeaders,
        body: JSON.stringify({
          approved: confirmWorkflow.approved,
          feedback: confirmWorkflow.feedback,
          // parse_script-only opt-in to wipe existing episodes before
          // commit. Other phases ignore it; pass-through keeps Nest
          // workflow-agnostic.
          ...(confirmWorkflow.replaceExisting !== undefined
            ? { replaceExisting: confirmWorkflow.replaceExisting }
            : {}),
          // Tell the agent NOT to side-channel-emit workflow_completed /
          // workflow_failed: we'll embed the returned payload into our own
          // synthetic message below so the card + any follow-up text live
          // in one bubble, matching the NL path's apply_phase_drafts tool.
          emitLifecycleMessage: false,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        this.logger.error(
          `Workflow resume failed runId=${confirmWorkflow.runId} status=${resp.status}: ${text.slice(0, 300)}`,
        );
        throw new HttpException(
          { message: `Workflow resume failed: ${text.slice(0, 300)}` },
          HttpStatus.BAD_GATEWAY,
        );
      }
      const data = (await resp.json().catch(() => ({}))) as {
        completion?: unknown;
        failure?: unknown;
      };
      completionPayload = data.completion ?? null;
      failurePayload = data.failure ?? null;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Workflow resume fetch failed: ${msg}`);
      throw new HttpException(
        { message: `Workflow resume unavailable: ${msg}` },
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Synthetic assistant message — a `tool-apply_phase_drafts` part whose
    // output carries the `completion` / `failure` payload the agent just
    // returned. Frontend renders this part with the same WorkflowCompleted
    // / WorkflowFailed card used elsewhere (see message-bubble.tsx's
    // apply_phase_drafts branch). Follow-up text, if we still want one
    // for the revise case, rides in the SAME message's parts array so
    // card + text never fragment into sibling bubbles.
    const toolCallId = `apply-${confirmWorkflow.runId}`;
    const toolPart = {
      type: 'tool-apply_phase_drafts',
      toolCallId,
      state: 'output-available',
      input: {
        runId: confirmWorkflow.runId,
        approved: confirmWorkflow.approved,
        feedback: confirmWorkflow.feedback,
      },
      output: {
        outcome: confirmWorkflow.approved ? 'committed' : 'rejected',
        completion: completionPayload,
        failure: failurePayload,
      },
    };
    // Approved path: card (with summary + next-step buttons) IS the reply
    // — no follow-up text. Revise path: surface the user's feedback so
    // they know the handoff landed, but keep it tight.
    const parts: unknown[] = [toolPart];
    if (!confirmWorkflow.approved) {
      const ackText = confirmWorkflow.feedback
        ? `了解，团队会按"${confirmWorkflow.feedback}"的方向再过一遍，稍后请您再看一眼。`
        : '了解，团队会按您的反馈再过一遍，稍后请您再看一眼。';
      parts.push({ type: 'text', text: ackText, state: 'done' });
    }
    const ackId = randomUUID();
    await this.store.addMessage(projectId, {
      id: ackId,
      role: 'assistant',
      parts,
    } as StoredMessage);

    this.logger.log(
      `confirmWorkflow short-circuit runId=${confirmWorkflow.runId} approved=${confirmWorkflow.approved} project=${projectId} synthMsgId=${ackId} completionPresent=${!!completionPayload} failurePresent=${!!failurePayload}`,
    );

    // Flip agent_state to 'idle' so the web client's WS listener fires
    // `finalizeTurnOnIdle` — clears the composer's sending/streaming flags
    // (normally done by the SSE consumer at turn end; short-circuits skip
    // SSE entirely, so we set it explicitly here).
    await this.store.setAgentState(projectId, 'idle').catch((err) => {
      this.logger.warn(
        `confirmWorkflow short-circuit setAgentState(idle) failed: ${err instanceof Error ? err.message : err}`,
      );
    });

    res.status(HttpStatus.ACCEPTED).json({
      agentInstanceId: randomUUID(),
      conversationId: projectId,
      seedMessageId: ackId,
    });
  }

  /**
   * FORCE_WORKFLOW button short-circuit — no LLM turn.
   *
   * The frontend button dispatches {workflowName, inputData} verbatim;
   * the legacy path asked the LLM to decode a marker, write a warm
   * 3-段 narration, then call invoke_workflow with the same values.
   * Nothing about that required LLM reasoning. Skip it: call the
   * engine's `/workflow/start` endpoint directly, seed a canned ack.
   */
  private async handleForceWorkflowShortCircuit(args: {
    body: MastraChatBody;
    originalMessages: unknown[];
    forceEnterWorkflow: {
      workflowName: string;
      inputData: Record<string, unknown>;
    };
    user: AuthUser;
    req: Request;
    res: Response;
  }): Promise<void> {
    const { body, originalMessages, forceEnterWorkflow, user, req, res } = args;
    const projectId = body.projectId!;

    // See handleConfirmWorkflowShortCircuit — flip to 'running' first so
    // terminal 'idle' is always a real state transition.
    await this.store.setAgentState(projectId, 'running').catch(() => {});

    try {
      await this.persistInboundMessages(projectId, originalMessages);
    } catch (err) {
      this.logger.warn(
        `persistInboundMessages (force short-circuit) failed project=${projectId}: ${err instanceof Error ? err.message : err}`,
      );
    }

    const startContext = {
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
    const cookie = req.headers.cookie as string | undefined;
    const acceptLanguage =
      (req.headers['accept-language'] as string | undefined) ?? 'zh-CN';
    const startHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      'accept-language': acceptLanguage,
      'x-storyos-context': JSON.stringify(startContext),
    };
    if (cookie) startHeaders.cookie = cookie;

    const startUrl = `${this.mastraUrl}/workflow/start`;
    try {
      const resp = await fetch(startUrl, {
        method: 'POST',
        headers: startHeaders,
        body: JSON.stringify({
          workflowName: forceEnterWorkflow.workflowName,
          inputData: forceEnterWorkflow.inputData,
        }),
      });
      if (!resp.ok) {
        const text = await resp.text().catch(() => '');
        this.logger.error(
          `Workflow start failed workflowName=${forceEnterWorkflow.workflowName} status=${resp.status}: ${text.slice(0, 300)}`,
        );
        throw new HttpException(
          { message: `Workflow start failed: ${text.slice(0, 300)}` },
          HttpStatus.BAD_GATEWAY,
        );
      }
    } catch (err) {
      if (err instanceof HttpException) throw err;
      const msg = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Workflow start fetch failed: ${msg}`);
      throw new HttpException(
        { message: `Workflow start unavailable: ${msg}` },
        HttpStatus.BAD_GATEWAY,
      );
    }

    // Canned ack. Keep it dry — the workflow card the engine publishes
    // next (workflow_started / workflow_progress) carries the actual
    // name, so repeating it here would just add noise. Locale-aware so
    // zh-HK / zh-TW users get traditional characters and en-* users
    // get an English ack instead of mixed-script noise.
    const ackText = buildDispatchAck(
      forceEnterWorkflow.workflowName,
      acceptLanguage,
    );
    const ackId = randomUUID();
    await this.store.addMessage(projectId, {
      id: ackId,
      role: 'assistant',
      parts: [{ type: 'text', text: ackText, state: 'done' }],
    } as StoredMessage);

    this.logger.log(
      `forceEnterWorkflow short-circuit workflowName=${forceEnterWorkflow.workflowName} project=${projectId}`,
    );

    await this.store.setAgentState(projectId, 'idle').catch((err) => {
      this.logger.warn(
        `forceEnterWorkflow short-circuit setAgentState(idle) failed: ${err instanceof Error ? err.message : err}`,
      );
    });

    res.status(HttpStatus.ACCEPTED).json({
      agentInstanceId: randomUUID(),
      conversationId: projectId,
      seedMessageId: ackId,
    });
  }

  /**
   * ProjectParamsForm submit short-circuit — no LLM turn.
   *
   * Flow (mirrors what the supervisor did in the legacy marker path,
   * minus the narration personalization which becomes a template):
   *   1. Persist user's button-label message
   *   2. Save 4 core params to Java
   *   3. Fire-and-forget cover generation (idempotent; skipped if
   *      project already has imagePath)
   *   4. Seed a canned "规划完成" ack message with the user's picked
   *      values interpolated
   *   5. If onConfirmWorkflow is set, POST /workflow/start to dispatch
   *      without another LLM hop
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
      onConfirmWorkflow?: {
        workflowName: string;
        inputData: Record<string, unknown>;
      };
    };
    user: AuthUser;
    req: Request;
    res: Response;
  }): Promise<void> {
    const { body, originalMessages, confirmProjectParams, user, req, res } =
      args;
    const projectId = body.projectId!;
    const cookie = req.headers.cookie as string | undefined;
    const acceptLanguage =
      (req.headers['accept-language'] as string | undefined) ?? 'zh-CN';

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
        `confirmProjectParams short-circuit saved for ${projectId}: ${confirmProjectParams.aspectRatioType}/${confirmProjectParams.chapterLength}/${confirmProjectParams.stylePainting}/${confirmProjectParams.dialogLanguage} targetEpisodeCount=${confirmProjectParams.targetEpisodeCount ?? '-'} shotsPerEpisode=${confirmProjectParams.shotsPerEpisode ?? '-'} next=${confirmProjectParams.onConfirmWorkflow?.workflowName ?? '-'}`,
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

    // Agent-facing context — used for both the cover fire-and-forget
    // and the optional workflow dispatch below.
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
    // + workflow, and the next LLM turn can retry.
    void fetch(`${this.mastraUrl}/project/cover/generate`, {
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
    const nextStepLine = confirmProjectParams.onConfirmWorkflow
      ? `下一步会继续推进「${WORKFLOW_ACK_LABELS[confirmProjectParams.onConfirmWorkflow.workflowName] ?? '创作流程'}」。`
      : '下一步等您发出下一个创作指令。';
    const projectPart = projectName ? ` 《${projectName}》` : '';
    const ackText = [
      '规划完成',
      '',
      '• 参数已同步给团队。',
      `• 团队将根据您确认的 ${aspectLabel}、单集 ${confirmProjectParams.chapterLength} 分钟、${episodesSummary}${dialogLabel} 对白的需求继续推进${projectPart}。`,
      `• ${nextStepLine}`,
    ].join('\n');
    const ackId = randomUUID();
    await this.store.addMessage(projectId, {
      id: ackId,
      role: 'assistant',
      parts: [{ type: 'text', text: ackText, state: 'done' }],
    } as StoredMessage);

    // Auto-start the declared workflow, if any. Nest talks to the agent's
    // existing /workflow/start endpoint — same path a FORCE_WORKFLOW
    // short-circuit uses. Missing onConfirmWorkflow is fine: the user
    // will simply type their next ask and the LLM routes from there.
    if (confirmProjectParams.onConfirmWorkflow) {
      try {
        const resp = await fetch(`${this.mastraUrl}/workflow/start`, {
          method: 'POST',
          headers: agentHeaders,
          body: JSON.stringify({
            workflowName: confirmProjectParams.onConfirmWorkflow.workflowName,
            inputData: confirmProjectParams.onConfirmWorkflow.inputData,
          }),
        });
        if (!resp.ok) {
          const text = await resp.text().catch(() => '');
          this.logger.error(
            `Post-params workflow start failed workflow=${confirmProjectParams.onConfirmWorkflow.workflowName} status=${resp.status}: ${text.slice(0, 300)}`,
          );
          // Don't throw — params were saved + ack was delivered; surface
          // the workflow failure as a follow-up assistant message.
          const errId = randomUUID();
          await this.store.addMessage(projectId, {
            id: errId,
            role: 'assistant',
            parts: [
              {
                type: 'text',
                text: `工作流启动失败：${text.slice(0, 200) || `HTTP ${resp.status}`}。请稍后再试或告诉我下一步想做什么。`,
                state: 'done',
              },
            ],
          } as StoredMessage);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        this.logger.error(`Post-params workflow start fetch failed: ${msg}`);
      }
    }

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

/**
 * Workflow name → label for the canned dispatch ack ("已派发X"). One map
 * per locale variant — keeps the simplified-Chinese (zh-CN) defaults but
 * switches to traditional Chinese (zh-HK/zh-TW) and English (en-*) when
 * the request's Accept-Language asks for it. Missing entries fall back
 * to a bare ack — the workflow card that follows carries the real name.
 */
const WORKFLOW_ACK_LABELS: Record<string, string> = {
  story_outline: '素材分析',
  parse_script: '剧本切分',
  role_phase: '角色设计',
  role_image_phase: '角色主图',
  scene_phase: '场景设计',
  scene_image_phase: '场景参考图',
  prop_phase: '道具设计',
  prop_image_phase: '道具参考图',
  episode_phase: '分集规划',
  script_phase: '剧本写作',
  storyboard_phase: '分镜生成',
  role_design: '角色设计',
  scene_design: '场景设计',
  prop_design: '道具设计',
  batch_create_asset: '资产录入',
  script_edit: '剧本修改',
};

const WORKFLOW_ACK_LABELS_HK: Record<string, string> = {
  story_outline: '素材分析',
  parse_script: '劇本切分',
  role_phase: '角色設計',
  role_image_phase: '角色主圖',
  scene_phase: '場景設計',
  scene_image_phase: '場景參考圖',
  prop_phase: '道具設計',
  prop_image_phase: '道具參考圖',
  episode_phase: '分集規劃',
  script_phase: '劇本寫作',
  storyboard_phase: '分鏡生成',
  role_design: '角色設計',
  scene_design: '場景設計',
  prop_design: '道具設計',
  batch_create_asset: '資產錄入',
  script_edit: '劇本修改',
};

const WORKFLOW_ACK_LABELS_EN: Record<string, string> = {
  story_outline: 'story outline',
  parse_script: 'script parsing',
  role_phase: 'character design',
  role_image_phase: 'character portraits',
  scene_phase: 'scene design',
  scene_image_phase: 'scene references',
  prop_phase: 'prop design',
  prop_image_phase: 'prop references',
  episode_phase: 'episode planning',
  script_phase: 'script writing',
  storyboard_phase: 'storyboard generation',
  role_design: 'character design',
  scene_design: 'scene design',
  prop_design: 'prop design',
  batch_create_asset: 'asset import',
  script_edit: 'script editing',
};

function buildDispatchAck(
  workflowName: string,
  acceptLanguage: string,
): string {
  const tag = (acceptLanguage.split(',')[0] ?? '').trim().toLowerCase();
  if (tag.startsWith('zh-hk') || tag.startsWith('zh-tw')) {
    const label = WORKFLOW_ACK_LABELS_HK[workflowName];
    return label ? `已派發${label}。` : '已派發。';
  }
  if (tag.startsWith('en')) {
    const label = WORKFLOW_ACK_LABELS_EN[workflowName];
    return label ? `Dispatched: ${label}.` : 'Dispatched.';
  }
  // zh-CN / zh / unknown → simplified default
  const label = WORKFLOW_ACK_LABELS[workflowName];
  return label ? `已派发${label}。` : '已派发。';
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
