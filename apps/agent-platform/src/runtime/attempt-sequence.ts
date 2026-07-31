import type {
  AgentInvocationAdmission,
  AgentInvocationCommand,
  AggregateAttemptCursor,
  DurableAttemptIdentity,
} from "./contracts.js";

type AttemptCommandIdentity = Pick<
  AgentInvocationCommand,
  "invocationId" | "attemptId" | "attemptOrdinal"
>;

export function attemptAdmissionDecision(input: {
  command: AttemptCommandIdentity;
  acceptedAttempt: DurableAttemptIdentity | undefined;
  aggregate: AggregateAttemptCursor | undefined;
}): Extract<
  AgentInvocationAdmission["status"],
  "accepted" | "already-accepted" | "sequence-conflict"
> {
  if (input.acceptedAttempt) {
    return sameAttemptIdentity(input.acceptedAttempt, input.command)
      ? "already-accepted"
      : "sequence-conflict";
  }
  if (!input.aggregate) {
    return input.command.attemptOrdinal === 0 ? "accepted" : "sequence-conflict";
  }
  return input.aggregate.phase === "waiting_for_approval" &&
    input.command.attemptOrdinal === input.aggregate.attemptOrdinal + 1
    ? "accepted"
    : "sequence-conflict";
}

export function attemptIdentity(command: AttemptCommandIdentity): DurableAttemptIdentity {
  return {
    invocationId: command.invocationId,
    attemptId: command.attemptId,
    attemptOrdinal: command.attemptOrdinal,
  };
}

function sameAttemptIdentity(left: DurableAttemptIdentity, right: AttemptCommandIdentity): boolean {
  return (
    left.invocationId === right.invocationId &&
    left.attemptId === right.attemptId &&
    left.attemptOrdinal === right.attemptOrdinal
  );
}
