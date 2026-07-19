import { createHash } from 'crypto';
import { HttpException } from '@nestjs/common';
import { STORY_AGENT_BRIEF_MAX_CHARS } from '@repo/shared/story-agent';
import { tool } from 'ai';
import { z } from 'zod';
import type { AuthUser } from '../auth';
import { StoryAgentRunService } from '../story-studio/story-agent-run.service';
import { CopilotStore, type CopilotActiveTurn } from './copilot.store';

/**
 * The chat model's ONLY Story authoring tool carries flat intent — title,
 * summary, and a natural-language drafting brief. Concrete operations are
 * authored server-side by the StoryPatchAuthor inside a durable authoring run.
 *
 * Invariant (learned the hard way): tool argument schemas must stay shallow.
 * Nested union documents are erased by schema conversion and mangled by
 * function-call argument encoding across providers.
 */
export const StoryPatchToolInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    summary: z.string().trim().min(1).max(4_000),
    brief: z.string().trim().min(1).max(STORY_AGENT_BRIEF_MAX_CHARS),
    /**
     * documentId of a script/outline the creator uploaded into this
     * conversation. Stays a flat string on purpose (see invariant above); the
     * run service verifies conversation ownership before anything is filed.
     */
    documentId: z.uuid().optional(),
  })
  .strict();

const CanonicalStoryPatchBriefSchema = z
  .object({
    proposal: StoryPatchToolInputSchema,
  })
  .strict();

export function createStoryCanvasTools(input: {
  runs: StoryAgentRunService;
  store: CopilotStore;
  user: AuthUser;
  workspaceId: string;
  projectId: string;
  conversationId: string;
  /** Canonical conversation generation; changes after reset to prevent ABA. */
  sessionId: string;
  /** Canonical id of the persisted user turn; stable across safe retries. */
  userMessageId: string;
  turn: CopilotActiveTurn;
  /**
   * Server-fault escape hatch. In ai@6.x a thrown execute error does NOT fail
   * the stream — it becomes a tool-error part, the step loop continues, the
   * raw error text reaches the model, and the turn settles as completed and
   * billed. For 5xx/unknown faults the controller must instead abort the
   * provider stream so the turn terminalizes as aborted and refunds.
   */
  onServerFault: (error: unknown) => void;
}) {
  let proposalAttempted = false;
  const proposalIdempotencyKey = `story-copilot:${createHash('sha256')
    .update('story-copilot-proposal:v3')
    .update('\0')
    .update(input.user.userId)
    .update('\0')
    .update(input.workspaceId)
    .update('\0')
    .update(input.projectId)
    .update('\0')
    .update(input.conversationId)
    .update('\0')
    .update(input.sessionId)
    .update('\0')
    .update(input.userMessageId)
    .digest('hex')}`;
  return {
    propose_story_patch: tool({
      description:
        'File one reviewable Story Canvas change request. Provide a clear editorial brief; a dedicated server-side author drafts the concrete operations, and the creator must review and confirm the resulting proposal before anything is applied. When the request is based on a document the creator attached, pass its documentId — the author receives the full document text, so keep the brief to editorial instructions instead of pasting the document. This never edits the project directly.',
      inputSchema: StoryPatchToolInputSchema,
      execute: async (proposal: {
        title: string;
        summary: string;
        brief: string;
        documentId?: string;
      }) => {
        if (proposalAttempted) {
          return {
            status: 'rejected' as const,
            code: 'COPILOT_STORY_PATCH_ALREADY_PROPOSED',
            message:
              'This turn already filed a change request. Do not call the tool again this turn.',
          };
        }
        // Claim before awaiting so parallel tool calls cannot both cross the
        // side-effect boundary in one model step.
        proposalAttempted = true;
        try {
          const run = await input.runs.createAuthoringRun(
            input.user,
            input.workspaceId,
            input.projectId,
            {
              ...proposal,
              idempotencyKey: proposalIdempotencyKey,
              conversationId: input.conversationId,
            },
            {
              canonicalizeAndFence: async (tx, request) => {
                const canonical = CanonicalStoryPatchBriefSchema.parse(
                  await input.store.canonicalizeTurnProposalInTransaction(tx, {
                    userId: input.user.userId,
                    conversationId: input.conversationId,
                    sessionId: input.sessionId,
                    turn: input.turn,
                    proposal: { ...request },
                  }),
                );
                return {
                  ...canonical,
                  initiatedBySessionId: input.sessionId,
                };
              },
            },
          );
          return { status: 'accepted' as const, run };
        } catch (error) {
          // Deterministic domain rejections become structured results the
          // model can react to gracefully; server faults abort the stream.
          const rejection = toolRejection(error);
          if (rejection) return rejection;
          input.onServerFault(error);
          throw error;
        }
      },
    }),
  };
}

function toolRejection(error: unknown): {
  status: 'rejected';
  code: string;
  message: string;
} | null {
  if (!(error instanceof HttpException)) return null;
  // Only client-fault statuses are deterministic domain rejections the model
  // should narrate. Server faults (5xx) must surface as stream errors so the
  // creator sees a retryable failure, not a confident explanation.
  if (error.getStatus() >= 500) return null;
  const response = error.getResponse();
  if (typeof response === 'string') {
    return {
      status: 'rejected',
      code: 'STORY_AGENT_REQUEST_REJECTED',
      message: response,
    };
  }
  const body = response as { code?: unknown; message?: unknown };
  return {
    status: 'rejected',
    code:
      typeof body.code === 'string' && body.code
        ? body.code
        : 'STORY_AGENT_REQUEST_REJECTED',
    message:
      typeof body.message === 'string' && body.message
        ? body.message
        : 'The Story change request was rejected.',
  };
}

export type StoryCanvasTools = ReturnType<typeof createStoryCanvasTools>;
