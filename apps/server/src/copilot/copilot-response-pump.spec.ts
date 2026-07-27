import { EventEmitter } from 'events';
import type { ServerResponse } from 'http';
import { createUIMessageStream, type UIMessageChunk } from 'ai';
import {
  pumpCopilotUIMessageStream,
  type CopilotUIStreamSettlement,
} from './copilot-response-pump';

describe('pumpCopilotUIMessageStream', () => {
  it('streams deltas but withholds finish and DONE until settlement commits', async () => {
    const response = new TestServerResponse();
    const settlement = deferred<CopilotUIStreamSettlement>();
    const pumping = pumpCopilotUIMessageStream({
      stream: fixtureStream(),
      response: response as unknown as ServerResponse,
      settle: () => settlement.promise,
    });

    await eventually(() => expect(response.body()).toContain('text-delta'));
    expect(response.body()).not.toContain('"type":"finish"');
    expect(response.body()).not.toContain('[DONE]');

    settlement.resolve({ emitFinish: true });
    await pumping;
    expect(response.body()).toContain('"type":"finish"');
    expect(response.body()).toContain('data: [DONE]');
    expect(response.writableEnded).toBe(true);
  });

  it('turns a settlement rejection into a terminal stream error without exposing success', async () => {
    const response = new TestServerResponse();
    const error = new Error('canonical database unavailable');
    await expect(
      pumpCopilotUIMessageStream({
        stream: fixtureStream(),
        response: response as unknown as ServerResponse,
        settle: () => Promise.reject(error),
      }),
    ).rejects.toBe(error);

    expect(response.body()).toContain('"type":"error"');
    expect(response.body()).toContain('could not be committed');
    expect(response.body()).not.toContain('"type":"finish"');
    expect(response.body()).toContain('data: [DONE]');
    expect(response.writableEnded).toBe(true);
  });

  it('drains the provider into a bounded queue independently of a slow client', async () => {
    const response = new TestServerResponse({ blockFirstWrite: true });
    const settle = jest
      .fn<Promise<CopilotUIStreamSettlement>, []>()
      .mockResolvedValue({ emitFinish: true });
    let resolved = false;
    const pumping = pumpCopilotUIMessageStream({
      stream: fixtureStream(),
      response: response as unknown as ServerResponse,
      settle,
      maximumBufferedBytes: 64 * 1024,
    }).then(() => {
      resolved = true;
    });

    await eventually(() => expect(settle).toHaveBeenCalledTimes(1));
    expect(resolved).toBe(false);
    response.releaseDrain();
    await pumping;
    expect(response.body()).toContain('"type":"finish"');
  });
});

function fixtureStream(): ReadableStream<UIMessageChunk> {
  return createUIMessageStream({
    execute({ writer }) {
      writer.write({ type: 'start', messageId: 'assistant-1' });
      writer.write({ type: 'start-step' });
      writer.write({ type: 'text-start', id: 'text-1' });
      writer.write({ type: 'text-delta', id: 'text-1', delta: 'Hello' });
      writer.write({ type: 'text-end', id: 'text-1' });
      writer.write({ type: 'finish-step' });
      writer.write({
        type: 'finish',
        finishReason: 'stop',
      });
    },
  });
}

class TestServerResponse extends EventEmitter {
  headersSent = false;
  writableEnded = false;
  destroyed = false;
  statusCode = 0;
  headers: Record<string, string> = {};
  private readonly chunks: Uint8Array[] = [];
  private blockNextWrite: boolean;

  constructor(options: { blockFirstWrite?: boolean } = {}) {
    super();
    this.blockNextWrite = options.blockFirstWrite ?? false;
  }

  writeHead(statusCode: number, headers: Record<string, string>): this {
    this.statusCode = statusCode;
    this.headers = headers;
    this.headersSent = true;
    return this;
  }

  write(chunk: Uint8Array): boolean {
    this.chunks.push(Buffer.from(chunk));
    if (!this.blockNextWrite) return true;
    this.blockNextWrite = false;
    return false;
  }

  end(): this {
    this.writableEnded = true;
    this.emit('finish');
    return this;
  }

  releaseDrain(): void {
    this.emit('drain');
  }

  body(): string {
    return Buffer.concat(this.chunks).toString('utf8');
  }
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

async function eventually(assertion: () => void): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise<void>((resolve) => setImmediate(resolve));
    }
  }
  throw lastError;
}
