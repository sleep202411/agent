import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';

import * as Ably from 'ably';

import { createAblyRestClient } from '../infra/realtime/ably-token-credentials';
import {
  ABLY_INDIVIDUAL_BATCH_SPEC_LIMIT,
  ABLY_SAFE_BATCH_REQUEST_UTF8_BYTES,
  ABLY_SAFE_BATCH_SPEC_UTF8_BYTES,
  ablyBatchSpecUtf8Bytes,
  chunkIndividuallyIdempotentAblySpecs,
  isWithinAblyRealtimeMessageBudget,
  publishIndividuallyIdempotentAblyBatch,
} from './ably-individually-idempotent-batch';

const CHANNEL = 'agent-os:conversation:33333333-3333-4333-8333-333333333333';
const FIRST_ID = '55555555-5555-4555-8555-555555555555';
const SECOND_ID = '66666666-6666-4666-8666-666666666666';
const ATOMIC_ID_ERROR =
  'Client-specified message ids do not match the required format for multi-message ProtocolMessages';

describe('Ably individually-idempotent batch contract', () => {
  it('pins the production REST client to the JSON wire format used by the byte budget', () => {
    const client = createAblyRestClient({
      ABLY_API_KEY: 'test.key:secret',
    });

    expect(
      (client as unknown as { options: { useBinaryProtocol: boolean } }).options
        .useBinaryProtocol,
    ).toBe(false);
  });

  it('uses the installed Ably REST SDK to serialize one independently-idempotent BatchSpec per event', async () => {
    const requests: RecordedRequest[] = [];
    const server = createServer((request, response) => {
      void handleAblyContractRequest(request, response, requests);
    });
    await listen(server);
    const port = (server.address() as AddressInfo).port;
    const ably = new Ably.Rest({
      key: 'test.key:secret',
      clientId: 'agent-os-contract-test',
      endpoint: '127.0.0.1',
      port,
      tls: false,
      useBinaryProtocol: false,
      fallbackHosts: [],
      idempotentRestPublishing: true,
      httpMaxRetryCount: 0,
    });

    try {
      await expect(
        ably.channels.get(CHANNEL).publish([
          { id: FIRST_ID, name: 'agent-event', data: { id: FIRST_ID } },
          { id: SECOND_ID, name: 'agent-event', data: { id: SECOND_ID } },
        ]),
      ).rejects.toThrow(ATOMIC_ID_ERROR);

      const events = [
        {
          id: FIRST_ID,
          name: 'agent-event',
          data: { id: FIRST_ID, sequence: 1 },
        },
        {
          id: SECOND_ID,
          name: 'agent-event',
          data: { id: SECOND_ID, sequence: 2 },
        },
      ] as const;
      await publishIndividuallyIdempotentAblyBatch(ably, CHANNEL, events);
      await publishIndividuallyIdempotentAblyBatch(ably, CHANNEL, events);

      const batchBodies = requests
        .filter((request) => request.pathname === '/messages')
        .map((request) => request.body as BatchPublishSpecBody[]);
      expect(batchBodies).toHaveLength(2);
      expect(batchBodies[0]).toEqual(batchBodies[1]);
      expect(batchBodies[0]).toEqual([
        {
          channels: [CHANNEL],
          messages: [
            {
              id: FIRST_ID,
              name: 'agent-event',
              data: { id: FIRST_ID, sequence: 1 },
            },
          ],
        },
        {
          channels: [CHANNEL],
          messages: [
            {
              id: SECOND_ID,
              name: 'agent-event',
              data: { id: SECOND_ID, sequence: 2 },
            },
          ],
        },
      ]);

      requests.length = 0;
      const largeSuffix = Array.from({ length: 100 }, (_, index) => ({
        id: `large-event-${String(index).padStart(3, '0')}`,
        name: 'agent-event',
        data: { sequence: index + 1, text: '界'.repeat(10_000) },
      }));
      await publishIndividuallyIdempotentAblyBatch(ably, CHANNEL, largeSuffix);
      const largeBodies = requests
        .filter((request) => request.pathname === '/messages')
        .map((request) => request.body as BatchPublishSpecBody[]);
      expect(largeBodies.length).toBeGreaterThan(1);
      expect(largeBodies.flat()).toHaveLength(largeSuffix.length);
      expect(
        largeBodies.every(
          (body) =>
            Buffer.byteLength(JSON.stringify(body), 'utf8') <=
            ABLY_SAFE_BATCH_REQUEST_UTF8_BYTES,
        ),
      ).toBe(true);
    } finally {
      await close(server);
    }
  });

  it('measures four-byte Unicode with the full channel/spec envelope', () => {
    const small = {
      id: FIRST_ID,
      name: 'agent-event',
      data: { text: '😀'.repeat(10) },
    };
    const oversized = {
      ...small,
      data: { text: '😀'.repeat(20_000) },
    };

    expect(ablyBatchSpecUtf8Bytes(CHANNEL, small)).toBe(
      Buffer.byteLength(
        JSON.stringify({ channels: [CHANNEL], messages: [small] }),
        'utf8',
      ),
    );
    expect(isWithinAblyRealtimeMessageBudget(CHANNEL, small)).toBe(true);
    expect(ablyBatchSpecUtf8Bytes(CHANNEL, oversized)).toBeGreaterThan(
      ABLY_SAFE_BATCH_SPEC_UTF8_BYTES,
    );
    expect(isWithinAblyRealtimeMessageBudget(CHANNEL, oversized)).toBe(false);
  });

  it('chunks by both the one-hundred spec ceiling and the actual UTF-8 request budget', () => {
    const messages = Array.from({ length: 100 }, (_, index) => ({
      id: `batch-message-${index}`,
      name: 'agent-event',
      data: { text: '界'.repeat(10_000), sequence: index + 1 },
    }));

    const batches = chunkIndividuallyIdempotentAblySpecs(CHANNEL, messages);

    expect(batches.length).toBeGreaterThan(1);
    expect(batches.flatMap((batch) => batch)).toHaveLength(messages.length);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(
        ABLY_INDIVIDUAL_BATCH_SPEC_LIMIT,
      );
      expect(
        Buffer.byteLength(JSON.stringify(batch), 'utf8'),
      ).toBeLessThanOrEqual(ABLY_SAFE_BATCH_REQUEST_UTF8_BYTES);
      for (const spec of batch) {
        expect(
          Buffer.byteLength(JSON.stringify(spec), 'utf8'),
        ).toBeLessThanOrEqual(ABLY_SAFE_BATCH_SPEC_UTF8_BYTES);
      }
    }
  });
});

type RecordedRequest = {
  pathname: string;
  body: unknown;
};

type MessageBody = {
  id?: string;
  name?: string;
  data?: unknown;
};

type BatchPublishSpecBody = {
  channels: string[];
  messages: MessageBody[];
};

async function handleAblyContractRequest(
  request: IncomingMessage,
  response: ServerResponse,
  requests: RecordedRequest[],
): Promise<void> {
  try {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const body = await readJsonBody(request);
    requests.push({ pathname, body });

    if (pathname === '/messages') {
      const specs = parseBatchSpecs(body);
      if (specs.some((spec) => spec.messages.length !== 1)) {
        writeAblyError(response, ATOMIC_ID_ERROR);
        return;
      }
      writeJson(
        response,
        201,
        specs.map((spec) => ({
          successCount: spec.channels.length,
          failureCount: 0,
          results: spec.channels.map((channel) => ({
            channel,
            messageId: spec.messages[0]?.id ?? '',
            serials: ['serial'],
          })),
        })),
      );
      return;
    }

    if (pathname.includes('/channels/') && pathname.endsWith('/messages')) {
      const messages = Array.isArray(body) ? body : [body];
      if (!hasValidAtomicMessageIds(messages)) {
        writeAblyError(response, ATOMIC_ID_ERROR);
        return;
      }
      writeJson(response, 201, {});
      return;
    }

    writeJson(response, 404, {
      error: { message: 'not found', code: 40400, statusCode: 404 },
    });
  } catch (error) {
    writeJson(response, 500, {
      error: {
        message: error instanceof Error ? error.message : String(error),
        code: 50000,
        statusCode: 500,
      },
    });
  }
}

function parseBatchSpecs(value: unknown): BatchPublishSpecBody[] {
  if (!Array.isArray(value)) throw new Error('Expected an array of BatchSpecs');
  return value.map((entry) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error('Expected a BatchSpec object');
    }
    const channels = (entry as { channels?: unknown }).channels;
    const messages = (entry as { messages?: unknown }).messages;
    if (
      !Array.isArray(channels) ||
      !channels.every((channel) => typeof channel === 'string') ||
      !Array.isArray(messages)
    ) {
      throw new Error('Invalid BatchSpec');
    }
    return {
      channels,
      messages: messages as MessageBody[],
    };
  });
}

function hasValidAtomicMessageIds(messages: readonly unknown[]): boolean {
  if (messages.length <= 1) return true;
  const ids = messages.map((message) =>
    String((message as { id?: unknown }).id),
  );
  const first = ids[0];
  if (!first?.endsWith(':0')) return false;
  const base = first.slice(0, -2);
  return ids.every((id, index) => id === `${base}:${index}`);
}

function writeAblyError(response: ServerResponse, message: string): void {
  writeJson(response, 400, {
    error: { message, code: 40003, statusCode: 400 },
  });
}

function writeJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text.length > 0 ? (JSON.parse(text) as unknown) : null;
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  });
}

function close(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
