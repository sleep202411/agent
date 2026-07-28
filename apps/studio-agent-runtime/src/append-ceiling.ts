import type { StudioAgentUIChunk } from "./agent-session.js";

/**
 * THE 64 KiB APPEND CEILING, AND THE ROLL THAT KEEPS A LONG REPLY WHOLE.
 *
 * `@ably/ai-transport` streams a text part as ONE Ably message that every
 * `text-delta` appends to (`codec/encoder.ts appendStream`: `tracker.accumulated
 * += data` then `writer.appendMessage`). That is what lets a late subscriber
 * read the text so far instead of an empty buffer — and it is also a bound
 * nobody had measured, because the limit applies to the ACCUMULATION, not to
 * each append.
 *
 * MEASURED, NOT INFERRED. Against the real Ably account, on the `studio-agent`
 * namespace, appending 1 KiB at a time to one message: appends 1..63 succeed;
 * append 64 is nacked with
 *
 *     code=40009 statusCode=413 "... size was 65545, limit is 65536"
 *
 * 65545 = 65536 bytes of accumulated data + 9 bytes for the `ai-output` message
 * name, so the ceiling counts the envelope too. The Pro-tier 256 KiB figure
 * does NOT apply here — appends are capped at 64 KiB whatever the plan.
 *
 * WHAT THAT COSTS WITHOUT THIS MODULE. `appendStream` is fire-and-forget: the
 * nack is collected and surfaced later, and the encoder's recovery path then
 * re-publishes `tracker.accumulated` in full — which is over the ceiling too,
 * so recovery fails as well and the whole step comes back
 * `EncoderRecoveryFailed`. A creator who asked for a long chapter gets a failed
 * turn some seconds after their reply visibly stopped growing.
 *
 * THE FIX IS A ROLL, NOT A TRUNCATION. When one part's accumulation approaches
 * the ceiling this closes it (`text-end`) and opens a continuation
 * (`text-start` under a fresh id) mid-flight. Two Ably messages, one reply: the
 * panel merges consecutive text parts into a single bubble
 * (`apps/studio/lib/studio-agent/timeline-projection.ts projectMessage`), and
 * the durable transcript is untouched because it is written from
 * `result.text`, upstream of this transform. Nothing is dropped, ever — the
 * only observable difference is where the wire puts the seam.
 */

/**
 * The hard limit, in bytes, on one accumulated appended Ably message.
 *
 * Exported so the test that proves the roll can enforce exactly the number the
 * service enforces, rather than a rounder one that would pass either way.
 */
export const ABLY_APPENDED_MESSAGE_LIMIT_BYTES = 65_536;

/**
 * How much of an accumulated message this runtime is willing to fill.
 *
 * 4 KiB under the ceiling. The reserve is not superstition: the measurement
 * above shows the message NAME counted against the limit, and an append also
 * carries `extras.ai.transport` / `extras.ai.codec` headers that repeat the
 * stream id, the status and the codec message id on every write. Reserving a
 * page for the envelope keeps the roll ahead of the nack instead of level with
 * it, and costs one extra Ably message per 60 KiB of reply.
 */
export const STUDIO_AGENT_SEGMENT_BUDGET_BYTES = ABLY_APPENDED_MESSAGE_LIMIT_BYTES - 4_096;

/** What the splitter did, for the log. Never silent. */
export interface AppendCeilingReport {
  /**
   * `rolled` — a text/reasoning part reached the budget and a continuation was
   * opened. `unsplittable` — a stream that CANNOT be rolled crossed it anyway;
   * see {@link createAppendCeilingSplitter} for why tool input is in that class.
   */
  kind: "rolled" | "unsplittable";
  /** The model's own id for the stream, before any continuation suffix. */
  streamId: string;
  /** 1 for the first segment, 2 for the first continuation, and so on. */
  segment: number;
  /** Bytes accumulated on the segment that just closed (or overflowed). */
  bytes: number;
  message: string;
}

export interface AppendCeilingSplitterOptions {
  /** Defaults to {@link STUDIO_AGENT_SEGMENT_BUDGET_BYTES}. */
  budgetBytes?: number;
  report?: (report: AppendCeilingReport) => void;
}

/** Separator for a continuation id. `~` never appears in an AI SDK part id. */
const SEGMENT_SEPARATOR = "~";

interface SegmentState {
  /** The id currently being appended to. */
  currentId: string;
  /** Bytes accumulated on `currentId`. */
  bytes: number;
  /** 1-based index of `currentId` within the logical part. */
  segment: number;
}

/**
 * Rewrite a UI message chunk stream so no single wire message exceeds the
 * append ceiling.
 *
 * WHAT IS ROLLED: `text-*` and `reasoning-*`. Both are `stream()` families
 * whose client-side fold pushes one part per stream id, and two consecutive
 * parts of the same kind read as one block — so a seam is invisible.
 *
 * WHAT IS NOT, AND WHY IT IS REPORTED INSTEAD. `tool-input-*` accumulates the
 * JSON text of a tool call and the decoder reconstructs `input` by parsing the
 * WHOLE accumulation (`vercel/codec/outputs.ts decodeEnd`:
 * `parseJsonOrString(accumulated)`). Rolling it would hand the decoder two
 * halves of one JSON document and produce a corrupt tool call — strictly worse
 * than the failure it avoids. So a tool input over the ceiling remains a hard
 * bound: this names it in the log at the moment it happens, and the encoder's
 * nack still fails the step. The fix, if it is ever hit, is upstream — a
 * capability whose arguments are that large should be taking a reference, not
 * a payload.
 */
export function createAppendCeilingSplitter(
  options: AppendCeilingSplitterOptions = {}
): TransformStream<StudioAgentUIChunk, StudioAgentUIChunk> {
  const budget = options.budgetBytes ?? STUDIO_AGENT_SEGMENT_BUDGET_BYTES;
  if (!Number.isInteger(budget) || budget <= 0) {
    throw new Error(`Append ceiling budget must be a positive integer, received ${budget}.`);
  }
  const report = options.report;
  /** Keyed by the model's original stream id. */
  const streams = new Map<string, SegmentState>();
  /** Keyed by tool call id. Observed only — see the doc comment. */
  const toolInputs = new Map<string, { bytes: number; reported: boolean }>();

  return new TransformStream<StudioAgentUIChunk, StudioAgentUIChunk>({
    transform(chunk, controller) {
      switch (chunk.type) {
        case "text-start":
        case "reasoning-start": {
          streams.set(chunk.id, { currentId: chunk.id, bytes: 0, segment: 1 });
          controller.enqueue(chunk);
          return;
        }
        case "text-delta":
        case "reasoning-delta": {
          const state = streams.get(chunk.id);
          if (!state) {
            // A delta for a part this transform never saw open. Not ours to
            // reinterpret: pass it through exactly as the model produced it.
            controller.enqueue(chunk);
            return;
          }
          const continuation = chunk.type === "text-delta" ? "text-start" : "reasoning-start";
          const closing = chunk.type === "text-delta" ? "text-end" : "reasoning-end";
          for (const piece of splitToBudget(chunk.delta, budget - state.bytes, budget)) {
            if (piece.rollFirst) {
              report?.({
                kind: "rolled",
                streamId: chunk.id,
                segment: state.segment,
                bytes: state.bytes,
                message: `Studio Agent reply segment ${state.segment} of stream ${chunk.id} reached ${state.bytes} bytes (budget ${budget}, Ably ceiling ${ABLY_APPENDED_MESSAGE_LIMIT_BYTES}); continuing on a fresh message.`,
              });
              controller.enqueue({ type: closing, id: state.currentId } as StudioAgentUIChunk);
              state.segment += 1;
              state.currentId = `${chunk.id}${SEGMENT_SEPARATOR}${state.segment}`;
              state.bytes = 0;
              controller.enqueue({ type: continuation, id: state.currentId } as StudioAgentUIChunk);
            }
            state.bytes += piece.bytes;
            controller.enqueue({
              ...chunk,
              id: state.currentId,
              delta: piece.text,
            } as StudioAgentUIChunk);
          }
          return;
        }
        case "text-end":
        case "reasoning-end": {
          const state = streams.get(chunk.id);
          if (!state) {
            controller.enqueue(chunk);
            return;
          }
          streams.delete(chunk.id);
          controller.enqueue({ ...chunk, id: state.currentId } as StudioAgentUIChunk);
          return;
        }
        case "tool-input-start": {
          toolInputs.set(chunk.toolCallId, { bytes: 0, reported: false });
          controller.enqueue(chunk);
          return;
        }
        case "tool-input-delta": {
          const state = toolInputs.get(chunk.toolCallId);
          if (state) {
            state.bytes += byteLength(chunk.inputTextDelta);
            if (state.bytes > budget && !state.reported) {
              state.reported = true;
              report?.({
                kind: "unsplittable",
                streamId: chunk.toolCallId,
                segment: 1,
                bytes: state.bytes,
                message: `Studio Agent tool call ${chunk.toolCallId} has streamed ${state.bytes} bytes of input, past the ${budget}-byte budget for one Ably message (ceiling ${ABLY_APPENDED_MESSAGE_LIMIT_BYTES}). A tool-input stream cannot be split without corrupting its JSON, so this call will be rejected by the transport.`,
              });
            }
          }
          controller.enqueue(chunk);
          return;
        }
        case "tool-input-available":
        case "tool-input-error": {
          toolInputs.delete(chunk.toolCallId);
          controller.enqueue(chunk);
          return;
        }
        default: {
          controller.enqueue(chunk);
        }
      }
    },
  });
}

interface DeltaPiece {
  text: string;
  bytes: number;
  /** Close the open segment and open a continuation before enqueuing this. */
  rollFirst: boolean;
}

/**
 * Cut one delta into pieces that each fit an accumulated message.
 *
 * The common case is one piece and no roll: model deltas are tens of bytes and
 * `remaining` is nearly always larger. The loop exists for the two cases that
 * are not common and must still be exact — a delta that lands on the seam, and
 * a delta bigger than a whole segment (a provider that flushes a paragraph at a
 * time, or one enormous code block).
 */
function splitToBudget(delta: string, remaining: number, budget: number): DeltaPiece[] {
  const total = byteLength(delta);
  if (total === 0) {
    // An empty delta still belongs on the wire — the transport treats it as an
    // ordinary append — but it can never justify a roll.
    return [{ text: delta, bytes: 0, rollFirst: false }];
  }
  if (total <= remaining) {
    return [{ text: delta, bytes: total, rollFirst: false }];
  }

  const pieces: DeltaPiece[] = [];
  let rest = delta;
  let allowance = remaining;
  let rollFirst = false;
  while (rest.length > 0) {
    if (allowance <= 0) {
      rollFirst = true;
      allowance = budget;
    }
    const head = takeBytes(rest, allowance);
    if (head.length === 0) {
      // The next character does not fit in what is left of this segment. Roll
      // rather than emit an empty append. `budget` is thousands of bytes and a
      // UTF-8 character is at most four, so this cannot loop.
      allowance = 0;
      continue;
    }
    const bytes = byteLength(head);
    pieces.push({ text: head, bytes, rollFirst });
    rollFirst = false;
    rest = rest.slice(head.length);
    allowance -= bytes;
  }
  return pieces;
}

/**
 * The longest prefix of `value` that encodes to at most `limit` UTF-8 bytes,
 * never splitting a character or a surrogate pair.
 *
 * Cutting the UTF-8 byte array directly would be faster and wrong: a text part
 * is decoded as a string on the browser, so half a character on the seam is a
 * replacement glyph in the middle of a creator's chapter.
 */
function takeBytes(value: string, limit: number): string {
  if (limit <= 0) return "";
  if (byteLength(value) <= limit) return value;
  let taken = 0;
  let index = 0;
  for (const character of value) {
    const size = byteLength(character);
    if (taken + size > limit) break;
    taken += size;
    index += character.length;
  }
  return value.slice(0, index);
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

/**
 * The DISCRETE half of the ceiling.
 *
 * A streamed part can be rolled onto a continuation; a discrete `send()` cannot
 * — there is no second message to continue onto, so an oversized one is simply
 * refused by the encoder and the nack fails the step. That is the wrong outcome
 * for the two chunks that travel this way: a failure part exists precisely to
 * tell the creator why a turn died, so losing it to its own size replaces a
 * useful error with silence.
 *
 * Only `error.details` can get there. `label` is 240 chars, `detail` 2 000 and
 * `error.message` 8 000 — all bounded in `@repo/shared`. `details` is an
 * arbitrary JSON object with no bound at all, which is the hole this closes.
 * Dropping it keeps the code and the message, which are what the panel renders;
 * the full object is still in the durable event journal, so nothing is lost,
 * only un-pushed. Reported, never silent.
 */
export function enforceDiscreteAppendCeiling(
  chunk: StudioAgentUIChunk,
  options: { budgetBytes?: number; report?: (report: AppendCeilingReport) => void } = {}
): StudioAgentUIChunk {
  const budget = options.budgetBytes ?? STUDIO_AGENT_SEGMENT_BUDGET_BYTES;
  const bytes = Buffer.byteLength(JSON.stringify(chunk), "utf8");
  if (bytes <= budget) return chunk;

  const shed = shedErrorDetails(chunk);
  const shedBytes = shed === null ? bytes : Buffer.byteLength(JSON.stringify(shed), "utf8");
  options.report?.({
    kind: shed !== null && shedBytes <= budget ? "rolled" : "unsplittable",
    streamId: discreteChunkId(chunk),
    segment: 1,
    bytes,
    message:
      shed !== null && shedBytes <= budget
        ? `Discrete chunk was ${bytes} bytes, over the ${budget}-byte budget; published without error.details (${shedBytes} bytes). The full object remains in the event journal.`
        : `Discrete chunk is ${bytes} bytes, over the ${budget}-byte budget, and has no error.details to shed. The encoder will refuse it.`,
  });
  return shed !== null && shedBytes <= budget ? shed : chunk;
}

/** The chunk's reconciliation key, for the log. Not every chunk kind has one. */
function discreteChunkId(chunk: StudioAgentUIChunk): string {
  const id = (chunk as { id?: unknown }).id;
  return typeof id === "string" ? id : "discrete";
}

/** `chunk` with `data.error.details` removed, or null when there is none. */
function shedErrorDetails(chunk: StudioAgentUIChunk): StudioAgentUIChunk | null {
  const data = (chunk as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const error = (data as { error?: unknown }).error;
  if (typeof error !== "object" || error === null) return null;
  if (!("details" in error) || (error as { details: unknown }).details === null) return null;
  return {
    ...chunk,
    data: { ...(data as object), error: { ...(error as object), details: null } },
  } as StudioAgentUIChunk;
}
