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

  constructor(private readonly store: MessageStoreService) {}

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
  }): Promise<void> {
    const { projectId, seedMessage, rawStream } = opts;
    const chunkStream = toChunkStream(rawStream);
    const seedId = seedMessage.id;

    await this.store.setAgentState(projectId, 'running');

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
      if (lastMessage) {
        if (!addedSeed) {
          // Stream yielded no messages — just add the seed for consistency.
          await this.store.addMessage(projectId, lastMessage);
        }
        await this.store.finalizeMessage(projectId, lastMessage);
      } else if (!addedSeed) {
        // Stream ended cleanly but produced zero content (upstream likely
        // dropped an error chunk our schema doesn't parse). Emit a generic
        // fallback so the user sees a reply bubble instead of silence.
        const fallback: StoredMessage = {
          id: seedId,
          role: 'assistant',
          parts: [
            {
              type: 'text',
              text: '抱歉，服务暂时不太稳定，请稍后再试一下。',
            },
          ],
        };
        await this.store.addMessage(projectId, fallback).catch(() => {});
        await this.store.finalizeMessage(projectId, fallback).catch(() => {});
        this.logger.warn(
          `consume ended with no content project=${projectId} — emitted fallback bubble`,
        );
      }

      const partCount = Array.isArray(lastMessage?.parts)
        ? lastMessage.parts.length
        : 0;
      this.logger.log(
        `consume done project=${projectId} iterations=${iterations} finalParts=${partCount}`,
      );
      await this.store.setAgentState(projectId, 'idle');
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
              text: '抱歉，服务暂时不太稳定，请稍后再试一下。',
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
      await this.store.setAgentState(projectId, 'failed').catch(() => {});
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
}
