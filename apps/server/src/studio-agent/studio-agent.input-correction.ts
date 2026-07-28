import { ConflictException } from '@nestjs/common';
import { Prisma, StudioAgentActionStatus } from '@prisma/client';
import {
  StudioAgentErrorSchema,
  type StudioAgentError,
} from '@repo/shared/studio-agent';
import {
  STUDIO_AGENT_INVALID_ACTION_INPUT_CODE,
  boundCapabilityErrorText,
} from './studio-agent.capability-error';

export const STUDIO_AGENT_INPUT_CORRECTIONS_EXHAUSTED_CODE =
  'STUDIO_AGENT_CAPABILITY_INPUT_CORRECTIONS_EXHAUSTED';

export interface StudioAgentInputCorrectionState {
  /** Rejected capability inputs recorded across this whole turn tree. */
  rejections: number;
  /** The frozen per-turn ceiling from the run budget. */
  budget: number;
  /** The last rejection, so the terminal report names a real failure. */
  actionId: string;
  capabilityId: string;
  error: StudioAgentError;
}

/**
 * The correction-budget half of the capability-input contract.
 *
 * A malformed tool call is feedback: it is recorded as a `failed` action, the
 * model reads the issue paths on its next step and fixes them. That loop has to
 * terminate. Nothing else bounds it usefully — the model-step budget is 32 per
 * run, so a model that cannot satisfy a schema would spend a creator's whole
 * turn and quota discovering that, and the turn would end with a generic budget
 * message that explains nothing.
 *
 * So corrections are counted, per turn TREE (`rootRunId`), for the same reason
 * the terminal-write-failure contract is: a delegated child inherits the parent's
 * capabilities, and a per-run counter would reset one delegation away.
 *
 * When the budget is spent the turn is over, deliberately and visibly: the
 * gateway refuses the next model step and the next prepared action, and the run
 * terminalizes `failed` carrying the LAST rejection's own error — the issue
 * paths, not a generic runtime string. That is the honest terminal state: the
 * creator asked for a change, the assistant could not express it, and nothing
 * was written.
 */
export async function findExhaustedInputCorrections(
  transaction: Prisma.TransactionClient,
  rootRunId: string,
  budget: number,
): Promise<StudioAgentInputCorrectionState | null> {
  const rejections = await findInputRejections(transaction, rootRunId);
  const last = rejections.at(-1);
  if (!last || rejections.length < budget) return null;
  return {
    rejections: rejections.length,
    budget,
    actionId: last.actionId,
    capabilityId: last.capabilityId,
    error: last.error,
  };
}

interface StudioAgentInputRejection {
  actionId: string;
  capabilityId: string;
  error: StudioAgentError;
}

/**
 * Every rejected capability input in the tree, oldest first.
 *
 * Rejections are identified by the one error code both validation gates report
 * (`STUDIO_AGENT_INVALID_ACTION_INPUT_CODE`) rather than by status alone: a
 * `failed` action can equally be a write that ran and lost, which is a different
 * contract with a different remedy.
 */
async function findInputRejections(
  transaction: Prisma.TransactionClient,
  rootRunId: string,
): Promise<StudioAgentInputRejection[]> {
  const candidates = await transaction.studioAgentAction.findMany({
    where: {
      status: StudioAgentActionStatus.failed,
      run: { rootRunId },
    },
    select: {
      id: true,
      capabilityId: true,
      error: true,
    },
    orderBy: [{ completedAt: 'asc' }, { id: 'asc' }],
  });
  const rejections: StudioAgentInputRejection[] = [];
  for (const candidate of candidates) {
    const parsed = StudioAgentErrorSchema.safeParse(candidate.error);
    if (!parsed.success) continue;
    if (parsed.data.code !== STUDIO_AGENT_INVALID_ACTION_INPUT_CODE) continue;
    rejections.push({
      actionId: candidate.id,
      capabilityId: candidate.capabilityId,
      error: parsed.data,
    });
  }
  return rejections;
}

/**
 * The refusal every gateway entry point raises once the budget is spent.
 *
 * A 409, like the terminal-write-failure refusal: the runtime maps non-retryable
 * HTTP statuses to a non-retryable Temporal failure, which drives the workflow
 * into its `fail` transition — where {@link inputCorrectionExhaustedError}
 * replaces the workflow's own useless string.
 */
export function inputCorrectionExhaustedConflict(
  state: StudioAgentInputCorrectionState,
  refused: string,
): ConflictException {
  return new ConflictException({
    code: STUDIO_AGENT_INPUT_CORRECTIONS_EXHAUSTED_CODE,
    message: `${refused} ${describeExhaustion(state)}`,
    failedActionId: state.actionId,
    capabilityError: state.error,
  });
}

/** The creator-facing error the run terminalizes with. */
export function inputCorrectionExhaustedError(
  state: StudioAgentInputCorrectionState,
): StudioAgentError {
  return StudioAgentErrorSchema.parse({
    ...state.error,
    message: boundCapabilityErrorText(
      `${describeExhaustion(state)} ${state.error.message}`,
    ),
    details: {
      ...(state.error.details ?? {}),
      rejections: state.rejections,
      correctionBudget: state.budget,
      lastFailedActionId: state.actionId,
    },
  });
}

/** Human-readable reason recorded on the run when the budget is spent. */
export function inputCorrectionExhaustedReason(
  state: StudioAgentInputCorrectionState,
): string {
  return describeExhaustion(state);
}

function describeExhaustion(state: StudioAgentInputCorrectionState): string {
  return `The assistant sent ${state.rejections} invalid ${state.capabilityId} input${state.rejections === 1 ? '' : 's'} in this turn, which is its limit of ${state.budget}, so the turn was stopped and nothing was changed.`;
}
