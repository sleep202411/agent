/**
 * Studio copilot — thin, stateless streaming endpoint.
 *
 * Route: POST /copilot/stream  (reached by the client as /aurora/copilot/stream
 * via the studio Next rewrite; the /aurora prefix is stripped at the edge).
 *
 * Deliberately diverges from the StoryOS path (server-consumes-SSE → WS fan-out
 * + per-project lock): the copilot is short, synchronous, single-consumer, so
 * we stream the AI-SDK UI message stream straight to the browser via
 * pipeUIMessageStreamToResponse and persist on finish. No lock, no queue, no
 * durable run to reap. Auth is the global AuthGuard (satoken); generation
 * credits are untouched here (no tools yet).
 */
import {
  Body,
  Controller,
  HttpException,
  HttpStatus,
  Post,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  convertToModelMessages,
  stepCountIs,
  streamText,
  type UIMessage,
} from 'ai';
import { CurrentUser, type AuthUser } from '../auth';
import { createCopilotModel } from './copilot.model';
import { buildSystemPrompt } from './copilot.prompt';
import { CopilotStore } from './copilot.store';
import { canvasTools } from './copilot.tools';

interface CopilotStreamBody {
  messages: UIMessage[];
  conversationId: string;
  projectId?: string;
  mode?: string;
  /** Compact JSON digest of the current canvas, rebuilt by the client each turn. */
  graphContext?: string;
  /** Compact JSON digest of usable models (id/name/type), rebuilt by the client. */
  modelsContext?: string;
}

@Controller('copilot')
export class CopilotController {
  constructor(private readonly store: CopilotStore) {}

  @Post('stream')
  async stream(
    @Body() body: CopilotStreamBody,
    @CurrentUser() user: AuthUser,
    @Res() res: Response,
  ): Promise<void> {
    const {
      messages,
      conversationId,
      projectId,
      mode,
      graphContext,
      modelsContext,
    } = body ?? ({} as CopilotStreamBody);
    if (!conversationId) {
      throw new HttpException(
        'conversationId is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!Array.isArray(messages)) {
      throw new HttpException(
        'messages must be an array',
        HttpStatus.BAD_REQUEST,
      );
    }

    const modelMessages = await convertToModelMessages(messages, {
      // A prior turn interrupted mid tool-loop can persist a tool call with no
      // result; stripping incomplete calls prevents MissingToolResultsError
      // from bricking the conversation on the next turn.
      ignoreIncompleteToolCalls: true,
    }).catch((err) => {
      console.error('[copilot] convertToModelMessages failed', err);
      throw new HttpException(
        'Could not parse the conversation history.',
        HttpStatus.BAD_REQUEST,
      );
    });

    const result = streamText({
      model: createCopilotModel(),
      system: buildSystemPrompt({ mode, graphContext, modelsContext }),
      messages: modelMessages,
      tools: canvasTools,
      // Tools run client-side (no server `execute`), so each server call is a
      // single step; the multi-step loop is driven and bounded on the client.
      stopWhen: stepCountIs(8),
      onError({ error }) {
        // Structured log — never a silent fallback bubble.
        console.error('[copilot] streamText error', error);
      },
    });

    result.pipeUIMessageStreamToResponse(res, {
      originalMessages: messages,
      onFinish: ({ messages: finalMessages, isAborted }) => {
        // Don't persist an interrupted turn — it can leave a tool call without
        // a result and break the next convertToModelMessages.
        if (isAborted) return;
        void this.store
          .save({
            conversationId,
            userId: user.userId,
            projectId: projectId ?? null,
            mode: mode ?? null,
            messages: finalMessages,
            updatedAt: Date.now(),
          })
          .catch((err) => console.error('[copilot] persist failed', err));
      },
      // Surfaced to the client as the stream error — actionable, not vague.
      onError: (error) =>
        error instanceof Error
          ? error.message
          : 'The copilot hit an error. Please retry.',
    });
  }

  /** Seed the client on mount with the persisted conversation. */
  @Post('history')
  async history(
    @Body() body: { conversationId?: string },
    @CurrentUser() user: AuthUser,
  ): Promise<{ conversationId: string; messages: UIMessage[] }> {
    const conversationId = body?.conversationId;
    if (!conversationId) {
      throw new HttpException(
        'conversationId is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    const conv = await this.store.load(user.userId, conversationId);
    return { conversationId, messages: conv?.messages ?? [] };
  }
}
