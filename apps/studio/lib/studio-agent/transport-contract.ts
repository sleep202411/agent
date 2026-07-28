/**
 * The Studio Agent wire, as the browser sees it.
 *
 * Delivery is `@ably/ai-transport`. The library owns everything that is a
 * *conversation*: messages, token streaming, tool calls, run lifecycle,
 * cancellation, reconnection. `@repo/shared`'s `studio-agent-transport` owns
 * what the AGENT adds to that wire — its metadata and its two data parts. This
 * file owns the last piece: the browser's own half of the same wire, and the
 * `UIMessage` type that binds all three together.
 *
 * There is exactly one delivery mechanism and exactly one codec. Nothing here
 * is a second pipe, a fallback, or a replay path.
 *
 * ## The division of labour
 *
 * | Fact                                    | Carried by                        |
 * | --------------------------------------- | --------------------------------- |
 * | user prompt, assistant prose, tokens    | library (`text` parts, streamed)  |
 * | tool calls and their results            | library (`tool-*` parts)          |
 * | which run is live, and how it ended     | library (`RunInfo`)               |
 * | non-tool agent steps                    | `data-studio-agent-activity`      |
 * | the turn's rich terminal error          | `data-studio-agent-failure`       |
 * | files the creator attached to a prompt  | `data-studio-agent-attachment`    |
 * | approvals, delegated tasks, change sets | PostgreSQL, over `GET .../snapshot` |
 *
 * The last row is the deliberate one, and it is stated at length on
 * `StudioAgentUIDataParts` in `@repo/shared`: those facts are written by
 * transactions no `AgentRun` owns, so there is no honest publisher for them.
 * The channel says WHEN to look; Postgres says what happened.
 */

import {
  STUDIO_AGENT_ACTIVITY_DATA_PART,
  STUDIO_AGENT_FAILURE_DATA_PART,
  type StudioAgentInputDelivery,
  type StudioAgentMessagePart,
  type StudioAgentToolApprovalInvocationRequest,
  type StudioAgentUIDataParts,
  type StudioAgentUIMetadata,
} from "@repo/shared";
import { isToolUIPart, type UIMessage, type UITools } from "ai";

export { STUDIO_AGENT_ACTIVITY_DATA_PART, STUDIO_AGENT_FAILURE_DATA_PART } from "@repo/shared";

/**
 * The endpoint the `ChatTransport` POSTs `Invocation.toJSON()` to.
 *
 * The invocation body is only `{ inputEventId, sessionName }` — run identity
 * lives on the channel. Everything our control plane needs to authorize and
 * schedule the turn rides alongside it, added by `prepareSendMessagesRequest`.
 */
export const STUDIO_AGENT_INVOCATION_PATH = "/aurora/studio-agent/invocations";

/**
 * `data-studio-agent-attachment` — a file the creator attached to a prompt.
 *
 * The one data part the BROWSER publishes rather than the agent, which is why
 * it is declared here and not in the shared agent-output contract. It exists
 * because a `FileUIPart` cannot hold what our attachments are: a registered
 * `attachmentId`, a moderation `status`, and a byte size the composer and the
 * transcript both render. A second creator watching the same thread sees the
 * attachment live for the same reason they see the prompt live — it is on the
 * same message, in the same codec, on the same channel.
 *
 * The agent never reads it: its model context comes from `loadModelPlan`, not
 * from the channel.
 */
export const STUDIO_AGENT_ATTACHMENT_DATA_PART = "data-studio-agent-attachment" as const;

export type StudioAgentAttachment = Extract<StudioAgentMessagePart, { type: "attachment" }>;

/** The browser's addition to the agent's data-part set. */
export interface StudioAgentClientDataParts {
  "studio-agent-attachment": StudioAgentAttachment;
}

type StudioAgentDataPartMap = StudioAgentUIDataParts & StudioAgentClientDataParts;

/**
 * Every data part on this wire.
 *
 * Written as a mapped type rather than an intersection of the two interfaces
 * because the AI SDK's `UIDataTypes` is `Record<string, unknown>`, and an
 * `interface` has no implicit index signature — so an intersection of
 * interfaces is not assignable to it. Mapping produces a type alias, which is.
 */
export type StudioAgentDataParts = {
  [TName in keyof StudioAgentDataPartMap]: StudioAgentDataPartMap[TName];
};

/**
 * Per-message metadata.
 *
 * `Partial` of the agent's shape is the honest typing, not a loosening: the
 * agent stamps every run field on every assistant message, and a creator's
 * prompt has no run to name at the moment it is published — the run is minted
 * afterwards, by the workflow the prompt wakes. The three optional fields below
 * are the browser's own and the agent never sends them.
 */
export type StudioAgentMessageMetadata = Partial<StudioAgentUIMetadata> & {
  /** ISO timestamp, taken from the persisted row or minted at submit time. */
  createdAt?: string;
  format?: "plain_text" | "markdown";
  /** Idempotency key for a submission; also the message id. See the api client. */
  clientMessageId?: string;
  /** How a prompt sent into a live turn is meant to be delivered. */
  delivery?: StudioAgentInputDelivery;
};

export type StudioAgentUIMessage = UIMessage<
  StudioAgentMessageMetadata,
  StudioAgentDataParts,
  UITools
>;

export type StudioAgentUIPart = StudioAgentUIMessage["parts"][number];

type NarrowDataPart<TName extends keyof StudioAgentDataParts> = Extract<
  StudioAgentUIPart,
  { type: `data-${TName}` }
>;

/**
 * Narrow a part to one of our data parts.
 *
 * The type parameter is the guard: adding a member to `StudioAgentDataParts`
 * without teaching the projection about it is a compile error at the call site,
 * not a part that is silently dropped at runtime.
 */
export function isStudioAgentDataPart<TName extends keyof StudioAgentDataParts>(
  part: StudioAgentUIPart,
  name: TName
): part is NarrowDataPart<TName> {
  return part.type === `data-${name}`;
}

/**
 * The domain parts behind a published prompt.
 *
 * The invocation POST carries these alongside the channel copy — not a second
 * author, a second SINK: the channel answers "what is on screen" and
 * `StudioAgentMessage.parts` answers "what does the model see". The two are
 * built from one value here so they cannot say different things.
 */
export function toStudioAgentMessageParts(
  parts: readonly StudioAgentUIPart[]
): StudioAgentMessagePart[] {
  return parts.flatMap((part): StudioAgentMessagePart[] => {
    if (part.type === "text") {
      return [{ type: "text", format: "plain_text", text: part.text }];
    }
    if (isStudioAgentDataPart(part, "studio-agent-attachment")) {
      return [part.data];
    }
    return [];
  });
}

/**
 * The creator's approval answers, read back off the message they answered on.
 *
 * THE CONTINUATION IS INVISIBLE FROM THE COMPOSER, WHICH IS WHY THIS EXISTS.
 * `addToolApprovalResponse` rewrites a tool part to `approval-responded` and
 * `sendAutomaticallyWhen` then fires an ordinary `useChat` send — but that send
 * carries NO new message. The library recognises it (last message is an
 * assistant already in the tree), derives the `tool-approval-response` inputs
 * from the overlay-vs-tree difference, publishes them, and POSTs the invocation
 * with `newMessages` empty. So `prepareSendMessagesRequest` sees no outgoing
 * prompt and has to reconstruct what the creator just decided from the same
 * overlay the library read.
 *
 * Addressed by `toolCallId`, never by the AI SDK's `approval.id`: that id is
 * minted per-stream inside `streamText` and means nothing to Postgres, while
 * `toolCallId` is a column on `studio_agent_actions`. `runId` comes off the
 * assistant's metadata — the agent stamps it on every assistant message, and it
 * is the same run the library stamps as the continuation's `run-id` header.
 *
 * Returns null when the last assistant carries no answered approval, which is
 * how a continuation that is NOT an approval (there are none today) declines to
 * be mislabelled as one rather than being silently mis-routed.
 */
export function toStudioAgentToolApprovalInvocation(
  threadId: string,
  history: readonly StudioAgentUIMessage[]
): Omit<StudioAgentToolApprovalInvocationRequest, "inputEventId" | "sessionName"> | null {
  const assistant = history.findLast((message) => message.role === "assistant");
  const targetRunId = assistant?.metadata?.runId;
  if (!assistant || !targetRunId) {
    return null;
  }
  const decisions = assistant.parts.flatMap((part) =>
    isToolUIPart(part) && part.state === "approval-responded"
      ? [{ toolCallId: part.toolCallId, approved: part.approval.approved }]
      : []
  );
  if (decisions.length === 0) {
    return null;
  }
  return { kind: "tool_approval", threadId, targetRunId, decisions };
}

/** Build the attachment part the composer publishes with a prompt. */
export function studioAgentAttachmentPart(
  attachment: StudioAgentAttachment
): Extract<StudioAgentUIPart, { type: typeof STUDIO_AGENT_ATTACHMENT_DATA_PART }> {
  return {
    type: STUDIO_AGENT_ATTACHMENT_DATA_PART,
    id: attachment.attachmentId,
    data: attachment,
  };
}

/**
 * Compile-time proof that the two data-part constants still name the members of
 * {@link StudioAgentDataParts}.
 *
 * The constants are strings and the map is a type; without this a rename on
 * either side would go unnoticed until an activity row silently stopped
 * rendering in production.
 */
type AssertDataPartNames = [
  `data-${keyof StudioAgentDataParts & string}` extends
    | typeof STUDIO_AGENT_ACTIVITY_DATA_PART
    | typeof STUDIO_AGENT_FAILURE_DATA_PART
    | typeof STUDIO_AGENT_ATTACHMENT_DATA_PART
    ? true
    : never,
];
export type StudioAgentDataPartNamesAreExhaustive = AssertDataPartNames;
