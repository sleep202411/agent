import type { AblyRestClient } from '../infra/realtime/ably-token-credentials';
import { setTimeout as delay } from 'node:timers/promises';

// Each BatchSpec counts separately against Ably's per-channel publish limit.
export const ABLY_INDIVIDUAL_BATCH_SPEC_LIMIT = 20;
const CHANNEL_PUBLISHES_PER_SECOND = 40;

/**
 * Ably's default limits are 64 KiB per BatchSpec's messages and 2 MiB for the
 * whole batch request. Keep explicit headroom for provider framing and SDK
 * encoding instead of publishing exactly at the documented boundary.
 */
export const ABLY_SAFE_BATCH_SPEC_UTF8_BYTES = 60 * 1024;
export const ABLY_SAFE_BATCH_REQUEST_UTF8_BYTES = 1_900_000;

export type IndividuallyIdempotentAblyMessage = {
  id: string;
  name: string;
  data: unknown;
};

type IndividuallyIdempotentAblyBatchSpec = {
  channels: [string];
  messages: [IndividuallyIdempotentAblyMessage];
};

export function ablyBatchSpecUtf8Bytes(
  channel: string,
  message: IndividuallyIdempotentAblyMessage,
): number {
  return jsonUtf8Bytes(toBatchSpec(channel, message));
}

export function isWithinAblyRealtimeMessageBudget(
  channel: string,
  message: IndividuallyIdempotentAblyMessage,
): boolean {
  return (
    ablyBatchSpecUtf8Bytes(channel, message) <= ABLY_SAFE_BATCH_SPEC_UTF8_BYTES
  );
}

/**
 * Sends several ordered messages in one REST batch request while retaining an
 * independent idempotency key for every message.
 *
 * Ably treats an array of messages inside one BatchSpec as one atomic publish;
 * client-provided ids in that array must therefore share a `<base>:<index>`
 * key. Agent OS events are an append-only stream whose retry batch can grow, so
 * an atomic base id would either duplicate an older event or suppress a newly
 * appended one. A BatchSpec per event is Ably's supported representation for
 * independently idempotent messages, and preserves the input order.
 */
export async function publishIndividuallyIdempotentAblyBatch(
  ably: Pick<AblyRestClient, 'batchPublish'>,
  channel: string,
  messages: readonly IndividuallyIdempotentAblyMessage[],
  onPublished?: (ids: readonly string[]) => Promise<void>,
): Promise<void> {
  if (messages.length === 0) {
    throw new Error('Agent OS Ably batch must contain at least one message');
  }
  if (
    messages.some((message) => message.id.length === 0) ||
    new Set(messages.map((message) => message.id)).size !== messages.length
  ) {
    throw new Error('Agent OS Ably batch requires unique durable message ids');
  }

  const batches = chunkIndividuallyIdempotentAblySpecs(channel, messages);
  for (const batch of batches) {
    // The outbox's conversation lease serializes publishes across all pods.
    await delay(
      Math.ceil((batch.length * 1_000) / CHANNEL_PUBLISHES_PER_SECOND),
    );
    const results = await ably.batchPublish(batch);
    if (!Array.isArray(results) || results.length !== batch.length) {
      throw new Error(
        `Agent OS Ably batch acknowledgement mismatch expected=${batch.length} received=${Array.isArray(results) ? results.length : 'non-array'}`,
      );
    }
    const publishedIds = batch.flatMap((spec, index) =>
      results[index]?.failureCount === 0 && results[index]?.successCount === 1
        ? [spec.messages[0].id]
        : [],
    );
    if (publishedIds.length > 0) await onPublished?.(publishedIds);
    const failed = results.filter(
      (result) => result.failureCount !== 0 || result.successCount !== 1,
    );
    if (failed.length > 0) {
      throw new Error(
        `Agent OS Ably batch publish failed: ${JSON.stringify(failed).slice(0, 2_000)}`,
      );
    }
  }
}

export function chunkIndividuallyIdempotentAblySpecs(
  channel: string,
  messages: readonly IndividuallyIdempotentAblyMessage[],
): IndividuallyIdempotentAblyBatchSpec[][] {
  const batches: IndividuallyIdempotentAblyBatchSpec[][] = [];
  let batch: IndividuallyIdempotentAblyBatchSpec[] = [];
  let batchBytes = 2; // JSON array brackets.

  for (const message of messages) {
    const spec = toBatchSpec(channel, message);
    const specBytes = jsonUtf8Bytes(spec);
    if (specBytes > ABLY_SAFE_BATCH_SPEC_UTF8_BYTES) {
      throw new Error(
        `Agent OS Ably message exceeds safe byte budget id=${message.id} bytes=${specBytes}`,
      );
    }

    const candidateBytes = batchBytes + (batch.length > 0 ? 1 : 0) + specBytes;
    if (
      batch.length > 0 &&
      (batch.length >= ABLY_INDIVIDUAL_BATCH_SPEC_LIMIT ||
        candidateBytes > ABLY_SAFE_BATCH_REQUEST_UTF8_BYTES)
    ) {
      batches.push(batch);
      batch = [];
      batchBytes = 2;
    }

    batch.push(spec);
    batchBytes += (batch.length > 1 ? 1 : 0) + specBytes;
  }

  if (batch.length > 0) batches.push(batch);
  return batches;
}

function toBatchSpec(
  channel: string,
  message: IndividuallyIdempotentAblyMessage,
): IndividuallyIdempotentAblyBatchSpec {
  return {
    channels: [channel],
    messages: [{ ...message }],
  };
}

function jsonUtf8Bytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}
