import { z } from "zod";
import {
  StudioAgentIdSchema,
  StudioAgentInputDeliverySchema,
  StudioAgentMessagePartSchema,
  StudioAgentThreadScopeSchema,
  type StudioAgentActivityKind,
  type StudioAgentError,
  type StudioAgentRunKind,
} from "./studio-agent.js";

/**
 * The Studio Agent delivery contract, in one file.
 *
 * Delivery is `@ably/ai-transport` (pinned 0.6.0). Everything the browser
 * renders during a turn arrives on an Ably channel as Vercel AI SDK
 * `UIMessage` parts; PostgreSQL keeps the control plane of record — identity,
 * authorization, money, capability effects, and the model context that
 * `loadModelPlan` assembles. The two must never become two owners of one fact,
 * so this file names precisely what crosses the wire and nothing else does.
 *
 * There is exactly one publisher: the Temporal activity worker, inside an
 * `AgentSession`. Nest never publishes. That is the whole boundary, and
 * `studio-agent.publish-boundary.spec.ts` asserts it.
 */

/**
 * Ably reads everything before the first `:` as the channel NAMESPACE — the
 * unit channel rules attach to.
 *
 * OPERATOR PREREQUISITE. This namespace MUST carry `mutableMessages: true` in
 * every environment. AI Transport streams a token by APPENDING to an already
 * published message; without the rule the first append fails with Ably error
 * 93002 and no assistant text is ever delivered. Enabling it also forces
 * message persistence on the namespace, which Ably bills. Namespace matching is
 * by prefix up to the first colon, so `studio-agent` covers
 * `studio-agent:thread:<uuid>` and `studio` (or `studio-agents`) does not.
 */
export const STUDIO_AGENT_CHANNEL_NAMESPACE = "studio-agent" as const;

/**
 * One Ably channel per thread.
 *
 *  - Per THREAD, because an Ably capability is written against channel
 *    resources: a channel is the finest unit a token can be scoped to.
 *  - It starts with a letter. Ably parses a leading `[...]` as a channel
 *    qualifier (`[meta]`, `[?rewind=1]`), so a name that can never begin with a
 *    bracket can never be reinterpreted as a qualified channel.
 *
 * The thread id is a UUID, so the name is unguessable too — but that is a side
 * effect, not the boundary. The boundary is the capability.
 */
export const STUDIO_AGENT_THREAD_CHANNEL_PREFIX =
  `${STUDIO_AGENT_CHANNEL_NAMESPACE}:thread:` as const;

export function studioAgentThreadChannel(threadId: string): string {
  return `${STUDIO_AGENT_THREAD_CHANNEL_PREFIX}${threadId}`;
}

/**
 * The inverse, used by the invocation endpoint.
 *
 * An invocation body names its own channel (`sessionName`), and the client
 * publishes its input event to that channel BEFORE the server is asked to do
 * anything. So the server has to prove the channel it was handed is the one
 * belonging to the thread the caller authorized against — otherwise a caller
 * with access to thread A could name thread B's channel and have the agent
 * publish into it.
 *
 * Returns null for anything that is not a well-formed thread channel; callers
 * treat that as a rejected invocation, never as "close enough".
 */
export function studioAgentThreadIdFromChannel(channelName: string): string | null {
  if (!channelName.startsWith(STUDIO_AGENT_THREAD_CHANNEL_PREFIX)) {
    return null;
  }
  const threadId = channelName.slice(STUDIO_AGENT_THREAD_CHANNEL_PREFIX.length);
  return z.uuid().safeParse(threadId).success ? threadId : null;
}

/**
 * The capability minted for a browser, scoped to exactly one channel.
 *
 * `subscribe` reads the turn. `publish` is not optional: the client transport
 * puts the user's own input on the channel (`ai-input`) and its cancel
 * (`ai-cancel`) before any HTTP request is made — that is the library's
 * design, and without `publish` a turn cannot start. `history` backs
 * `view.loadOlder()`, which is how a reconnecting client walks back to the
 * seam with our snapshot.
 *
 * Nothing else. No `presence`, no `channel-metadata`, no `push-subscribe`, and
 * above all no wildcard resource: a static subscribe-only Ably key grants
 * `{"*": ["subscribe"]}`, i.e. every channel of every tenant with no way to
 * withdraw it from one user. That is the shape this list exists to refuse.
 */
export const STUDIO_AGENT_CLIENT_CHANNEL_CAPABILITY = ["subscribe", "publish", "history"] as const;

/**
 * Per-message metadata the agent stamps on every assistant message.
 *
 * It is the join key back to Postgres. `messageId` is deliberately absent —
 * the transport already carries the domain message id as `UIMessage.id`,
 * because the agent seeds `toUIMessageStream({ generateMessageId })` with the
 * `StudioAgentMessage.id` the control plane allocated. Keeping one id, not two,
 * is what lets a seeded client reconcile channel messages against snapshot rows
 * without a lookup table.
 */
export interface StudioAgentUIMetadata {
  threadId: string;
  runId: string;
  rootRunId: string;
  parentRunId: string | null;
  kind: StudioAgentRunKind;
}

/**
 * A unit of agent work, rendered beside the answer it belongs to.
 *
 * One part per activity, re-sent under the same `activityId` as it advances:
 * the AI SDK reconciles a `data-*` part by its `id`, so a completion REPLACES
 * the running row rather than appending a second one. That is why five durable
 * event types (`activity.started|progress|completed|failed|cancelled`) collapse
 * into one wire shape with a status — the log keeps the five facts, the screen
 * only ever wanted the latest.
 *
 * `label` is a semantic key (`studio_agent.activity.generating_response`), not
 * a sentence. Each host localizes it at render time instead of freezing
 * whichever locale happened to execute the workflow.
 */
export interface StudioAgentActivityPart {
  activityId: string;
  kind: StudioAgentActivityKind;
  label: string;
  status: "running" | "succeeded" | "failed" | "cancelled";
  detail: string | null;
  progress: number | null;
  /** ISO-8601 with offset. */
  startedAt: string;
  completedAt: string | null;
}

/**
 * The turn's rich failure, carried beside the coarse one.
 *
 * `Ably.ErrorInfo` — what `ai-run-end` stamps — is `{code: number, message}`.
 * Our failure surface distinguishes `studio_agent.invalid_action_input` from
 * `studio_agent.capability_result_invalid` by a STRING code and renders
 * `details.issues` paths. Neither survives the numeric code, so the honest
 * error travels as its own part and the run terminal keeps the coarse one for
 * anything reading the lifecycle generically.
 */
export interface StudioAgentFailurePart {
  runId: string;
  error: StudioAgentError;
  /** ISO-8601 with offset. */
  failedAt: string;
}

/**
 * The complete set of custom data parts on this wire.
 *
 * Structurally `AI.UIDataTypes` (`Record<string, unknown>`), asserted where
 * `ai` is a dependency; this package stays dependency-free apart from zod so
 * every consumer — Nest, the Temporal worker, the browser — can import the
 * contract without pulling an AI SDK in.
 *
 * WHAT IS DELIBERATELY NOT HERE. Approvals, delegated task runs and change
 * sets have no wire shape. They are written by transactions the agent run does
 * not own (the control plane authorizes an approval; a child workflow owns its
 * own run), so no `AgentRun` is in scope to publish them and inventing a second
 * pipe for them is the thing this refactor deletes. They stay Postgres facts,
 * read over `GET threads/:id/snapshot`. The channel tells a client WHEN to look
 * (the run stops producing output and its lifecycle moves); Postgres says what
 * happened.
 */
export interface StudioAgentUIDataParts {
  "studio-agent-activity": StudioAgentActivityPart;
  "studio-agent-failure": StudioAgentFailurePart;
}

export const STUDIO_AGENT_ACTIVITY_DATA_PART = "data-studio-agent-activity" as const;
export const STUDIO_AGENT_FAILURE_DATA_PART = "data-studio-agent-failure" as const;

/**
 * The body the client transport POSTs to wake a turn.
 *
 * `inputEventId` and `sessionName` are `@ably/ai-transport`'s own
 * `InvocationData` — the two fields an agent needs out of band before the
 * channel is observable. Everything after them is ours, and it is what the
 * control plane authorizes: `POST /aurora/studio-agent/invocations` runs the
 * same ownership, scope, quota and one-active-run checks the message endpoint
 * always ran.
 *
 * THE TRAP, WRITTEN DOWN. The library publishes `ai-input` and only THEN issues
 * this request, fire-and-forget. Every refusal below therefore refuses a
 * message that is already on the channel and already on every subscriber's
 * screen. The Ably capability is the first gate — a token is minted for one
 * thread, so a caller cannot even address another thread's channel — and this
 * endpoint is the second. A rejection surfaces to the client through the
 * session's error emitter, and the UI must mark that message failed rather than
 * leave it looking committed.
 *
 * WHY `parts` TRAVELS HERE TOO, when the same text is already on the channel.
 * It is not a second author — the client authored it once — it is a second
 * SINK, and the two sinks answer different questions. The channel answers "what
 * is on screen"; `StudioAgentMessage.parts` answers "what does the model see",
 * and `loadModelContext` assembles that from checkpoints, task boundaries,
 * artifact dereferences, a delivered-input retention rule and a byte budget —
 * none of which `run.view` can express. The alternative is the worker reading
 * the trigger off `run.view` and mirroring it into Postgres before
 * `loadModelPlan`: a new must-not-fail ordered write, on the retry path, for no
 * gain. `inputEventId` is the join between the two sinks; attachments are bound
 * from these parts in the same transaction, which the channel copy cannot do.
 */
const StudioAgentInvocationPointerSchema = z.object({
  /** Ably `event-id` of the `ai-input` the client already published. */
  inputEventId: z.string().trim().min(1).max(200),
  /** The channel the client published to — `Invocation.sessionName`. */
  sessionName: z.string().trim().min(1).max(200),
  threadId: StudioAgentIdSchema,
});

export const StudioAgentSubmissionInvocationRequestSchema =
  StudioAgentInvocationPointerSchema.extend({
    kind: z.literal("submission"),
    /** Idempotency key for the submission, minted by the client. */
    clientMessageId: StudioAgentIdSchema,
    parts: z.array(StudioAgentMessagePartSchema).min(1).max(128),
    /** Run to steer / enqueue against; null starts a new root turn. */
    targetRunId: StudioAgentIdSchema.nullable(),
    /** Required exactly when {@link StudioAgentSubmissionInvocationRequestSchema.shape.targetRunId} is set. */
    delivery: StudioAgentInputDeliverySchema.nullable(),
    scope: StudioAgentThreadScopeSchema,
    locale: z.string().trim().min(2).max(32),
  })
    .strict()
    .superRefine((request, context) => {
      if ((request.targetRunId === null) !== (request.delivery === null)) {
        context.addIssue({
          code: "custom",
          message: "targetRunId and delivery must either both be present or both be null.",
          path: ["delivery"],
        });
      }
    });

/**
 * The creator's answer to a suspended turn, addressed by TOOL CALL.
 *
 * This is the same POST, because it is the same library call path: `useChat`'s
 * continuation goes through `ChatTransport.sendMessages`, which publishes the
 * `tool-approval-response` inputs on the channel and then wakes the agent with
 * exactly one invocation. There is no second endpoint and no second
 * authorization path — inventing one is what the hand-rolled
 * `POST .../approvals/:id/resolve` did, and it is gone.
 *
 * `toolCallId` is the addressing key rather than our `approvalId` because the
 * browser never sees an approvalId that means anything to Postgres: the AI SDK
 * mints its own `approval.id` for the UI part, while the durable
 * `StudioAgentApproval` row is keyed to the ACTION, which is keyed to the tool
 * call. The tool call id is the one identifier both stores share (it is the
 * `toolCallId` column on `studio_agent_actions`), so the server resolves
 * `(runId, toolCallId) -> action -> approval` and the browser never has to
 * learn a second id.
 *
 * `targetRunId` is the run being resumed, taken from the assistant message's
 * metadata. It is a CLAIM from the browser, and the server does not compare it
 * against the `run-id` header the library stamps on the continuation — that
 * header travels on the Ably message, not in this body, so checking it would
 * cost a channel read per decision.
 *
 * What is guaranteed instead is narrower and structural: the server resolves
 * each `toolCallId` with the run in the `where` clause, so a decision can only
 * ever reach an action belonging to the run this request named. A stale overlay
 * cannot approve a tool call from an unrelated turn — it 404s. The unverified
 * residue is whether the library's channel-side resume targets the same run;
 * a disagreement there would be visible as a turn whose reply attaches to the
 * wrong run, not as a wrong write.
 */
export const StudioAgentToolApprovalInvocationRequestSchema =
  StudioAgentInvocationPointerSchema.extend({
    kind: z.literal("tool_approval"),
    targetRunId: StudioAgentIdSchema,
    decisions: z
      .array(
        z
          .object({
            toolCallId: z.string().trim().min(1).max(512),
            approved: z.boolean(),
          })
          .strict()
      )
      .min(1)
      .max(128),
  })
    .strict()
    .superRefine((request, context) => {
      const seen = new Set(request.decisions.map((entry) => entry.toolCallId));
      if (seen.size !== request.decisions.length) {
        context.addIssue({
          code: "custom",
          message: "A tool-approval invocation must answer each tool call at most once.",
          path: ["decisions"],
        });
      }
    });

export const StudioAgentInvocationRequestSchema = z.discriminatedUnion("kind", [
  StudioAgentSubmissionInvocationRequestSchema,
  StudioAgentToolApprovalInvocationRequestSchema,
]);

export type StudioAgentSubmissionInvocationRequest = z.infer<
  typeof StudioAgentSubmissionInvocationRequestSchema
>;
export type StudioAgentToolApprovalInvocationRequest = z.infer<
  typeof StudioAgentToolApprovalInvocationRequestSchema
>;
export type StudioAgentInvocationRequest = z.infer<typeof StudioAgentInvocationRequestSchema>;

/**
 * The acknowledgement. Small on purpose.
 *
 * `ClientView.send()` issues the POST fire-and-forget and does not read this
 * body — a rejection reaches the client through the session's error emitter,
 * not through a response the transport discards. So this exists for our own
 * tooling and tests, and it says only which durable rows the command produced:
 * `runId` for a new root turn, `inputId` for a steer / enqueue against a live
 * one, never both.
 */
export const StudioAgentInvocationResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("submission"),
      threadId: StudioAgentIdSchema,
      messageId: StudioAgentIdSchema,
      runId: StudioAgentIdSchema.nullable(),
      inputId: StudioAgentIdSchema.nullable(),
      channelName: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("tool_approval"),
      threadId: StudioAgentIdSchema,
      /** The suspended run these decisions resume. */
      runId: StudioAgentIdSchema,
      /** The durable approval rows the decisions committed, in request order. */
      approvalIds: z.array(StudioAgentIdSchema).min(1).max(128),
      channelName: z.string().trim().min(1),
    })
    .strict(),
]);

export type StudioAgentInvocationResult = z.infer<typeof StudioAgentInvocationResultSchema>;
