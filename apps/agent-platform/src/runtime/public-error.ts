import { agentPublicErrorSchema, type AgentPublicError } from "./contracts.js";

type PublicErrorPolicy = Readonly<{
  messageKey: string;
  message: string;
  retryable: boolean;
}>;

const GENERIC_FAILURE: PublicErrorPolicy = Object.freeze({
  messageKey: "agent.error.runtime_failed",
  message: "StoryOS could not complete this request. Please retry.",
  retryable: true,
});

const PUBLIC_ERROR_POLICIES: Readonly<Record<string, PublicErrorPolicy>> = Object.freeze({
  AGENT_RUNTIME_FAILED: GENERIC_FAILURE,
  AGENT_RUN_OPEN_FAILED: {
    messageKey: "agent.error.start_failed",
    message: "StoryOS could not start this request. Please retry.",
    retryable: true,
  },
  AGENT_INFERENCE_STEP_FAILED: {
    messageKey: "agent.error.response_failed",
    message: "StoryOS could not generate a response. Please retry.",
    retryable: true,
  },
  AGENT_INFERENCE_OUTPUT_MISSING: {
    messageKey: "agent.error.empty_response",
    message: "StoryOS finished this request without writing a response. Please retry.",
    // An empty turn is transient, not deterministic: a live greeting came back
    // with no text, no tool call and 378 output tokens that were all reasoning
    // tokens — far below any budget, so nothing was truncated and the request
    // itself was fine. Each Activity attempt is a fresh provider call, not a
    // replay of that response, so retrying is exactly what recovers it. By the
    // time this error reaches a creator the attempt budget is already spent,
    // and a new turn is still their best move.
    retryable: true,
  },
  AGENT_TOOL_STEP_FAILED: {
    messageKey: "agent.error.action_failed",
    message: "StoryOS could not complete that action. Please retry.",
    retryable: true,
  },
  AGENT_RUN_END_FAILED: {
    messageKey: "agent.error.finalization_failed",
    message: "StoryOS could not finalize this request. Please retry.",
    retryable: true,
  },
  DOMAIN_GATEWAY_UNAVAILABLE: {
    messageKey: "agent.error.service_unavailable",
    message: "StoryOS is temporarily unavailable. Please retry.",
    retryable: true,
  },
  AGENT_ABLY_MUTABLE_MESSAGES_REQUIRED: {
    messageKey: "agent.error.realtime_unavailable",
    message: "Realtime delivery is unavailable. Please retry shortly.",
    retryable: false,
  },
  AGENT_ABLY_STREAM_RECOVERY_FAILED: {
    messageKey: "agent.error.realtime_delivery_failed",
    message: "Realtime delivery failed before the response was committed. Please retry.",
    retryable: false,
  },
  AGENT_CAPABILITY_DENIED: {
    messageKey: "agent.error.capability_denied",
    message: "This action is not available in the current workspace or permission scope.",
    retryable: false,
  },
  AGENT_ATTACHMENT_REFERENCE_INVALID: {
    messageKey: "agent.error.attachment_reference_invalid",
    message: "One of the attached files is no longer valid. Remove it and attach the file again.",
    retryable: false,
  },
  AGENT_ATTACHMENT_METADATA_MISMATCH: {
    messageKey: "agent.error.attachment_changed",
    message: "An attached file changed after upload. Remove it and attach the file again.",
    retryable: false,
  },
  AGENT_ATTACHMENT_RESOLUTION_INCOMPLETE: {
    messageKey: "agent.error.attachment_unavailable",
    message: "One or more attached files are unavailable. Remove them and attach them again.",
    retryable: false,
  },
  AGENT_ATTACHMENT_CONTEXT_MISSING: {
    messageKey: "agent.error.attachment_context_invalid",
    message: "The attachment could not be verified for this conversation.",
    retryable: false,
  },
  AGENT_ATTACHMENT_CONTEXT_LIMIT_EXCEEDED: {
    messageKey: "agent.error.attachment_context_limit",
    message: "Too many files are active in this request. Start a focused conversation.",
    retryable: false,
  },
  AGENT_CONVERSATION_EMPTY: {
    messageKey: "agent.error.message_missing",
    message: "StoryOS could not find the message for this request. Send it again.",
    retryable: false,
  },
  AGENT_ITERATION_LIMIT: {
    messageKey: "agent.error.operation_limit",
    message:
      "StoryOS reached the safe operation limit before finishing. Refine the request and retry.",
    retryable: false,
  },
  AGENT_RUNTIME_SUSPENSION_UNSUPPORTED: GENERIC_FAILURE,
  AGENT_INFERENCE_SUSPENSION_INCONSISTENT: GENERIC_FAILURE,
  AGENT_MESSAGE_CONVERSATION_IDENTITY_MISMATCH: GENERIC_FAILURE,
  AGENT_MESSAGE_RUN_IDENTITY_MISMATCH: GENERIC_FAILURE,
  AGENT_RUN_ALREADY_FAILED: GENERIC_FAILURE,
});

export function createAgentPublicError(input: {
  error?: unknown;
  fallbackCode: string;
  diagnosticId: string;
  code?: string;
  retryable?: boolean;
}): AgentPublicError {
  const embedded = findEmbeddedPublicError(input.error);
  if (embedded) return embedded;

  const internalCode = input.code ?? findInternalErrorCode(input.error) ?? input.fallbackCode;
  const directPolicy = PUBLIC_ERROR_POLICIES[internalCode];
  const fallbackPolicy = PUBLIC_ERROR_POLICIES[input.fallbackCode];
  const publicCode = directPolicy
    ? internalCode
    : fallbackPolicy
      ? input.fallbackCode
      : "AGENT_RUNTIME_FAILED";
  const resolvedPolicy = directPolicy ?? fallbackPolicy ?? GENERIC_FAILURE;
  return agentPublicErrorSchema.parse({
    code: publicCode,
    retryable: input.retryable ?? retryabilityFrom(input.error) ?? resolvedPolicy.retryable,
    messageKey: resolvedPolicy.messageKey,
    message: resolvedPolicy.message,
    diagnosticId: input.diagnosticId,
  });
}

export function applicationFailureDetailsFor(error: AgentPublicError): Readonly<{
  publicError: AgentPublicError;
}> {
  return Object.freeze({ publicError: agentPublicErrorSchema.parse(error) });
}

export function findEmbeddedPublicError(error: unknown): AgentPublicError | null {
  const seen = new Set<unknown>();
  let current = error;
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    const details = current.details;
    if (Array.isArray(details)) {
      for (const detail of details) {
        const candidate = isRecord(detail) && "publicError" in detail ? detail.publicError : detail;
        const parsed = agentPublicErrorSchema.safeParse(candidate);
        if (parsed.success) return parsed.data;
      }
    }
    current = current.cause;
  }
  return null;
}

/**
 * Activity errors reach a Workflow wrapped in an ActivityFailure, which carries
 * neither a type nor retryability of its own. Both live on the originating
 * failure further down the cause chain.
 */
export function findInternalErrorCode(error: unknown): string | null {
  const seen = new Set<unknown>();
  let current = error;
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    for (const candidate of [current.type, current.code]) {
      if (typeof candidate === "string" && /^[A-Z][A-Z0-9_]{0,127}$/u.test(candidate)) {
        return candidate;
      }
    }
    current = current.cause;
  }
  return null;
}

export function retryabilityFrom(error: unknown): boolean | null {
  const seen = new Set<unknown>();
  let current = error;
  while (isRecord(current) && !seen.has(current)) {
    seen.add(current);
    if (typeof current.retryable === "boolean") return current.retryable;
    if (typeof current.nonRetryable === "boolean") return !current.nonRetryable;
    current = current.cause;
  }
  return null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
