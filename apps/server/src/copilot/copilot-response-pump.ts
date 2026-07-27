import type { ServerResponse } from 'http';
import { UI_MESSAGE_STREAM_HEADERS, type UIMessageChunk } from 'ai';

export const COPILOT_STREAM_BUFFER_MAX_BYTES = 4 * 1024 * 1024;

const COPILOT_STREAM_ERROR_TEXT =
  'The copilot response could not be committed. Refresh the conversation and retry.';

export interface CopilotUIStreamOutcome {
  sawAbort: boolean;
  sawError: boolean;
  finishChunk: Extract<UIMessageChunk, { type: 'finish' }> | null;
  sourceError: Error | null;
}

export interface CopilotUIStreamSettlement {
  /** Only a canonically committed assistant response may expose `finish`. */
  emitFinish: boolean;
}

/**
 * Awaitable AI-SDK UI stream adapter with a durable terminal gate.
 *
 * The producer drains the provider independently from response backpressure
 * into a strictly bounded queue. All ordinary deltas remain genuinely
 * streaming, while the protocol's successful `finish` and `[DONE]` markers
 * are withheld until the caller proves the canonical database transition.
 */
export async function pumpCopilotUIMessageStream(input: {
  stream: ReadableStream<UIMessageChunk>;
  response: ServerResponse;
  settle: (
    outcome: CopilotUIStreamOutcome,
  ) => Promise<CopilotUIStreamSettlement>;
  maximumBufferedBytes?: number;
}): Promise<void> {
  const maximumBufferedBytes =
    input.maximumBufferedBytes ?? COPILOT_STREAM_BUFFER_MAX_BYTES;
  if (!Number.isSafeInteger(maximumBufferedBytes) || maximumBufferedBytes < 1) {
    throw new Error('Invalid Copilot response buffer limit.');
  }

  writeUIStreamHeaders(input.response);
  const queue = new BoundedByteQueue(maximumBufferedBytes);
  const consumer = drainResponse(queue, input.response).catch((error) => {
    queue.abort(error);
    throw error;
  });
  const producer = produceGatedStream({
    stream: input.stream,
    queue,
    settle: input.settle,
  });

  const [producerResult, consumerResult] = await Promise.allSettled([
    producer,
    consumer,
  ]);
  if (producerResult.status === 'rejected') {
    throw normalizeThrownError(producerResult.reason);
  }
  if (consumerResult.status === 'rejected') {
    throw normalizeThrownError(consumerResult.reason);
  }
}

async function produceGatedStream(input: {
  stream: ReadableStream<UIMessageChunk>;
  queue: BoundedByteQueue;
  settle: (
    outcome: CopilotUIStreamOutcome,
  ) => Promise<CopilotUIStreamSettlement>;
}): Promise<void> {
  const reader = input.stream.getReader();
  let finishChunk: Extract<UIMessageChunk, { type: 'finish' }> | null = null;
  let sawAbort = false;
  let sawError = false;
  let sourceError: Error | null = null;

  try {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (finishChunk) {
          throw new Error('Copilot stream emitted data after finish.');
        }
        if (value.type === 'finish') {
          finishChunk = value;
          continue;
        }
        sawAbort ||= value.type === 'abort';
        sawError ||= value.type === 'error';
        await input.queue.push(encodeSse(value));
      }
    } catch (error) {
      sourceError = normalizeThrownError(error);
    }

    let settlement: CopilotUIStreamSettlement;
    try {
      settlement = await input.settle({
        sawAbort,
        sawError,
        finishChunk,
        sourceError,
      });
    } catch (error) {
      if (!input.queue.isAborted) {
        await input.queue.push(
          encodeSse({ type: 'error', errorText: COPILOT_STREAM_ERROR_TEXT }),
        );
        await input.queue.push(encodeDone());
      }
      throw error;
    }

    if (sourceError) {
      if (!input.queue.isAborted) {
        await input.queue.push(
          encodeSse({ type: 'error', errorText: COPILOT_STREAM_ERROR_TEXT }),
        );
        await input.queue.push(encodeDone());
      }
      throw sourceError;
    }
    if (settlement.emitFinish) {
      if (!finishChunk) {
        throw new Error('Committed Copilot stream has no finish chunk.');
      }
      await input.queue.push(encodeSse(finishChunk));
    } else if (!sawAbort && !sawError) {
      await input.queue.push(
        encodeSse({ type: 'error', errorText: COPILOT_STREAM_ERROR_TEXT }),
      );
    }
    await input.queue.push(encodeDone());
  } finally {
    input.queue.close();
    reader.releaseLock();
  }
}

async function drainResponse(
  queue: BoundedByteQueue,
  response: ServerResponse,
): Promise<void> {
  try {
    while (true) {
      const chunk = await queue.shift();
      if (chunk === null) break;
      if (response.destroyed || response.writableEnded) {
        throw new CopilotResponseClosedError();
      }
      if (!response.write(chunk)) await waitForDrain(response);
    }
  } finally {
    if (!response.destroyed && !response.writableEnded) response.end();
  }
}

function writeUIStreamHeaders(response: ServerResponse): void {
  if (response.headersSent) return;
  response.writeHead(200, { ...UI_MESSAGE_STREAM_HEADERS });
}

function waitForDrain(response: ServerResponse): Promise<void> {
  if (response.destroyed || response.writableEnded) {
    return Promise.reject(new CopilotResponseClosedError());
  }
  return new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      response.removeListener('drain', onDrain);
      response.removeListener('close', onClose);
      response.removeListener('error', onError);
    };
    const onDrain = () => {
      cleanup();
      resolve();
    };
    const onClose = () => {
      cleanup();
      reject(new CopilotResponseClosedError());
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    response.once('drain', onDrain);
    response.once('close', onClose);
    response.once('error', onError);
  });
}

function encodeSse(chunk: UIMessageChunk): Uint8Array {
  return Buffer.from(`data: ${JSON.stringify(chunk)}\n\n`, 'utf8');
}

function encodeDone(): Uint8Array {
  return Buffer.from('data: [DONE]\n\n', 'utf8');
}

export class CopilotResponseClosedError extends Error {
  constructor() {
    super('The Copilot response connection closed.');
    this.name = 'CopilotResponseClosedError';
  }
}

class BoundedByteQueue {
  private readonly values: Uint8Array[] = [];
  private readonly readers: Array<() => void> = [];
  private readonly writers: Array<() => void> = [];
  private bufferedBytes = 0;
  private closed = false;
  private aborted: Error | null = null;

  constructor(private readonly maximumBytes: number) {}

  get isAborted(): boolean {
    return this.aborted !== null;
  }

  async push(value: Uint8Array): Promise<void> {
    if (value.byteLength > this.maximumBytes) {
      throw new Error('A Copilot stream chunk exceeds the response buffer.');
    }
    while (
      !this.closed &&
      this.aborted === null &&
      this.bufferedBytes + value.byteLength > this.maximumBytes
    ) {
      await new Promise<void>((resolve) => this.writers.push(resolve));
    }
    this.throwIfUnavailable();
    this.values.push(value);
    this.bufferedBytes += value.byteLength;
    this.wakeOne(this.readers);
  }

  async shift(): Promise<Uint8Array | null> {
    while (this.values.length === 0 && !this.closed && this.aborted === null) {
      await new Promise<void>((resolve) => this.readers.push(resolve));
    }
    if (this.aborted !== null) throw this.aborted;
    const value = this.values.shift();
    if (!value) return null;
    this.bufferedBytes -= value.byteLength;
    this.wakeOne(this.writers);
    return value;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.wakeAll(this.readers);
    this.wakeAll(this.writers);
  }

  abort(error: unknown): void {
    if (this.aborted !== null) return;
    this.aborted = normalizeThrownError(error);
    this.wakeAll(this.readers);
    this.wakeAll(this.writers);
  }

  private throwIfUnavailable(): void {
    if (this.aborted !== null) throw this.aborted;
    if (this.closed) throw new Error('The Copilot response queue is closed.');
  }

  private wakeOne(waiters: Array<() => void>): void {
    waiters.shift()?.();
  }

  private wakeAll(waiters: Array<() => void>): void {
    for (const resolve of waiters.splice(0)) resolve();
  }
}

function normalizeThrownError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error('A non-Error value interrupted the Copilot response stream.');
}
