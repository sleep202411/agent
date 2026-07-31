export const ABLY_MUTABLE_MESSAGES_ERROR_CODE = 93_002;
export const ABLY_MUTABLE_MESSAGES_FAILURE_TYPE = "AGENT_ABLY_MUTABLE_MESSAGES_REQUIRED";
export const ABLY_ENCODER_RECOVERY_ERROR_CODE = 104_000;
export const ABLY_ENCODER_RECOVERY_FAILURE_TYPE = "AGENT_ABLY_STREAM_RECOVERY_FAILED";
const ABLY_ENCODER_RECOVERY_MESSAGE_PREFIX =
  "unable to flush pending appends; recovery failed for stream(s):";

export type AgentTransportFailure = Readonly<{
  type: string;
  message: string;
  retryable: boolean;
  details?: Readonly<Record<string, unknown>>;
}>;

/**
 * Convert a known Ably infrastructure rejection into a stable product error.
 *
 * AI Transport wraps a failed append in EncoderRecoveryFailed (104000), while
 * preserving the original Ably ErrorInfo as `cause`. Walk that chain instead
 * of keying off the wrapper text, which contains a generated stream ID.
 */
export function classifyAgentTransportFailure(
  error: unknown,
  channelName: string
): AgentTransportFailure | null {
  const mutableMessagesError = findAblyError(error, ABLY_MUTABLE_MESSAGES_ERROR_CODE);
  const channelNamespace = channelName.split(":", 1)[0] ?? channelName;
  if (mutableMessagesError) {
    return {
      type: ABLY_MUTABLE_MESSAGES_FAILURE_TYPE,
      message:
        `StoryOS realtime streaming is not configured for the Ably ` +
        `"${channelNamespace}" channel namespace. Enable “Message annotations, updates, ` +
        `deletes, and appends” (mutableMessages) for that namespace (Ably 93002).`,
      retryable: false,
      details: {
        ablyCode: mutableMessagesError.code,
        channelNamespace,
      },
    };
  }

  const encoderRecoveryError = findAblyError(error, ABLY_ENCODER_RECOVERY_ERROR_CODE);
  if (!encoderRecoveryError && !isEncoderRecoveryMessage(error)) return null;

  return {
    type: ABLY_ENCODER_RECOVERY_FAILURE_TYPE,
    message:
      `StoryOS could not commit its realtime output because Ably failed both the streaming ` +
      `append and its recovery update on the "${channelNamespace}" channel namespace. ` +
      `The response was not published. Verify that mutableMessages is enabled and that Ably ` +
      `is available before resending (Ably AI Transport 104000).`,
    retryable: false,
    details: {
      ablyCode: ABLY_ENCODER_RECOVERY_ERROR_CODE,
      channelNamespace,
    },
  };
}

/**
 * Vercel's stream bridge currently reduces the AI Transport ErrorInfo to a
 * plain Error before it reaches the Activity boundary. The documented numeric
 * code and cause are gone at that point, leaving only AI Transport's fixed
 * EncoderRecoveryFailed message prefix. Match only that exact SDK prefix and
 * deliberately ignore the generated stream IDs that follow it.
 */
function isEncoderRecoveryMessage(error: unknown): boolean {
  return error instanceof Error && error.message.startsWith(ABLY_ENCODER_RECOVERY_MESSAGE_PREFIX);
}

function findAblyError(error: unknown, code: number): AblyErrorLike | null {
  const seen = new Set<unknown>();
  let current = error;

  while (isAblyErrorLike(current) && !seen.has(current)) {
    if (current.code === code) return current;
    seen.add(current);
    current = current.cause;
  }
  return null;
}

type AblyErrorLike = Readonly<{
  code: number;
  cause?: unknown;
}>;

/**
 * `@ably/ai-transport` can resolve a different physical `ably` package instance
 * from the application bundle. `instanceof Ably.ErrorInfo` is therefore not a
 * valid boundary check; the documented numeric `code` and chained `cause` are
 * the stable cross-package contract.
 */
function isAblyErrorLike(value: unknown): value is AblyErrorLike {
  return (
    typeof value === "object" && value !== null && "code" in value && typeof value.code === "number"
  );
}
