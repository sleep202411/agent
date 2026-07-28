import type {
  StudioAgentApprovalDecision,
  StudioAgentApprovalSignal,
  StudioAgentCancelSignal,
  StudioAgentDeliveryTrigger,
  StudioAgentInputSignal,
} from "@repo/shared/studio-agent";

/** One approval challenge the workflow is parked on. */
export interface StudioAgentApprovalChallenge {
  approvalId: string;
  actionId: string;
  actionInputHash: string;
}

/**
 * Every gated call answered, plus the trigger that brings the run back.
 *
 * The resume trigger is part of the ANSWER, not of the run: it is the `ai-input`
 * the browser published to carry the decisions, and it is the only event whose
 * `run-id` header will make `createRun().start()` publish `ai-run-resume`
 * instead of a second `ai-run-start`.
 */
export interface StudioAgentApprovalOutcome {
  decisions: StudioAgentApprovalDecision[];
  resumeDelivery: StudioAgentDeliveryTrigger;
  signal: StudioAgentApprovalSignal;
}

/**
 * Deterministic in-memory index for signals already durably recorded by
 * Temporal. Canonical input/approval state remains in Nest/Postgres.
 */
export class StudioAgentSignalInbox {
  readonly #inputIds = new Set<string>();
  readonly #inputs: StudioAgentInputSignal[] = [];
  /** approvalId -> the newest signal that answered it. */
  readonly #approvals = new Map<
    string,
    { signal: StudioAgentApprovalSignal; decision: StudioAgentApprovalDecision }
  >();
  #cancel: StudioAgentCancelSignal | null = null;

  addInput(signal: StudioAgentInputSignal): void {
    if (this.#inputIds.has(signal.inputId)) {
      return;
    }
    this.#inputIds.add(signal.inputId);
    this.#inputs.push(signal);
  }

  /**
   * Index one signal's whole answer.
   *
   * A signal carries EVERY decision the creator made in one continuation, so it
   * is unpacked per approval: the workflow parks on a set of challenges and has
   * to be able to ask "have all of them been answered" without knowing how the
   * answers were batched.
   */
  addApproval(signal: StudioAgentApprovalSignal): void {
    for (const decision of signal.decisions) {
      const current = this.#approvals.get(decision.approvalId);
      if (!current || current.signal.decidedAt <= signal.decidedAt) {
        this.#approvals.set(decision.approvalId, { signal, decision });
      }
    }
  }

  requestCancellation(signal: StudioAgentCancelSignal): void {
    if (!this.#cancel || this.#cancel.requestedAt <= signal.requestedAt) {
      this.#cancel = signal;
    }
  }

  cancellation(): StudioAgentCancelSignal | null {
    return this.#cancel;
  }

  peekInterrupt(): StudioAgentInputSignal | null {
    return (
      this.#inputs.find(
        (signal) => signal.delivery === "steer" || signal.delivery === "stop_and_send"
      ) ?? null
    );
  }

  takeInterrupt(): StudioAgentInputSignal | null {
    const index = this.#inputs.findIndex(
      (signal) => signal.delivery === "steer" || signal.delivery === "stop_and_send"
    );
    return index === -1 ? null : (this.#inputs.splice(index, 1)[0] ?? null);
  }

  /**
   * Are ALL of these challenges answered?
   *
   * All, not any: the model gates every approval-requiring call of one step at
   * once, and `useChat` only publishes the resuming continuation when every one
   * of them has been answered. Waking on a partial answer would resume a run
   * whose remaining calls have no decision.
   */
  hasApprovals(challenges: readonly StudioAgentApprovalChallenge[]): boolean {
    return challenges.every((challenge) => this.#matches(challenge));
  }

  takeApprovals(
    challenges: readonly StudioAgentApprovalChallenge[]
  ): StudioAgentApprovalOutcome | null {
    if (challenges.length === 0 || !this.hasApprovals(challenges)) {
      return null;
    }
    const decisions: StudioAgentApprovalDecision[] = [];
    let newest: StudioAgentApprovalSignal | null = null;
    for (const challenge of challenges) {
      // Non-null by `hasApprovals` above.
      const entry = this.#approvals.get(challenge.approvalId)!;
      decisions.push(entry.decision);
      if (!newest || newest.decidedAt <= entry.signal.decidedAt) {
        newest = entry.signal;
      }
      this.#approvals.delete(challenge.approvalId);
    }
    // Non-null: `challenges` is non-empty and every entry resolved.
    const signal = newest!;
    return { decisions, resumeDelivery: signal.resumeDelivery, signal };
  }

  #matches(challenge: StudioAgentApprovalChallenge): boolean {
    const entry = this.#approvals.get(challenge.approvalId);
    return (
      entry !== undefined &&
      entry.decision.actionId === challenge.actionId &&
      entry.decision.actionInputHash === challenge.actionInputHash
    );
  }
}
