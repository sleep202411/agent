import type {
  StudioAgentApprovalSignal,
  StudioAgentCancelSignal,
  StudioAgentInputSignal,
} from "@repo/shared/studio-agent";

/**
 * Deterministic in-memory index for signals already durably recorded by
 * Temporal. Canonical input/approval state remains in Nest/Postgres.
 */
export class StudioAgentSignalInbox {
  readonly #inputIds = new Set<string>();
  readonly #inputs: StudioAgentInputSignal[] = [];
  readonly #approvals = new Map<string, StudioAgentApprovalSignal>();
  #cancel: StudioAgentCancelSignal | null = null;

  addInput(signal: StudioAgentInputSignal): void {
    if (this.#inputIds.has(signal.inputId)) {
      return;
    }
    this.#inputIds.add(signal.inputId);
    this.#inputs.push(signal);
  }

  addApproval(signal: StudioAgentApprovalSignal): void {
    const current = this.#approvals.get(signal.approvalId);
    if (!current || current.decidedAt <= signal.decidedAt) {
      this.#approvals.set(signal.approvalId, signal);
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

  hasApproval(approvalId: string, actionId: string, inputHash: string): boolean {
    const signal = this.#approvals.get(approvalId);
    return (
      signal !== undefined && signal.actionId === actionId && signal.actionInputHash === inputHash
    );
  }

  takeApproval(
    approvalId: string,
    actionId: string,
    inputHash: string
  ): StudioAgentApprovalSignal | null {
    if (!this.hasApproval(approvalId, actionId, inputHash)) {
      return null;
    }
    const signal = this.#approvals.get(approvalId) ?? null;
    this.#approvals.delete(approvalId);
    return signal;
  }
}
