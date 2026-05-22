/**
 * Consumes the Mastra SSE stream server-side, rebuilds full assistant
 * messages from UIMessageChunks, and writes them to the Redis-backed
 * MessageStoreService. Runs as a fire-and-forget background task alongside
 * the SSE-to-client pipe — the two readers tee() a shared upstream response.
 *
 * Currently a passive mirror: the web client still consumes SSE directly,
 * but any connected ChatEventsGateway WS client also sees live updates
 * pulled via the get-messages endpoint. Once the web client switches to
 * the WS+pull model (Stage C), the SSE pipe can be dropped and this becomes
 * the sole writer.
 */
import { Injectable, Logger } from '@nestjs/common';
import {
  readUIMessageStream,
  uiMessageChunkSchema,
  type UIMessageChunk,
} from 'ai';
import { parseJsonEventStream } from '@ai-sdk/provider-utils';
import {
  MessageStoreService,
  type StoredMessage,
  type ChatAgentState,
} from './message-store.service';
import { AgentStateService } from './agent-state.service';

/**
 * Redis checkpoint interval during streaming. We publish a text-delta chunk
 * per iteration (pub/sub only, no Redis write) so live WS clients append
 * tokens in real time, and only snapshot the full blob to Redis every
 * CHECKPOINT_MS — that way a mid-stream reconnect gets a "close enough"
 * blob instead of an empty seed, without paying one Redis SET per token.
 */
const CHECKPOINT_MS = 1500;

/**
 * Strip the end-of-turn markers the LLM sometimes leaks into user-visible
 * text. The supervisor prompt bans them explicitly (see prompts/storyos.ts)
 * but DeepSeek still emits them occasionally, so we clean up server-side
 * as a safety net.
 *
 * Matches — trailing-only — any combination of:
 *   (结束) （结束） [END] [DONE] <END> <DONE> [结束] 【结束】
 * with optional surrounding whitespace/newlines.
 */
const END_MARKER_REGEX =
  /\s*(?:[（(\[【<]\s*(?:结束|END|DONE)\s*[)）\]】>])\s*$/gi;

/**
 * Strip the system-injection XML tags that Nest inlines into user messages
 * (see mastra-proxy.controller button-driven markers). These are supposed
 * to be invisible metadata for the LLM — supervisor prompt explicitly bans
 * echoing them, but DeepSeek occasionally echoes the whole user message
 * including the tag. Scrub anywhere in the text.
 *
 * Matches the tags we currently inject:
 *   <FORCE_WORKFLOW ... />
 *   <CONFIRM_WORKFLOW ... />
 *   <PROJECT_PARAMS_CONFIRMED ... />
 * (and a generic fallback for future tags that follow the same shape).
 */
const INJECTED_TAG_REGEX =
  /\s*<(?:FORCE_WORKFLOW|CONFIRM_WORKFLOW|PROJECT_PARAMS_CONFIRMED)\b[^>]*\/?>\s*/g;

function stripEndMarkers(text: string): string {
  if (!text) return text;
  let out = text;
  let prev: string;
  do {
    prev = out;
    out = out.replace(END_MARKER_REGEX, '');
  } while (out !== prev);
  return out;
}

function stripInjectedTags(text: string): string {
  if (!text) return text;
  return text.replace(INJECTED_TAG_REGEX, '');
}

/**
 * A lightweight view of the text content of an in-progress message — used
 * by the streaming loop to compute per-token deltas cheaply without
 * deep-diffing the full parts array each iteration.
 */
interface TextSnapshot {
  partIndex: number;
  text: string;
}

/**
 * Project a message down to its text parts, preserving the part index so
 * later diffs can emit `publishChunk(partIndex, append)` against the
 * correct slot in the client's in-memory copy.
 */
function snapshotTextParts(message: StoredMessage): TextSnapshot[] {
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return [];
  const out: TextSnapshot[] = [];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i] as { type?: unknown; text?: unknown } | null;
    if (!part || typeof part !== 'object') continue;
    if (part.type === 'text' && typeof part.text === 'string') {
      out.push({ partIndex: i, text: part.text });
    }
  }
  return out;
}

/**
 * Cheap fingerprint of a message's structural shape — captures each part's
 * type + state + toolCallId. Text body (which mutates per-token) is
 * intentionally omitted; text deltas are emitted separately via
 * publishChunk. When this fingerprint changes between iterations, the
 * client needs the fresh full blob (a tool part went from `input-streaming`
 * to `input-available`, a new tool output arrived, etc.) — without this
 * signal, the frontend's tool-card routing gets stuck on a stale state.
 */
function structuralFingerprint(message: StoredMessage): string {
  const parts = (message as { parts?: unknown }).parts;
  if (!Array.isArray(parts)) return '';
  const tokens: string[] = [];
  for (const raw of parts) {
    const part = raw as {
      type?: unknown;
      state?: unknown;
      toolCallId?: unknown;
    } | null;
    if (!part || typeof part !== 'object') {
      tokens.push('?');
      continue;
    }
    const type = typeof part.type === 'string' ? part.type : '?';
    const state = typeof part.state === 'string' ? part.state : '-';
    const tcid = typeof part.toolCallId === 'string' ? part.toolCallId : '';
    tokens.push(`${type}:${state}:${tcid}`);
  }
  return tokens.join('|');
}

/**
 * True when the message carries at least one part that's worth showing in
 * the UI. A "shell" message (parts empty, or parts contain only empty
 * text entries) counts as unusable and triggers the fallback bubble —
 * prevents silent empty bubbles when the supervisor throws right after
 * emitting the start chunk but before any real content.
 */
function hasUsableContent(message: StoredMessage | null): boolean {
  if (!message) return false;
  const parts = message.parts;
  if (!Array.isArray(parts) || parts.length === 0) return false;
  for (const raw of parts) {
    if (!raw || typeof raw !== 'object') continue;
    const part = raw as { type?: unknown; text?: unknown };
    if (part.type === 'text') {
      if (typeof part.text === 'string' && part.text.trim().length > 0) {
        return true;
      }
      continue;
    }
    // Any non-text part (tool call / invocation / reasoning / etc.)
    // is meaningful content.
    return true;
  }
  return false;
}

function sanitizeMessage(message: StoredMessage): StoredMessage {
  const parts = message.parts;
  if (!Array.isArray(parts)) return message;
  const cleaned = parts
    .map((part) => {
      if (!part || typeof part !== 'object') return part;
      const p = part as { type?: unknown; text?: unknown };
      if (p.type === 'text' && typeof p.text === 'string') {
        const next = stripEndMarkers(stripInjectedTags(p.text));
        return { ...p, text: next };
      }
      return part;
    })
    // Drop any text part that became empty after scrubbing — otherwise
    // you get a lone whitespace bubble when the LLM echoed ONLY the tag.
    .filter((part) => {
      if (!part || typeof part !== 'object') return true;
      const p = part as { type?: unknown; text?: unknown };
      if (p.type === 'text') {
        return typeof p.text === 'string' && p.text.trim().length > 0;
      }
      return true;
    });
  return { ...message, parts: cleaned };
}

function toChunkStream(
  stream: ReadableStream<Uint8Array>,
): ReadableStream<UIMessageChunk> {
  const parsed = parseJsonEventStream({ stream, schema: uiMessageChunkSchema });
  return new ReadableStream<UIMessageChunk>({
    async start(controller) {
      const reader = parsed.getReader();
      const log = new Logger(AgentStreamService.name);
      let droppedCount = 0;
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            if (droppedCount > 0) {
              log.warn(
                `toChunkStream: dropped ${droppedCount} malformed chunks`,
              );
            }
            controller.close();
            return;
          }
          if (value.success) {
            controller.enqueue(value.value);
          } else {
            // Don't abort — Mastra might emit a chunk type our ai-sdk version
            // doesn't recognize (or vice-versa). Log once, keep the stream
            // alive so the rest of the turn still lands in Redis.
            droppedCount += 1;
            if (droppedCount <= 3) {
              log.warn(
                `toChunkStream: schema rejected chunk (#${droppedCount}): ${
                  value.error instanceof Error
                    ? value.error.message.slice(0, 240)
                    : String(value.error).slice(0, 240)
                }`,
              );
            }
          }
        }
      } catch (err) {
        controller.error(err);
      }
    },
  });
}

@Injectable()
export class AgentStreamService {
  private readonly logger = new Logger(AgentStreamService.name);

  constructor(
    private readonly store: MessageStoreService,
    private readonly agentState: AgentStateService,
  ) {}

  /**
   * Consume the Mastra SSE bytes, stream text-delta chunks to connected WS
   * clients, and persist the final assistant message to Redis when the
   * stream ends. Two signal channels flow out of this:
   *
   *   1. `message_added`      — first snapshot lands (id registered, empty
   *                             or seed-content blob in Redis)
   *   2. `message_chunk`      — per text-delta, pub/sub only (no Redis)
   *   3. `message_updated`    — fires for NON-text structural changes
   *                             (e.g. a new tool part appearing), plus
   *                             debounced checkpoints so reconnect works
   *   4. `message_finalize`   — terminal blob + "streaming done" signal
   *
   * Clients drop the REST get-messages round-trip for text streaming and
   * append deltas directly to their in-memory copy; non-text changes
   * still fall back to the old fetch-on-updated pattern.
   */
  async consume(opts: {
    projectId: string;
    seedMessage: StoredMessage;
    rawStream: ReadableStream<Uint8Array>;
    /**
     * Optional abort controller for upstream cancellation. Currently only
     * the 10-min hard timeout in mastra-proxy.controller wires this. Kept
     * as a parameter so future improvements (e.g. user-initiated cancel)
     * have a hook.
     *
     * Idle-timeout-based aborts have been removed — see consume()'s
     * implementation comment for the full reasoning. TL;DR: supervisor
     * goes silent during ask_persona tool execution (80-180s each), so
     * any idle threshold either false-aborts legitimate work or is so
     * long it's useless.
     */
    abortController?: AbortController;
  }): Promise<void> {
    const {
      projectId,
      seedMessage,
      rawStream,
      abortController: _abortController, // reserved for future use (user cancel)
    } = opts;
    const chunkStream = toChunkStream(rawStream);
    const seedId = seedMessage.id;
    void _abortController; // suppress unused warning until cancel path lands

    // ── Lock heartbeat ────────────────────────────────────────────────────
    // Refresh the agent_state Redis key's TTL every 30s so a legitimately
    // long supervisor turn (chain of 5-8 persona calls, can run 5-8 min)
    // doesn't lose its lock to the now-shorter 15-min TTL (was 1 day, see
    // agent-state.service.ts). The TTL is the failsafe against truly stuck
    // locks; the heartbeat is what lets live runs keep going past 15 min.
    const heartbeatTimer = setInterval(() => {
      void this.agentState.touch(projectId);
    }, 30_000);

    // Sweep any stuck tool parts left behind by a prior agent run that
    // died mid-execution (process kill / fatal exception / SSE
    // interrupt). Without this, every refresh re-renders that orphan
    // part as a perpetual "Consulting…" indicator. We mark them as
    // output-error so the UI shows the soft "hiccup" state instead.
    await this.markStuckToolPartsInterrupted(projectId).catch((err) => {
      this.logger.warn(
        `markStuckToolPartsInterrupted project=${projectId} failed: ${err instanceof Error ? err.message : err}`,
      );
    });

    await this.store.setAgentState(projectId, 'running').catch((err) => {
      this.logger.warn(
        `setAgentState(running) project=${projectId} failed: ${err instanceof Error ? err.message : err}`,
      );
    });

    let lastMessage: StoredMessage | null = null;
    let previousParts: TextSnapshot[] = []; // by part index, text-only
    let previousFingerprint = '';
    let lastCheckpoint = 0;
    let iterations = 0;
    let addedSeed = false;

    try {
      for await (const message of readUIMessageStream({
        message: seedMessage as unknown as Parameters<
          typeof readUIMessageStream
        >[0]['message'],
        stream: chunkStream,
      })) {
        iterations += 1;
        // readUIMessageStream's `start` chunk overwrites `message.id` with
        // Mastra's own id. Force it back to the seed so the id we handed
        // to the client stays the canonical key in Redis and on the WS.
        const sanitized = sanitizeMessage(message as unknown as StoredMessage);
        lastMessage = { ...sanitized, id: seedId } as StoredMessage;

        if (!addedSeed) {
          // First real snapshot — addMessage so WS subscribers get
          // `message_added` and the conversation list includes the id.
          await this.store.addMessage(projectId, lastMessage);
          addedSeed = true;
          previousParts = snapshotTextParts(lastMessage);
          previousFingerprint = structuralFingerprint(lastMessage);
          lastCheckpoint = Date.now();
          continue;
        }

        const currentParts = snapshotTextParts(lastMessage);
        const currentFingerprint = structuralFingerprint(lastMessage);

        // 1) Emit text-delta chunks for every text part whose text grew.
        //    This is the fast path — pub/sub only, no Redis.
        for (let i = 0; i < currentParts.length; i++) {
          const prev = previousParts[i];
          const curr = currentParts[i];
          if (!curr) continue;
          const prevText = prev?.text ?? '';
          // Same part index, text strictly extended — send the tail.
          if (
            prev &&
            prev.partIndex === curr.partIndex &&
            curr.text.startsWith(prevText) &&
            curr.text.length > prevText.length
          ) {
            const append = curr.text.slice(prevText.length);
            await this.store.publishChunk(
              projectId,
              seedId,
              curr.partIndex,
              append,
            );
          } else if (!prev || prev.partIndex !== curr.partIndex) {
            // New text part appeared (e.g. after a tool call) — emit the
            // whole current text as one chunk so the client can attach to
            // the right partIndex.
            if (curr.text.length > 0) {
              await this.store.publishChunk(
                projectId,
                seedId,
                curr.partIndex,
                curr.text,
              );
            }
          }
          // (text got shorter / rewritten backwards is ignored here; the
          // checkpoint/finalize snapshots will reconcile on the client.)
        }

        // 2) Detect ANY structural change (new part, part state transition
        //    like input-streaming → input-available, tool output landing)
        //    and publish the full blob so client-side tool-card routing
        //    reads a fresh state. Without this, require_project_params
        //    stays stuck at "input-streaming" until the stream ends, and
        //    the params form only appears after a full page reload.
        const structuralChange = currentFingerprint !== previousFingerprint;
        if (structuralChange) {
          await this.store.updateMessage(projectId, lastMessage);
        }

        // 3) Periodic Redis checkpoint (no publish) for reconnect safety.
        const now = Date.now();
        if (!structuralChange && now - lastCheckpoint >= CHECKPOINT_MS) {
          await this.store.checkpointMessage(projectId, lastMessage);
          lastCheckpoint = now;
        }

        previousParts = currentParts;
        previousFingerprint = currentFingerprint;
      }

      // Final flush — write the terminal blob and publish `message_finalize`
      // so the client can settle the streaming state (drop the caret etc).
      //
      // Three outcomes to distinguish:
      //   (a) Real content arrived (text or tool call) → finalize as-is
      //   (b) No message ever yielded (!addedSeed && !lastMessage) → fallback
      //   (c) A shell message yielded but it ended up empty (parts=[] after
      //       sanitization, or parts only contain empty-text placeholders) —
      //       happens when Mastra emits a start-chunk and then the supervisor
      //       throws before any real chunk lands. Without (c) the user sees
      //       a silent empty bubble.
      const emptyShellLanded = !!lastMessage && !hasUsableContent(lastMessage);
      const shouldFallback = !lastMessage ? !addedSeed : emptyShellLanded;

      if (shouldFallback) {
        const fallback: StoredMessage = {
          id: seedId,
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: 'Let me reorganize my thoughts — please try again in a moment.',
            },
          ],
        };
        if (!addedSeed) {
          await this.store.addMessage(projectId, fallback).catch(() => {});
        } else {
          // Shell was already addMessage'd with empty parts — swap content
          // via updateMessage so WS subscribers see the new text.
          await this.store.updateMessage(projectId, fallback).catch(() => {});
        }
        await this.store.finalizeMessage(projectId, fallback).catch(() => {});
        this.logger.warn(
          `consume produced no content project=${projectId} — emitted fallback bubble`,
        );
      } else if (lastMessage) {
        if (!addedSeed) await this.store.addMessage(projectId, lastMessage);
        await this.store.finalizeMessage(projectId, lastMessage);
      }

      const partCount = Array.isArray(lastMessage?.parts)
        ? lastMessage.parts.length
        : 0;
      this.logger.log(
        `consume done project=${projectId} iterations=${iterations} finalParts=${partCount}${shouldFallback ? ' (fallback bubble emitted)' : ''}`,
      );
      // Release the gate. Both old and new state mechanisms are
      // updated so any client still on the legacy `agent_state` event
      // stays correct while the new `agent_state_changed` event is
      // what gates submit / surfaces hints in the composer.
      await this.store.setAgentState(projectId, 'idle');
      await this.agentState.set(projectId, { kind: 'idle' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `consume failed project=${projectId} iterations=${iterations}: ${msg}`,
      );
      // Surface a generic "service hiccup" bubble so the user doesn't just
      // stare at an empty chat. Vendor details (credit balance, rate limit,
      // provider-specific error codes) stay in our logs — never reach the UI.
      if (!addedSeed) {
        const fallback: StoredMessage = {
          id: seedId,
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: 'Let me reorganize my thoughts — please try again in a moment.',
            },
          ],
        };
        await this.store.addMessage(projectId, fallback).catch(() => {});
        await this.store.finalizeMessage(projectId, fallback).catch(() => {});
      } else if (lastMessage) {
        // Mid-stream failure — keep whatever text landed, just finalize so
        // the caret stops blinking.
        await this.store
          .finalizeMessage(projectId, lastMessage)
          .catch(() => {});
      }
      // Sweep any stuck `input-available` tool parts in messages of THIS
      // project (including the just-failed message) → mark `output-error`
      // and re-publish so the UI transitions out of its "consulting…"
      // state. Without this, the fallback bubble we just wrote sits next
      // to a tool card still showing the spinning indicator until the
      // user sends a new message (which is when consume() runs this same
      // sweep at startup). The stuck-ui-tool-janitor CronJob is the
      // 2-min cadence backstop; this in-catch call is the immediate fix.
      await this.markStuckToolPartsInterrupted(projectId).catch((sweepErr) => {
        this.logger.warn(
          `markStuckToolPartsInterrupted (catch path) project=${projectId} failed: ${sweepErr instanceof Error ? sweepErr.message : sweepErr}`,
        );
      });

      await this.store.setAgentState(projectId, 'failed').catch(() => {});
      await this.agentState
        .set(projectId, { kind: 'failed', lastError: msg })
        .catch(() => {});
    } finally {
      clearInterval(heartbeatTimer);
    }
  }

  /** Write a user-submitted message (or any client-owned message) into the store. */
  async persistUserMessage(
    projectId: string,
    message: StoredMessage,
  ): Promise<void> {
    await this.store.addMessage(projectId, message);
  }

  async markState(projectId: string, state: ChatAgentState): Promise<void> {
    await this.store.setAgentState(projectId, state);
  }

  /**
   * Walk the conversation's most recent messages and, for any
   * assistant message that has tool parts still in non-terminal
   * states (`input-streaming` / `input-available`), rewrite those
   * parts as `output-error` with a friendly "interrupted" note.
   *
   * Why: when the agent process dies mid-execute (kill / crash /
   * deploy), the SSE stream cuts off without sending tool-output
   * chunks. The stored message blob keeps the half-finished tool
   * part forever, and every time the user refreshes the page the UI
   * re-renders it as a perpetual `Consulting…` indicator. Sweeping
   * here at the start of each new turn guarantees the chat never
   * shows a phantom in-flight tool from a prior run.
   *
   * Cap at the last 20 messages — typical chat histories are short,
   * but we don't want to scan thousands of messages on every submit.
   */
  private async markStuckToolPartsInterrupted(
    projectId: string,
  ): Promise<void> {
    const allIds = await this.store.getMessageIds(projectId);
    if (allIds.length === 0) return;
    const recent = allIds.slice(-20);
    const messages = await this.store.getMessages(projectId, recent);
    for (const msg of messages) {
      if (!msg || msg.role !== 'assistant') continue;
      const parts = (msg.parts ?? []) as Array<Record<string, unknown>>;
      let mutated = false;
      for (const part of parts) {
        const type = part.type as string | undefined;
        const state = part.state as string | undefined;
        if (
          typeof type === 'string' &&
          type.startsWith('tool-') &&
          state !== 'output-available' &&
          state !== 'output-error' &&
          state !== 'output-denied'
        ) {
          part.state = 'output-error';
          part.errorText = 'Interrupted (agent restarted mid-execution)';
          mutated = true;
        }
      }
      if (mutated) {
        await this.store.updateMessage(projectId, msg).catch(() => {});
        await this.store.finalizeMessage(projectId, msg).catch(() => {});
        this.logger.log(
          `swept stuck tool parts in msg=${msg.id} project=${projectId}`,
        );
      }
    }
  }
}
