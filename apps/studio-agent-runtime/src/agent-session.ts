import {
  STUDIO_AGENT_ACTIVITY_DATA_PART,
  STUDIO_AGENT_FAILURE_DATA_PART,
  type StudioAgentActivityPart,
  type StudioAgentFailurePart,
  type StudioAgentUIDataParts,
  type StudioAgentUIMetadata,
} from "@repo/shared/studio-agent-transport";
import { ErrorCode, errorInfoIs, Invocation } from "@ably/ai-transport";
import { createAgentSession } from "@ably/ai-transport/vercel";
import * as Ably from "ably";
import type * as AI from "ai";
import type { RuntimeDeliveryConfig } from "./config.js";

/**
 * THE ONLY MODULE IN THIS REPO THAT MAY PUBLISH A STUDIO AGENT MESSAGE.
 *
 * Delivery is `@ably/ai-transport`: the Temporal activity worker opens an
 * `AgentSession` on the thread's channel and streams the turn straight onto it.
 * Nest publishes nothing — it holds no run, and a second publisher is exactly
 * the hand-rolled relay this refactor deleted.
 *
 * WHY THE WORKER AND NOT THE CONTROL PLANE. The canonical example in Ably's
 * docs is a Next.js route that detaches the work with `after()`. Temporal IS
 * our `after()`: the run's open / step / close are three retryable activities
 * under one stable `runId`, which is precisely the multi-process lifecycle
 * `RunRuntime.runId` documents. Nothing here may import `next/server`.
 *
 * ROOT KEY HANDLING. `ABLY_API_KEY` is a ROOT credential — capability
 * `{"[*]*":["*"]}` over every channel of the app. It is used for one thing,
 * this connection, and it never leaves the process: it is passed to
 * `Ably.Realtime` and read nowhere else, and no log line here formats the
 * config. The browser never sees it; it gets a per-thread token minted by the
 * Nest token endpoint. Ably's own errors ARE logged in full — see
 * {@link describeAblyError} for why suppressing them was a mistake.
 */

/** The Vercel codec's message type, with our metadata and data parts bound. */
export type StudioAgentUIMessage = AI.UIMessage<
  StudioAgentUIMetadata,
  StudioAgentUIDataParts & AI.UIDataTypes
>;

/** What a step pipes: UIMessage chunks and nothing else. */
export type StudioAgentUIChunk = AI.InferUIMessageChunk<StudioAgentUIMessage>;

export type StudioAgentAgentSession = ReturnType<
  typeof createAgentSession<StudioAgentUIMetadata, StudioAgentUIDataParts & AI.UIDataTypes>
>;

export interface StudioAgentDeliveryClient {
  session(channelName: string): Promise<StudioAgentAgentSession>;
  /**
   * How many times this channel has lost message continuity.
   *
   * WHY A COUNTER AND NOT A BOOLEAN. A run's `abortSignal` fires for two
   * completely different reasons, and the signal itself cannot tell them
   * apart: the creator pressed stop, or the channel lost continuity and the
   * library aborted every registered run on it
   * (`agent-session.ts _handleChannelStateChange`: "Abort every active run's
   * controller FIRST"). Reporting the second as the first would tell a creator
   * they cancelled a turn they were waiting on, and would suppress the error
   * they need to see. An activity samples this before its work and again on
   * the failure path; a change means the abort was the transport's, not the
   * creator's.
   */
  continuityGeneration(channelName: string): number;
  close(): void;
}

/**
 * One Ably connection per worker process, shared by every concurrent activity.
 *
 * Sessions are per channel and cached for the process lifetime: a session owns
 * its channel, and resolving the same channel twice with conflicting options is
 * documented as unsupported. `connect()` is idempotent from the caller's point
 * of view because the promise itself is cached — two activities on the same
 * thread await one attach, not two.
 */
export function createStudioAgentDeliveryClient(
  config: RuntimeDeliveryConfig,
  log: (message: string) => void
): StudioAgentDeliveryClient {
  const client = new Ably.Realtime({
    key: config.ablyApiKey,
    // ECHO STAYS ON, AND IT IS NOT AN OVERSIGHT.
    //
    // The obvious saving is to turn it off — "the worker only publishes, so why
    // hand every chunk back to a subscriber that does not exist in this
    // process". We shipped that, and it makes the second activity of every turn
    // fail. The library's session is not a bystander to its own writes: it
    // subscribes unfiltered and folds EVERY channel message into its Tree, and
    // `adoptRun().load()` waits for this run's `ai-run-start` to be observed
    // there before it will adopt. With echo off the worker never sees the
    // `ai-run-start` it published itself, and the session's history hydrator —
    // shared across every view on the channel, and exhausted by `openAgentRun`'s
    // drain moments earlier — has nothing left to page. `load()` then waits out
    // its whole timeout and fails `InputEventNotFound`.
    //
    // Measured against the real service on one shared session, which is what a
    // worker process has (see the `sessions` cache below): echo off ->
    // `load()` fails 104010/504 after the full timeout; echo on -> the run
    // adopts, streams, cancels and closes, channel reading
    // `ai-input, ai-run-start, ai-step-start, ai-cancel, ai-step-end,
    // ai-run-end`. Ably's own documented server shape constructs a plain
    // `new Ably.Realtime({ key })`, i.e. echo on, for exactly this reason.
    echoMessages: true,
  });
  client.connection.on("failed", (change) => {
    log(`Studio Agent Ably connection failed (${describeAblyError(change.reason)}).`);
  });
  const sessions = new Map<string, Promise<StudioAgentAgentSession>>();
  const continuityGenerations = new Map<string, number>();
  return {
    continuityGeneration: (channelName) => continuityGenerations.get(channelName) ?? 0,
    async session(channelName) {
      const cached = sessions.get(channelName);
      if (cached) {
        return cached;
      }
      const opening: Promise<StudioAgentAgentSession> = (async () => {
        const session = createAgentSession<
          StudioAgentUIMetadata,
          StudioAgentUIDataParts & AI.UIDataTypes
        >({ client, channelName });
        // Session-level errors are not scoped to any run: channel continuity
        // loss (a re-attach with `resumed: false`, code 80023), a failed cancel
        // listener, an attach failure. The library reacts by aborting every
        // registered run on this channel, which the worker then reports as a
        // string of unexplained turn failures — so the one line that says WHY
        // has to be emitted here or the cause is unrecoverable.
        session.on("error", (error) => {
          if (errorInfoIs(error, ErrorCode.ChannelContinuityLost)) {
            continuityGenerations.set(
              channelName,
              (continuityGenerations.get(channelName) ?? 0) + 1
            );
            // A SESSION THAT LOST CONTINUITY MUST NOT STAY IN THE CACHE.
            //
            // The library's own handler has already aborted every registered
            // run on this channel and swapped the Tree out from under them
            // (`agent-session.ts _handleChannelStateChange`). What it does NOT
            // do is forget the run registrations, and what THIS cache did not do
            // is forget the session — so every later activity on the thread kept
            // being handed the same object, with a fresh empty Tree and a
            // registry full of dead runs. `adoptRun().load()` on it waits out
            // its whole visibility timeout for an `ai-run-start` the new Tree
            // has never seen, and the turn fails for a reason that reads like a
            // transport bug rather than a dropped websocket.
            //
            // Evicting it makes the next activity attach a fresh session, which
            // pages the channel's history and therefore CAN see the run. The
            // stale one is `detach()`ed, not `end()`ed, deliberately: `end()`
            // publishes `ai-run-end{cancelled}` for every open run it owns,
            // which would terminate a turn Temporal is about to retry
            // successfully and tell the creator they cancelled something they
            // did not. `detach()` publishes no terminal — the workflow's own
            // non-cancellable `closeAgentRun` is the single author of that — and
            // is documented idempotent and best-effort.
            //
            // Guarded on identity so a loss reported late cannot evict a
            // successor session that has already replaced this one; two live
            // sessions on one channel is the unsupported state, and the eviction
            // must never create it.
            if (sessions.get(channelName) === opening) {
              sessions.delete(channelName);
            }
            void session.detach().catch((cause: unknown) => {
              log(
                `Studio Agent Ably session detach after continuity loss on ${channelName} failed (${
                  cause instanceof Ably.ErrorInfo
                    ? describeAblyError(cause)
                    : cause instanceof Error
                      ? cause.message
                      : String(cause)
                }).`
              );
            });
          }
          log(`Studio Agent Ably session error on ${channelName} (${describeAblyError(error)}).`);
        });
        await session.connect();
        return session;
      })();
      sessions.set(channelName, opening);
      try {
        return await opening;
      } catch (error) {
        // A failed attach must not poison the channel forever: the next
        // activity attempt re-attaches. Temporal is the retry engine.
        sessions.delete(channelName);
        throw error;
      }
    },
    close() {
      sessions.clear();
      client.close();
    },
  };
}

export function studioAgentInvocation(inputEventId: string, channelName: string): Invocation {
  return Invocation.fromJSON({ inputEventId, sessionName: channelName });
}

/**
 * An Ably error as a log line — CODE AND MESSAGE.
 *
 * This used to print the numeric code alone, on the theory that a provider's
 * free text is not somewhere to risk a credential's neighbourhood. That theory
 * cost a four-minute production outage most of a day: the worker logged
 * `{"code":40033,"statusCode":400}` and the sentence that actually named the
 * fault — "unable to look up input event; run ... was cancelled" — existed only
 * inside Temporal's workflow history. The code is a class of problem; the
 * message is the problem. Neither the key nor any token is ever an input to an
 * ErrorInfo the library raises, and `ABLY_API_KEY` is never passed anywhere
 * that formats it, so the risk being guarded against was hypothetical and the
 * cost of the guard was not.
 *
 * Truncated because an ErrorInfo can carry a whole response body, and a log
 * line is not a place to discover that.
 */
export function describeAblyError(error: Ably.ErrorInfo | null | undefined): string {
  if (!error) {
    return "code=unknown status=unknown message=none";
  }
  const message = (error.message ?? "").trim();
  return [
    `code=${error.code ?? "unknown"}`,
    `status=${error.statusCode ?? "unknown"}`,
    `message=${message.length === 0 ? "none" : message.slice(0, 1_000)}`,
  ].join(" ");
}

/**
 * A data part, shaped as the single UIMessage chunk that carries it.
 *
 * `id` is the reconciliation key: the AI SDK replaces a `data-*` part that
 * arrives again under the same id rather than appending a second one, which is
 * what lets one activity row move `running -> succeeded` on screen instead of
 * stacking five events.
 */
export function activityChunk(part: StudioAgentActivityPart): StudioAgentUIChunk {
  return {
    type: STUDIO_AGENT_ACTIVITY_DATA_PART,
    id: part.activityId,
    data: part,
  } as StudioAgentUIChunk;
}

export function failureChunk(part: StudioAgentFailurePart): StudioAgentUIChunk {
  return {
    type: STUDIO_AGENT_FAILURE_DATA_PART,
    id: `${part.runId}:failure`,
    data: part,
  } as StudioAgentUIChunk;
}
