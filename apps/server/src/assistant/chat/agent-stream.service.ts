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

/** Debounce updates to the same in-flight message — don't spam Redis per token. */
const UPDATE_DEBOUNCE_MS = 400;

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
   * Consume the Mastra SSE bytes and persist the resulting assistant
   * message(s) to Redis, publishing events as they flow. The caller
   * provides a seed message id (so the client and server agree on which
   * id represents "the reply being streamed right now").
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

    let lastWrite = 0;
    let lastMessage: StoredMessage | null = null;
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
          lastWrite = Date.now();
          continue;
        }
        const now = Date.now();
        if (now - lastWrite >= UPDATE_DEBOUNCE_MS) {
          await this.store.updateMessage(projectId, lastMessage);
          lastWrite = now;
        }
      }
      // Final flush — make sure the terminal state lands even if the last
      // chunk arrived within the debounce window.
      if (lastMessage) {
        if (addedSeed) {
          await this.store.updateMessage(projectId, lastMessage);
        } else {
          // Stream yielded no messages (shouldn't happen in practice).
          await this.store.addMessage(projectId, lastMessage);
        }
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
