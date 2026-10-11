/**
 * Studio copilot — thin, stateless streaming endpoint.
 *
 * Route: POST /copilot/stream  (reached by the client as /aurora/copilot/stream
 * via the studio Next rewrite; the /aurora prefix is stripped at the edge).
 *
 * Conversation streaming remains short and single-consumer, while Story Canvas
 * mutations are expressed only as durable, reviewable Story Agent proposals.
 * Applying a proposal is a separate project-scoped run with its own lock,
 * fencing token, audit record, and realtime lifecycle.
 */
import {
  Body,
  Controller,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  NotFoundException,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { ProjectMemberRole } from '@prisma/client';
import {
  COPILOT_DOCUMENT_MAX_FILE_BYTES,
  COPILOT_DOCUMENT_PART_TYPE,
  CopilotDocumentPartSchema,
  copilotDocumentRefsFromParts,
  type CopilotDocumentRef,
  type StoryDirectingSkillKey,
} from '@repo/shared';
import {
  convertToModelMessages,
  generateId,
  InvalidToolInputError,
  lastAssistantMessageIsCompleteWithToolCalls,
  NoSuchToolError,
  stepCountIs,
  streamText,
  validateUIMessages,
  type UIMessage,
} from 'ai';
import { z } from 'zod';
import { CurrentUser, type AuthUser } from '../auth';
import {
  StoryPermissionService,
  type StoryCapability,
} from '../story-studio/story-permission.service';
import { StoryAgentRunService } from '../story-studio/story-agent-run.service';
import { WorkspacePermissionService } from '../workspaces';
import { createCopilotModel } from './copilot.model';
import {
  CopilotDocumentService,
  copilotDocumentFileRequired,
  type CopilotDocumentUploadFile,
} from './copilot-document.service';
import {
  buildCopilotDocumentBlock,
  buildCopilotDocumentMarker,
  buildStoryCanvasSystemPrompt,
  buildSystemPromptFromCanonicalContext,
  canonicalizeCopilotContextJson,
  type CanonicalCopilotContextJson,
} from './copilot.prompt';
import { CopilotQuotaService } from './copilot-quota.service';
import { pumpCopilotUIMessageStream } from './copilot-response-pump';
import {
  CopilotStore,
  CopilotStoreConflictError,
  CopilotStoreUnavailableError,
  type CopilotActiveTurn,
  type CopilotUserStreamLease,
} from './copilot.store';
import { canvasTools } from './copilot.tools';
import { createStoryCanvasTools } from './story-canvas.tools';
import {
  parseStoryCanvasCopilotInput,
  StoryCanvasCopilotInputError,
} from './story-directing-skills';

interface CopilotStreamBody {
  /** The only client-authored durable input accepted for this request. */
  message: UIMessage;
  trigger: 'submit-message' | 'regenerate-message' | 'tool-result-continuation';
  conversationId: string;
  projectId?: string;
  mode?: string;
  /** Compact JSON digest of the current canvas, rebuilt by the client each turn. */
  graphContext?: string;
  /** Compact JSON digest of usable models (id/name/type), rebuilt by the client. */
  modelsContext?: string;
  /** Stable directing-skill keys selected in the Story Canvas entry surface. */
  selectedSkillKeys?: unknown;
}

const STORY_CANVAS_MODE = 'story-canvas';
const INFINITE_CANVAS_MODE = 'canvas';
export const COPILOT_MAX_OUTPUT_TOKENS = 4_096;
export const COPILOT_MAX_RETRIES = 1;
export const COPILOT_PROVIDER_TIMEOUT = {
  totalMs: 120_000,
  stepMs: 45_000,
  chunkMs: 30_000,
} as const;
export const COPILOT_MAX_MODEL_INPUT_BYTES = 512 * 1024;
const COPILOT_MAX_DYNAMIC_CONTEXT_BYTES = 256 * 1024;

@Controller('copilot')
export class CopilotController {
  private readonly logger = new Logger(CopilotController.name);

  constructor(
    private readonly store: CopilotStore,
    private readonly storyPermissions: StoryPermissionService,
    private readonly storyAgentRuns: StoryAgentRunService,
    private readonly workspacePermissions: WorkspacePermissionService,
    private readonly copilotQuota: CopilotQuotaService,
    private readonly documents: CopilotDocumentService,
  ) {}

  @Post('stream')
  async stream(
    @Body() body: CopilotStreamBody,
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
    @Res() res: Response,
  ): Promise<void> {
    const {
      message,
      trigger,
      conversationId,
      projectId,
      mode,
      graphContext,
      modelsContext,
      selectedSkillKeys,
    } = body ?? ({} as CopilotStreamBody);
    requireConversationId(conversationId);
    requireTurnTrigger(trigger);
    assertOptionalString(projectId, 'projectId', 180);
    assertOptionalString(mode, 'mode', 64);
    const scope = requireConversationScope({
      conversationId,
      mode,
      projectId,
    });
    const isStoryCanvas = scope.mode === STORY_CANVAS_MODE;
    const isToolContinuation = trigger === 'tool-result-continuation';
    if (isToolContinuation && isStoryCanvas) {
      throw new HttpException(
        {
          code: 'COPILOT_TOOL_CONTINUATION_INVALID',
          message:
            'Client-executed tool continuation is available only in Infinite Canvas.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const validatedMessage = isToolContinuation
      ? await validateIncomingAssistantContinuation(message)
      : await validateIncomingUserMessage(message, {
          allowDocumentParts: isStoryCanvas,
        });
    if (
      isStoryCanvas &&
      (graphContext !== undefined || modelsContext !== undefined)
    ) {
      throw new HttpException(
        {
          code: 'COPILOT_REQUEST_INVALID',
          message:
            'graphContext and modelsContext are available only in Infinite Canvas.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const canonicalGraphContext = isStoryCanvas
      ? null
      : normalizeOptionalContextJson(graphContext, 'graphContext');
    const canonicalModelsContext = isStoryCanvas
      ? null
      : normalizeOptionalContextJson(modelsContext, 'modelsContext');
    const workspaceId = requiredCopilotWorkspaceId(workspaceHeader);
    if (isStoryCanvas) {
      await this.requireStoryProjectScope(
        user.userId,
        workspaceId,
        scope.projectId,
        'story.generate',
      );
    } else {
      await this.requireCanvasProjectScope(
        user.userId,
        workspaceId,
        scope.projectId,
        ProjectMemberRole.editor,
      );
    }

    let system: string;
    let normalizedSelectedSkillKeys: StoryDirectingSkillKey[] = [];
    if (isStoryCanvas) {
      try {
        const storyInput = parseStoryCanvasCopilotInput({
          selectedSkillKeys,
        });
        normalizedSelectedSkillKeys = storyInput.selectedSkillKeys;
      } catch (error) {
        if (error instanceof StoryCanvasCopilotInputError) {
          throw new HttpException(error.message, HttpStatus.BAD_REQUEST);
        }
        throw error;
      }
    } else if (selectedSkillKeys !== undefined) {
      throw new HttpException(
        {
          code: 'COPILOT_REQUEST_INVALID',
          message: 'selectedSkillKeys is available only in Story Canvas.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    // Every client-authored document reference must resolve to a durable row
    // owned by this user inside this conversation BEFORE the immutable user
    // message is persisted; the transcript never carries a dead reference.
    if (!isToolContinuation) {
      await this.documents.requireOwnedRefs(
        user.userId,
        conversationId,
        copilotDocumentRefsFromParts(validatedMessage.parts),
      );
    }

    await this.copilotQuota.assertRateLimit(user, { workspaceId });

    let lease: CopilotUserStreamLease;
    try {
      lease = await this.store.acquireUserStreamLease(
        user.userId,
        conversationId,
      );
    } catch (error) {
      throw copilotStoreHttpError(error);
    }

    let claim: Awaited<ReturnType<CopilotStore['claimTurn']>>;
    try {
      claim = isToolContinuation
        ? await this.store.claimToolContinuation({
            conversationId,
            userId: user.userId,
            projectId: scope.projectId,
            mode: 'canvas',
            assistantMessage: validatedMessage,
            admissionLease: lease,
          })
        : await this.store.claimTurn({
            conversationId,
            userId: user.userId,
            projectId: scope.projectId,
            mode: scope.mode,
            selectedSkillKeys: normalizedSelectedSkillKeys,
            trigger,
            userMessage: validatedMessage,
            admissionLease: lease,
          });
    } catch (error) {
      await this.releaseLeaseSafely(user.userId, lease, conversationId);
      throw copilotStoreHttpError(error);
    }

    const providerAbort = new AbortController();
    let settlement: Promise<void> | null = null;
    const onResponseClose = () => {
      if (res.writableEnded) return;
      providerAbort.abort();
      void settle('aborted').catch(() => undefined);
    };
    const settle = (
      status: 'completed' | 'failed' | 'aborted',
      responseMessage?: UIMessage,
    ): Promise<void> => {
      if (!settlement) {
        settlement = this.settleTurn({
          userId: user.userId,
          conversationId,
          turn: claim.turn,
          lease,
          status,
          responseMessage,
          res,
          onResponseClose,
        });
      }
      return settlement;
    };

    try {
      await this.copilotQuota.consumeTurn({
        user,
        workspaceId,
        conversationId,
        sessionId: claim.conversation.sessionId,
        billingOperationId: claim.turn.billingOperationId,
        chargeAttemptId: claim.turn.chargeAttemptId,
        turnId: claim.turn.turnId,
        turnKind: claim.turn.kind,
      });
    } catch (error) {
      try {
        await settle('failed');
      } catch {
        // Preserve the canonical quota error while settleTurn logs an
        // independent state-transition failure.
      }
      throw error;
    }
    if (typeof res.once === 'function') res.once('close', onResponseClose);
    if (res.destroyed || res.writableEnded) {
      providerAbort.abort();
      await settle('aborted');
      return;
    }

    try {
      const canonicalMessages = claim.conversation.messages;
      const canonicalSkillKeys = claim.conversation.selectedSkillKeys;
      const storyAuthoringContext = isStoryCanvas
        ? await this.storyAgentRuns.getAuthoringContext(
            user,
            workspaceId,
            scope.projectId,
            scope.chapterId,
          )
        : null;
      // Transient per-turn view: the current turn's document parts expand to
      // full delimited text blocks, earlier ones to compact markers. The
      // canonical transcript keeps only the small reference parts.
      const messagesForModel = storyAuthoringContext
        ? await this.withDocumentContext(
            user.userId,
            conversationId,
            canonicalMessages,
            claim.turn.userMessageId,
          )
        : canonicalMessages;
      if (storyAuthoringContext) {
        system = buildStoryCanvasSystemPrompt({
          selectedSkillKeys: canonicalSkillKeys,
          storyContext: storyAuthoringContext.prompt,
          documentsAttached: messagesForModel !== canonicalMessages,
        });
      } else {
        system = buildSystemPromptFromCanonicalContext({
          mode: scope.mode,
          graphContext: canonicalGraphContext,
          modelsContext: canonicalModelsContext,
        });
      }

      assertModelInputSize(system, messagesForModel);
      const modelMessages = await convertToModelMessages(
        messagesForModel,
      ).catch((error) => {
        this.logger.error(
          `copilot.model_message_conversion_failed userId=${user.userId} conversationId=${conversationId} error=${errorMessage(error)}`,
        );
        throw new HttpException(
          {
            code: 'COPILOT_CONVERSATION_INVALID',
            message: 'Could not parse the canonical conversation history.',
          },
          HttpStatus.BAD_REQUEST,
        );
      });

      try {
        claim.turn = await this.store.beginProvider({
          userId: user.userId,
          conversationId,
          turn: claim.turn,
        });
      } catch (error) {
        throw copilotStoreHttpError(error);
      }

      const result = streamText({
        model: createCopilotModel(),
        providerOptions: { alibaba: { enableThinking: false } },
        system,
        messages: modelMessages,
        tools: storyAuthoringContext
          ? createStoryCanvasTools({
              runs: this.storyAgentRuns,
              store: this.store,
              user,
              workspaceId,
              projectId: scope.projectId,
              chapterId: scope.chapterId as string,
              conversationId,
              sessionId: claim.conversation.sessionId,
              userMessageId: claim.turn.userMessageId,
              turn: claim.turn,
              onServerFault: (error) => {
                this.logger.error(
                  `copilot.story_tool_server_fault userId=${user.userId} conversationId=${conversationId} error=${errorMessage(error)}`,
                );
                providerAbort.abort();
              },
            })
          : canvasTools,
        stopWhen: stepCountIs(isStoryCanvas ? 3 : 8),
        maxOutputTokens: COPILOT_MAX_OUTPUT_TOKENS,
        maxRetries: COPILOT_MAX_RETRIES,
        timeout: COPILOT_PROVIDER_TIMEOUT,
        abortSignal: providerAbort.signal,
        onError: ({ error }) => {
          this.logger.error(
            `copilot.provider_error userId=${user.userId} conversationId=${conversationId} turnId=${claim.turn.turnId} error=${errorMessage(error)}`,
          );
        },
      });

      let finishEvent: {
        responseMessage: UIMessage;
        isAborted: boolean;
        finishReason?: string;
      } | null = null;
      const uiStream = result.toUIMessageStream({
        originalMessages: canonicalMessages,
        generateMessageId: generateId,
        onFinish: ({ responseMessage, isAborted, finishReason }) => {
          finishEvent = { responseMessage, isAborted, finishReason };
        },
        // Honest error taxonomy: a model-authored invalid tool request is a
        // deterministic failure the user should rephrase, not a provider
        // outage, and neither is fixed by refreshing the conversation.
        onError: (error: unknown) =>
          InvalidToolInputError.isInstance(error) ||
          NoSuchToolError.isInstance(error)
            ? 'The assistant produced an invalid tool request. Send your message again.'
            : 'The assistant stream failed. Retry your message.',
      });
      await pumpCopilotUIMessageStream({
        stream: uiStream,
        response: res,
        settle: async (outcome) => {
          const finished = finishEvent;
          const status =
            outcome.sawAbort || finished?.isAborted
              ? 'aborted'
              : outcome.sourceError ||
                  outcome.sawError ||
                  !outcome.finishChunk ||
                  !finished ||
                  !finished.finishReason ||
                  finished.finishReason === 'error'
                ? 'failed'
                : 'completed';
          if (status === 'completed') {
            if (!finished) {
              throw new Error('Completed Copilot stream has no finish event.');
            }
            await settle('completed', finished.responseMessage);
          } else {
            await settle(status);
          }
          return { emitFinish: status === 'completed' };
        },
      });
    } catch (error) {
      providerAbort.abort();
      try {
        await settle('failed');
      } catch {
        // The original pre-stream/provider error is the actionable response;
        // settleTurn already logged the independent canonical failure.
      }
      if (res.headersSent || res.destroyed || res.writableEnded) {
        this.logger.error(
          `copilot.stream_pump_failed userId=${user.userId} conversationId=${conversationId} error=${errorMessage(error)}`,
        );
        return;
      }
      throw error;
    }
  }

  /**
   * Send-time document upload for Story Canvas conversations. Extracts the
   * text once (docx/txt/md), stores it durably scoped to this user's
   * conversation, and returns the reference the outgoing message part carries.
   */
  @Post('documents')
  @UseInterceptors(
    FileInterceptor('file', {
      // One byte of headroom so files at the documented cap reach the typed
      // size check instead of multer's generic 413.
      limits: { fileSize: COPILOT_DOCUMENT_MAX_FILE_BYTES + 1, files: 1 },
    }),
  )
  async uploadDocument(
    @Body()
    body: { conversationId?: string; projectId?: string; mode?: string },
    @UploadedFile() file: CopilotDocumentUploadFile | undefined,
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
  ): Promise<{ document: CopilotDocumentRef }> {
    const conversationId = body?.conversationId;
    requireConversationId(conversationId);
    const scope = requireConversationScope({
      conversationId,
      mode: body?.mode,
      projectId: body?.projectId,
    });
    if (scope.mode !== STORY_CANVAS_MODE) {
      throw new HttpException(
        {
          code: 'COPILOT_DOCUMENT_MODE_INVALID',
          message:
            'Document upload is available only in Story Canvas conversations.',
        },
        HttpStatus.BAD_REQUEST,
      );
    }
    const workspaceId = requiredCopilotWorkspaceId(workspaceHeader);
    await this.requireStoryProjectScope(
      user.userId,
      workspaceId,
      scope.projectId,
      'story.generate',
    );
    if (!file || !Buffer.isBuffer(file.buffer)) {
      throw copilotDocumentFileRequired();
    }
    const document = await this.documents.create({
      userId: user.userId,
      conversationId,
      file,
    });
    return { document };
  }

  /** Seed the client on mount with the persisted conversation. */
  @Post('history')
  async history(
    @Body()
    body: { conversationId?: string; projectId?: string; mode?: string },
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
  ): Promise<{
    conversationId: string;
    messages: UIMessage[];
    selectedSkillKeys: StoryDirectingSkillKey[];
    revision: number;
    sessionId: string | null;
    status: string;
    resetAvailable: boolean;
  }> {
    const conversationId = body?.conversationId;
    requireConversationId(conversationId);
    const scope = requireConversationScope({
      conversationId,
      mode: body?.mode,
      projectId: body?.projectId,
    });
    const workspaceId = requiredCopilotWorkspaceId(workspaceHeader);
    if (scope.mode === STORY_CANVAS_MODE) {
      await this.requireStoryProjectScope(
        user.userId,
        workspaceId,
        scope.projectId,
        'story.read',
      );
    } else {
      await this.requireCanvasProjectScope(
        user.userId,
        workspaceId,
        scope.projectId,
        ProjectMemberRole.viewer,
      );
    }
    let conv: Awaited<ReturnType<CopilotStore['load']>>;
    try {
      conv = await this.store.load(user.userId, conversationId);
    } catch (error) {
      throw copilotStoreHttpError(error);
    }
    return {
      conversationId,
      messages: conv?.messages ?? [],
      selectedSkillKeys: conv?.selectedSkillKeys ?? [],
      revision: conv?.revision ?? 0,
      sessionId: conv?.sessionId ?? null,
      status: conv?.status ?? 'ready',
      resetAvailable: true,
    };
  }

  /** Explicitly clear only this authenticated user's private chat state. */
  @Post('reset')
  async reset(
    @Body()
    body: {
      conversationId?: string;
      projectId?: string;
      mode?: string;
      expectedRevision?: number;
      expectedSessionId?: string | null;
    },
    @CurrentUser() user: AuthUser,
    @Headers('x-fizz-workspace-id')
    workspaceHeader: string | string[] | undefined,
  ): Promise<{ conversationId: string; reset: true }> {
    const conversationId = body?.conversationId;
    requireConversationId(conversationId);
    const expectedRevision = requireExpectedRevision(body?.expectedRevision);
    const expectedSessionId = requireExpectedSessionId(
      body?.expectedSessionId,
      expectedRevision,
    );
    const scope = requireConversationScope({
      conversationId,
      mode: body?.mode,
      projectId: body?.projectId,
    });
    const workspaceId = requiredCopilotWorkspaceId(workspaceHeader);
    if (scope.mode === STORY_CANVAS_MODE) {
      await this.requireStoryProjectScope(
        user.userId,
        workspaceId,
        scope.projectId,
        'story.read',
      );
    } else {
      await this.requireCanvasProjectScope(
        user.userId,
        workspaceId,
        scope.projectId,
        ProjectMemberRole.viewer,
      );
    }
    try {
      await this.store.resetConversation(
        user.userId,
        conversationId,
        expectedRevision,
        expectedSessionId,
      );
    } catch (error) {
      throw copilotStoreHttpError(error);
    }
    return { conversationId, reset: true };
  }

  private async settleTurn(input: {
    userId: string;
    conversationId: string;
    turn: CopilotActiveTurn;
    lease: CopilotUserStreamLease;
    status: 'completed' | 'failed' | 'aborted';
    responseMessage?: UIMessage;
    res: Response;
    onResponseClose: () => void;
  }): Promise<void> {
    let canonicalTurnSettled = false;
    try {
      if (input.status === 'completed') {
        if (!input.responseMessage) {
          throw new Error('Completed Copilot stream had no response message.');
        }
        let completed: boolean;
        try {
          completed = await this.retryStoreTransition(() =>
            this.store.completeTurn({
              userId: input.userId,
              conversationId: input.conversationId,
              turn: input.turn,
              responseMessage: input.responseMessage!,
            }),
          );
        } catch (completionError) {
          canonicalTurnSettled =
            completionError instanceof CopilotStoreConflictError &&
            (completionError.code === 'COPILOT_MESSAGE_TOO_LARGE' ||
              completionError.code === 'COPILOT_HISTORY_LIMIT_REACHED');
          // Validation, size, or provider-response persistence failed. Preserve
          // the canonical user turn in an explicitly retryable state whenever
          // the completion CAS did not already terminalize it.
          try {
            const terminalized = await this.retryStoreTransition(() =>
              this.store.terminalizeTurn({
                userId: input.userId,
                conversationId: input.conversationId,
                turn: input.turn,
                status: 'failed',
              }),
            );
            canonicalTurnSettled ||= terminalized;
          } catch (terminalError) {
            this.logger.error(
              `copilot.completion_fallback_terminalize_failed userId=${input.userId} conversationId=${input.conversationId} turnId=${input.turn.turnId} error=${errorMessage(terminalError)}`,
            );
          }
          throw completionError;
        }
        if (!completed) {
          throw new CopilotStoreConflictError('COPILOT_TURN_STALE');
        }
        canonicalTurnSettled = true;
      } else {
        const terminalized = await this.retryStoreTransition(() =>
          this.store.terminalizeTurn({
            userId: input.userId,
            conversationId: input.conversationId,
            turn: input.turn,
            status: input.status as 'failed' | 'aborted',
          }),
        );
        if (!terminalized) {
          throw new CopilotStoreConflictError('COPILOT_TURN_STALE');
        }
        canonicalTurnSettled = true;
      }
    } catch (error) {
      // The stream flush awaits this callback. Re-throw so an assistant answer
      // is never presented as successful unless its canonical PG commit won.
      this.logger.error(
        `copilot.turn_settlement_failed userId=${input.userId} conversationId=${input.conversationId} turnId=${input.turn.turnId} status=${input.status} error=${errorMessage(error)}`,
      );
      throw error;
    } finally {
      if (typeof input.res.removeListener === 'function') {
        input.res.removeListener('close', input.onResponseClose);
      }
      await this.releaseLeaseSafely(
        input.userId,
        input.lease,
        input.conversationId,
      );
      if (canonicalTurnSettled) {
        try {
          await this.copilotQuota.reconcileChargeAttempt(
            input.turn.chargeAttemptId,
          );
        } catch (error) {
          this.logger.error(
            `copilot.quota_reconcile_failed userId=${input.userId} conversationId=${input.conversationId} turnId=${input.turn.turnId} attemptId=${input.turn.chargeAttemptId} error=${errorMessage(error)}`,
          );
        }
      }
    }
  }

  /**
   * Expand document reference parts into model-visible text without touching
   * the canonical transcript: the turn that carries the document gets its full
   * extracted text in a delimited untrusted block; earlier turns get compact
   * markers so the model keeps the documentId without re-paying the budget.
   */
  private async withDocumentContext(
    userId: string,
    conversationId: string,
    messages: UIMessage[],
    currentUserMessageId: string,
  ): Promise<UIMessage[]> {
    const refsByMessage = new Map<string, CopilotDocumentRef[]>();
    for (const message of messages) {
      if (message.role !== 'user') continue;
      const refs = copilotDocumentRefsFromParts(message.parts);
      if (refs.length > 0) refsByMessage.set(message.id, refs);
    }
    if (refsByMessage.size === 0) return messages;
    const currentRefs = refsByMessage.get(currentUserMessageId) ?? [];
    const texts = await this.documents.loadOwnedTexts(
      userId,
      conversationId,
      currentRefs.map((ref) => ref.documentId),
    );
    return messages.map((message) => {
      const refs = refsByMessage.get(message.id);
      if (!refs) return message;
      const blocks = refs.map((ref) => {
        if (message.id !== currentUserMessageId) {
          return buildCopilotDocumentMarker(ref);
        }
        const document = texts.get(ref.documentId);
        if (!document) {
          throw new Error(
            `Copilot document ${ref.documentId} was validated but its text failed to load.`,
          );
        }
        return buildCopilotDocumentBlock(document);
      });
      return {
        ...message,
        parts: [
          ...message.parts,
          ...blocks.map((text) => ({ type: 'text' as const, text })),
        ],
      };
    });
  }

  private async releaseLeaseSafely(
    userId: string,
    lease: CopilotUserStreamLease,
    conversationId: string,
  ): Promise<void> {
    try {
      const released = await this.retryStoreTransition(() =>
        this.store.releaseUserStreamLease(
          userId,
          lease.token,
          lease.fencingRevision,
        ),
      );
      // Canonical complete/fail/abort releases atomically. False is the normal
      // idempotent cleanup result after that transaction already committed.
      void released;
    } catch (error) {
      this.logger.error(
        `copilot.admission_release_failed userId=${userId} conversationId=${conversationId} error=${errorMessage(error)}`,
      );
    }
  }

  private async retryStoreTransition<T>(action: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await action();
      } catch (error) {
        lastError = error;
        if (!(error instanceof CopilotStoreUnavailableError) || attempt === 3) {
          throw error;
        }
        await new Promise<void>((resolve) =>
          setTimeout(resolve, attempt === 1 ? 25 : 75),
        );
      }
    }
    throw lastError;
  }

  private async requireStoryProjectScope(
    userId: string,
    workspaceId: string,
    projectId: string,
    capability: StoryCapability,
  ): Promise<void> {
    const access = await this.storyPermissions.requireProject(
      userId,
      projectId,
      capability,
    );
    if (access.project.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: 'STORY_PROJECT_NOT_FOUND',
        message: 'Story project not found.',
      });
    }
  }

  private async requireCanvasProjectScope(
    userId: string,
    workspaceId: string,
    projectId: string,
    minimumRole: ProjectMemberRole,
  ): Promise<void> {
    const project = await this.workspacePermissions.requireProjectRole(
      userId,
      projectId,
      minimumRole,
    );
    if (project.workspaceId !== workspaceId) {
      throw new NotFoundException({
        code: 'PROJECT_NOT_FOUND',
        msg: 'Project not found.',
      });
    }
  }
}

function requireConversationScope(input: {
  conversationId: string;
  mode: unknown;
  projectId: unknown;
}):
  | { mode: 'canvas'; projectId: string; chapterId: null }
  | { mode: 'story-canvas'; projectId: string; chapterId: string } {
  if (input.mode !== INFINITE_CANVAS_MODE && input.mode !== STORY_CANVAS_MODE) {
    throw invalidConversationScope();
  }
  const projectId = requiredCopilotProjectId(input.projectId, input.mode);
  if (input.mode === INFINITE_CANVAS_MODE) {
    if (input.conversationId !== `${input.mode}:${projectId}`) {
      throw invalidConversationScope();
    }
    return { mode: input.mode, projectId, chapterId: null };
  }
  const prefix = `${input.mode}:${projectId}:`;
  const chapterId = input.conversationId.startsWith(prefix)
    ? input.conversationId.slice(prefix.length)
    : '';
  const parsedChapterId = z.uuid().safeParse(chapterId);
  if (!parsedChapterId.success || parsedChapterId.data !== chapterId) {
    throw invalidConversationScope();
  }
  return { mode: input.mode, projectId, chapterId: parsedChapterId.data };
}

function invalidConversationScope(): HttpException {
  return new HttpException(
    {
      code: 'COPILOT_CONVERSATION_SCOPE_INVALID',
      message:
        'Copilot conversations must use canvas:<projectId> or story-canvas:<projectId>:<chapterId> for their mode.',
    },
    HttpStatus.BAD_REQUEST,
  );
}

function requiredCopilotWorkspaceId(
  value: string | string[] | undefined,
): string {
  const parsed = z.uuid().safeParse(Array.isArray(value) ? undefined : value);
  if (
    !parsed.success ||
    typeof value !== 'string' ||
    value !== parsed.data ||
    value !== value.toLowerCase()
  ) {
    throw new HttpException(
      value === undefined
        ? 'x-fizz-workspace-id is required for Copilot.'
        : 'x-fizz-workspace-id must be a valid UUID.',
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed.data;
}

function requiredCopilotProjectId(
  value: unknown,
  mode: 'canvas' | 'story-canvas',
): string {
  const parsed = z.uuid().safeParse(value);
  if (
    !parsed.success ||
    typeof value !== 'string' ||
    value !== parsed.data ||
    value !== value.toLowerCase()
  ) {
    throw new HttpException(
      {
        code: 'COPILOT_PROJECT_ID_INVALID',
        message:
          value === undefined
            ? `projectId is required for ${mode}.`
            : 'projectId must be a valid UUID.',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed.data;
}

function requireConversationId(value: unknown): asserts value is string {
  if (
    typeof value !== 'string' ||
    value.trim() !== value ||
    value.length === 0 ||
    value.length > 180
  ) {
    throw new HttpException(
      {
        code: 'COPILOT_CONVERSATION_ID_INVALID',
        message:
          'conversationId must be a non-empty string of at most 180 characters.',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

function requireTurnTrigger(
  value: unknown,
): asserts value is CopilotStreamBody['trigger'] {
  if (
    value !== 'submit-message' &&
    value !== 'regenerate-message' &&
    value !== 'tool-result-continuation'
  ) {
    throw new HttpException(
      {
        code: 'COPILOT_TURN_TRIGGER_INVALID',
        message:
          'trigger must be submit-message, regenerate-message, or tool-result-continuation.',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

async function validateIncomingAssistantContinuation(
  value: unknown,
): Promise<UIMessage> {
  let message: UIMessage;
  try {
    const validated = await validateUIMessages({
      messages: [value],
      tools: canvasTools,
    });
    message = validated[0];
  } catch {
    throw invalidToolContinuation();
  }
  if (
    message.role !== 'assistant' ||
    message.id.trim() !== message.id ||
    message.id.length === 0 ||
    message.id.length > 128 ||
    message.parts.length === 0 ||
    message.parts.length > 128 ||
    !lastAssistantMessageIsCompleteWithToolCalls({ messages: [message] })
  ) {
    throw invalidToolContinuation();
  }
  return message;
}

function invalidToolContinuation(): HttpException {
  return new HttpException(
    {
      code: 'COPILOT_TOOL_CONTINUATION_INVALID',
      message:
        'The continuation must resolve every browser-executed tool call in the canonical assistant step.',
      action: 'refresh_history',
    },
    HttpStatus.BAD_REQUEST,
  );
}

async function validateIncomingUserMessage(
  value: unknown,
  options: { allowDocumentParts: boolean },
): Promise<UIMessage> {
  let message: UIMessage;
  try {
    const validated = await validateUIMessages({ messages: [value] });
    message = validated[0];
  } catch (error) {
    throw invalidUserMessage(error);
  }
  if (
    message.role !== 'user' ||
    message.id.trim() !== message.id ||
    message.id.length === 0 ||
    message.id.length > 128 ||
    message.parts.length > 16
  ) {
    throw invalidUserMessage();
  }
  let hasContent = false;
  let documentParts = 0;
  for (const part of message.parts) {
    if (part.type === 'text') {
      if (Buffer.byteLength(part.text, 'utf8') > 256 * 1024) {
        throw invalidUserMessage();
      }
      if (part.text.trim()) hasContent = true;
      continue;
    }
    if (part.type === COPILOT_DOCUMENT_PART_TYPE) {
      documentParts += 1;
      if (
        !options.allowDocumentParts ||
        documentParts > 1 ||
        !CopilotDocumentPartSchema.safeParse(part).success
      ) {
        throw invalidUserMessage();
      }
      hasContent = true;
      continue;
    }
    throw invalidUserMessage();
  }
  if (!hasContent) throw invalidUserMessage();
  return message;
}

function invalidUserMessage(cause?: unknown): HttpException {
  return new HttpException(
    {
      code: 'COPILOT_MESSAGE_INVALID',
      message:
        'message must be one valid user message containing only text and at most one attached document.',
      ...(cause ? { detail: errorMessage(cause) } : {}),
    },
    HttpStatus.BAD_REQUEST,
  );
}

function assertOptionalString(
  value: unknown,
  field: string,
  maximumLength: number,
): asserts value is string | undefined {
  if (
    value !== undefined &&
    (typeof value !== 'string' || value.length > maximumLength)
  ) {
    throw new HttpException(
      {
        code: 'COPILOT_REQUEST_INVALID',
        message: `${field} must be a string of at most ${maximumLength} characters.`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

function normalizeOptionalContextJson(
  value: unknown,
  field: string,
): CanonicalCopilotContextJson | null {
  if (value === undefined) return null;
  if (typeof value !== 'string') {
    throw new HttpException(
      {
        code: 'COPILOT_DYNAMIC_CONTEXT_INVALID',
        message: `${field} must be a string.`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  if (Buffer.byteLength(value, 'utf8') > COPILOT_MAX_DYNAMIC_CONTEXT_BYTES) {
    throw new HttpException(
      {
        code: 'COPILOT_DYNAMIC_CONTEXT_TOO_LARGE',
        message: `${field} exceeds the safe Copilot context limit.`,
      },
      HttpStatus.PAYLOAD_TOO_LARGE,
    );
  }
  try {
    return canonicalizeCopilotContextJson(value);
  } catch {
    throw new HttpException(
      {
        code: 'COPILOT_DYNAMIC_CONTEXT_INVALID',
        message: `${field} must be a JSON object or array.`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}

function assertModelInputSize(system: string, messages: UIMessage[]): void {
  let serialized: string;
  try {
    serialized = JSON.stringify({ system, messages });
  } catch (error) {
    throw new HttpException(
      {
        code: 'COPILOT_CONVERSATION_INVALID',
        message: `Could not serialize the canonical conversation: ${errorMessage(error)}`,
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  const actualBytes = Buffer.byteLength(serialized, 'utf8');
  if (actualBytes > COPILOT_MAX_MODEL_INPUT_BYTES) {
    throw new HttpException(
      {
        code: 'COPILOT_MODEL_CONTEXT_LIMIT_REACHED',
        message:
          'This conversation has reached the safe model context limit. Start a new conversation to continue.',
        maximumBytes: COPILOT_MAX_MODEL_INPUT_BYTES,
        actualBytes,
        action: 'reset_conversation',
        resetAvailable: true,
      },
      HttpStatus.CONFLICT,
    );
  }
}

function requireExpectedRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new HttpException(
      {
        code: 'COPILOT_RESET_REVISION_REQUIRED',
        message:
          'A non-negative expectedRevision is required to start a new conversation.',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return value as number;
}

function requireExpectedSessionId(
  value: unknown,
  expectedRevision: number,
): string | null {
  if ((value === null || value === undefined) && expectedRevision === 0) {
    return null;
  }
  const parsed = z.uuid().safeParse(value);
  if (
    !parsed.success ||
    typeof value !== 'string' ||
    value !== parsed.data ||
    value !== value.toLowerCase()
  ) {
    throw new HttpException(
      {
        code: 'COPILOT_RESET_SESSION_REQUIRED',
        message:
          'A valid expectedSessionId is required to start a new conversation.',
      },
      HttpStatus.BAD_REQUEST,
    );
  }
  return parsed.data;
}

function copilotStoreHttpError(error: unknown): Error {
  if (error instanceof HttpException) return error;
  if (error instanceof CopilotStoreUnavailableError) {
    return new HttpException(
      { code: error.code, message: error.message },
      HttpStatus.SERVICE_UNAVAILABLE,
    );
  }
  if (!(error instanceof CopilotStoreConflictError)) {
    return error instanceof Error ? error : new Error(String(error));
  }

  const details: Record<
    CopilotStoreConflictError['code'],
    { status: HttpStatus; message: string; action?: string }
  > = {
    COPILOT_STREAM_IN_PROGRESS: {
      status: HttpStatus.CONFLICT,
      message:
        'A Copilot response is already running for this account. Refresh the conversation and wait for it to finish.',
      action: 'refresh_history',
    },
    COPILOT_RETRY_REQUIRED: {
      status: HttpStatus.CONFLICT,
      message:
        'The saved user message is waiting for a retry. Refresh the conversation and retry that message before sending another.',
      action: 'refresh_history',
    },
    COPILOT_RETRY_NOT_ALLOWED: {
      status: HttpStatus.CONFLICT,
      message:
        'That message can no longer be retried. Refresh the conversation before continuing.',
      action: 'refresh_history',
    },
    COPILOT_MESSAGE_ALREADY_EXISTS: {
      status: HttpStatus.CONFLICT,
      message:
        'That message already exists in the canonical conversation. Refresh before continuing.',
      action: 'refresh_history',
    },
    COPILOT_MESSAGE_TOO_LARGE: {
      status: HttpStatus.PAYLOAD_TOO_LARGE,
      message: 'The Copilot message exceeds the safe durable message limit.',
    },
    COPILOT_HISTORY_LIMIT_REACHED: {
      status: HttpStatus.CONFLICT,
      message:
        'This conversation has reached its durable history limit. Start a new conversation to continue.',
      action: 'reset_conversation',
    },
    COPILOT_TOOL_CONTINUATION_INVALID: {
      status: HttpStatus.CONFLICT,
      message:
        'The browser tool results no longer match the canonical assistant turn. Refresh the conversation before continuing.',
      action: 'refresh_history',
    },
    COPILOT_TOOL_CONTINUATION_REQUIRED: {
      status: HttpStatus.CONFLICT,
      message:
        'The assistant is waiting for browser tool results. Complete that tool step or start a new conversation before sending another message.',
      action: 'refresh_history',
    },
    COPILOT_QUOTA_SETTLEMENT_PENDING: {
      status: HttpStatus.CONFLICT,
      message:
        'The previous Copilot charge is still being reconciled. Retry shortly.',
      action: 'refresh_history',
    },
    COPILOT_TURN_STALE: {
      status: HttpStatus.CONFLICT,
      message:
        'The conversation changed in another tab. Refresh it before trying again.',
      action: 'refresh_history',
    },
  };
  const detail = details[error.code];
  return new HttpException(
    {
      code: error.code,
      message: detail.message,
      ...(detail.action ? { action: detail.action } : {}),
      refreshHistory: detail.action === 'refresh_history',
      resetAvailable: detail.action === 'reset_conversation',
    },
    detail.status,
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
