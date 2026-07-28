import { ConflictException } from '@nestjs/common';
import {
  Prisma,
  StudioAgentActionStatus,
  StudioAgentCapabilityEffect,
} from '@prisma/client';
import {
  StudioAgentErrorSchema,
  type StudioAgentError,
} from '@repo/shared/studio-agent';
import { STUDIO_AGENT_INVALID_ACTION_INPUT_CODE } from './studio-agent.capability-error';

/**
 * Effects that promise a durable change to the creator's workspace.
 *
 * `read` and `generate` are excluded deliberately: neither is a promise about
 * persisted product state, so a turn that only failed one of them may still
 * finish `succeeded`. The contract below is about a FAILED WRITE, never about
 * the absence of changes.
 */
const MUTATING_EFFECTS: readonly StudioAgentCapabilityEffect[] = [
  StudioAgentCapabilityEffect.write,
  StudioAgentCapabilityEffect.delete,
  StudioAgentCapabilityEffect.publish,
  StudioAgentCapabilityEffect.external,
];

export const STUDIO_AGENT_TERMINAL_WRITE_FAILURE_CODE =
  'STUDIO_AGENT_TERMINAL_WRITE_FAILED';

export interface StudioAgentTerminalWriteFailure {
  actionId: string;
  capabilityId: string;
  capabilityVersion: string;
  effect: StudioAgentCapabilityEffect;
  error: StudioAgentError;
}

/**
 * The turn-tree poison check behind the terminal-write-failure contract.
 *
 * A capability that mutates the workspace and fails with `retryable: false`
 * has consumed the creator's request and delivered nothing. Before this check
 * existed the failure was absorbed into a `failed` action row, the model kept
 * talking, and the turn was recorded `succeeded` with the draft untouched —
 * five consecutive `story.canvas.apply_patch` failures once ended in an
 * on-screen promise that the story had been replaced.
 *
 * The scope is the whole turn TREE (`rootRunId`), not one run and not one
 * step. The recorded incident spread five failures over five steps, and a
 * delegated child inherits the same write capabilities as its parent, so
 * anything narrower leaves the same lie reachable one delegation away.
 *
 * Callers must already hold the thread lock when they intend to act on the
 * result; the query itself takes no locks.
 */
export async function findTerminalWriteFailure(
  transaction: Prisma.TransactionClient,
  rootRunId: string,
): Promise<StudioAgentTerminalWriteFailure | null> {
  const candidates = await transaction.studioAgentAction.findMany({
    where: {
      status: StudioAgentActionStatus.failed,
      effect: { in: [...MUTATING_EFFECTS] },
      run: { rootRunId },
    },
    select: {
      id: true,
      capabilityId: true,
      capabilityVersion: true,
      effect: true,
      error: true,
    },
    orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
  });

  for (const candidate of candidates) {
    const parsed = StudioAgentErrorSchema.safeParse(candidate.error);
    if (parsed.success && parsed.data.retryable) continue;
    // A rejected capability input never reached the mutation: both gates run
    // before the capability does, and the attempt savepoint discards anything a
    // later failure could have written. Poisoning the tree on the first typo is
    // what made a malformed tool call fatal — the model was never allowed the
    // step in which it would have fixed it. Correctable rejections are bounded
    // by their own contract instead (studio-agent.input-correction.ts), which
    // terminalizes the turn once the corrections are spent.
    if (
      parsed.success &&
      parsed.data.code === STUDIO_AGENT_INVALID_ACTION_INPUT_CODE
    ) {
      continue;
    }
    return {
      actionId: candidate.id,
      capabilityId: candidate.capabilityId,
      capabilityVersion: candidate.capabilityVersion,
      effect: candidate.effect,
      // A failed mutating action whose error row is missing or unreadable
      // cannot be shown to be retryable, and an unexplained write failure is
      // the one thing a turn must never report success over. Fail closed with
      // an error that says exactly that instead of skipping the row.
      error: parsed.success
        ? parsed.data
        : StudioAgentErrorSchema.parse({
            code: 'studio_agent.write_failed',
            message: `${candidate.capabilityId} failed without a readable error and cannot be retried.`,
            retryable: false,
            details: { actionId: candidate.id },
          }),
    };
  }
  return null;
}

/**
 * The refusal every gateway entry point raises once the tree is poisoned.
 *
 * It is deliberately a 409: the runtime maps non-retryable HTTP statuses to a
 * non-retryable Temporal failure, which drives the workflow into its `fail`
 * transition — where the capability's own error is restored as the run error.
 */
export function terminalWriteFailureConflict(
  failure: StudioAgentTerminalWriteFailure,
  refused: string,
): ConflictException {
  return new ConflictException({
    code: STUDIO_AGENT_TERMINAL_WRITE_FAILURE_CODE,
    message: `${refused} ${failure.capabilityId} failed and cannot be retried: ${failure.error.message}`,
    failedActionId: failure.actionId,
    capabilityError: failure.error,
  });
}

/** Human-readable reason recorded on the run when the tree is poisoned. */
export function terminalWriteFailureReason(
  failure: StudioAgentTerminalWriteFailure,
): string {
  return `${failure.capabilityId} failed with a non-retryable error, so this turn changed nothing it claimed to change.`;
}
