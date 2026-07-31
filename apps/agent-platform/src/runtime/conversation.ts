import { isToolUIPart, type UIMessage } from "ai";

export type CanonicalRunState =
  | Readonly<{ kind: "needs-inference" }>
  | Readonly<{ kind: "awaiting-approval" }>
  | Readonly<{ kind: "awaiting-runtime-input" }>
  | Readonly<{ kind: "assistant-response-empty" }>
  | Readonly<{ kind: "assistant-response-complete" }>;

/**
 * Classifies the canonical Ably run after an Activity retry or continuation.
 * A trailing assistant response without unresolved tool work was already
 * produced by a previous attempt and must not trigger a second model call.
 *
 * "Already answered" and "already tried and produced nothing" look identical in
 * message shape, so they are separate states here rather than a judgement each
 * caller has to remember to repeat.
 */
export function classifyCanonicalRun(messages: ReadonlyArray<UIMessage>): CanonicalRunState {
  const lastMessage = messages.at(-1);
  if (!lastMessage) {
    return { kind: "needs-inference" };
  }

  // Steering can arrive while an assistant tool-control message is already
  // open. In that case the steering user message sorts after the assistant
  // message, but it must not bypass approval or a runtime-resume contract.
  // Resolve active control state from the latest assistant before deciding
  // whether the trailing user input needs another provider call.
  const lastAssistant = messages.findLast((message) => message.role === "assistant");
  const toolParts = lastAssistant?.parts.filter(isToolUIPart) ?? [];
  if (toolParts.some((part) => part.state === "approval-requested")) {
    return { kind: "awaiting-approval" };
  }
  if (hasActiveMastraControlPart(lastAssistant, "data-tool-call-approval")) {
    return { kind: "awaiting-approval" };
  }
  if (hasActiveMastraControlPart(lastAssistant, "data-tool-call-suspended")) {
    return { kind: "awaiting-runtime-input" };
  }
  if (lastMessage.role !== "assistant") {
    return { kind: "needs-inference" };
  }
  if (toolParts.length > 0) {
    return { kind: "needs-inference" };
  }
  if (!hasAssistantOutput(messages)) {
    return { kind: "assistant-response-empty" };
  }
  return { kind: "assistant-response-complete" };
}

/**
 * The transport opens an assistant message as soon as a model step starts, so a
 * step that dies mid-stream leaves a content-free assistant turn on the Ably
 * run, and durable memory silently drops that shell when saving it. Reporting
 * such a turn as complete tells the product a request succeeded while the
 * conversation shows the user nothing at all, which is indistinguishable from
 * the agent ignoring them. A completed turn must carry real assistant output.
 */
export function hasAssistantOutput(messages: ReadonlyArray<UIMessage>): boolean {
  return messages.some(
    (message) => message.role === "assistant" && message.parts.some(isAssistantOutputPart)
  );
}

function isAssistantOutputPart(part: UIMessage["parts"][number]): boolean {
  // `step-start` is a stream boundary marker, never model output.
  if (part.type === "step-start") return false;
  if (part.type === "text" || part.type === "reasoning") return part.text.trim().length > 0;
  return true;
}

function hasActiveMastraControlPart(
  message: UIMessage | undefined,
  type: "data-tool-call-approval" | "data-tool-call-suspended"
): boolean {
  if (!message) return false;
  return message.parts.some((part) => {
    if (part.type !== type || !("data" in part) || !isRecord(part.data)) return false;
    return part.data.resumed !== true;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
