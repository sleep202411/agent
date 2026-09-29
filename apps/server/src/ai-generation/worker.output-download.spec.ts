import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { AiGenerationWorkerService } from './worker.service';

// Only the download methods run; no queue, billing, storage or provider operation.
jest.mock('../common/alerting', () => ({ AlertingService: jest.fn() }));
jest.mock('../entitlements', () => ({ EntitlementService: jest.fn() }));
jest.mock('../documents/documents.service', () => ({
  DocumentsService: jest.fn(),
}));
jest.mock('../infra/storage/storage-provider-registry.service', () => ({
  StorageProviderRegistry: jest.fn(),
}));
jest.mock('../media/media-asset-readiness.service', () => ({
  MediaAssetReadinessService: jest.fn(),
}));
jest.mock('./billing-wallet.service', () => ({
  AiGenerationBillingWalletService: jest.fn(),
}));
jest.mock('./outbox.service', () => ({ AiGenerationOutboxService: jest.fn() }));
jest.mock('./provider-capacity-runtime.service', () => ({
  ProviderCapacityRuntimeService: jest.fn(),
}));
jest.mock('./provider-registry.service', () => ({
  ProviderRegistry: jest.fn(),
}));
jest.mock('./queue', () => ({ createAiWorker: jest.fn() }));
jest.mock('./queue.service', () => ({ AiGenerationQueueService: jest.fn() }));
jest.mock('./repository', () => ({ AiGenerationRepository: jest.fn() }));
jest.mock('./reference-url-preparer.service', () => ({
  AiReferenceUrlPreparerService: jest.fn(),
}));
jest.mock('./completion-observer.service', () => ({
  AiGenerationCompletionObserverRegistry: jest.fn(),
}));
jest.mock('../media/uploaded-image-probe.service', () => ({
  inspectImage: jest.fn(),
}));

type Downloads = {
  fetchProviderBytes(url: string, maxBytes?: number): Promise<Buffer>;
  spoolProviderUrlToFile(url: string, path: string): Promise<unknown>;
};
function worker(): Downloads {
  return Object.create(AiGenerationWorkerService.prototype) as Downloads;
}
afterEach(() => jest.restoreAllMocks());
it.each(['buffer', 'file'])(
  'cancels rejected provider output for %s downloads',
  async (mode) => {
    const cancel = jest.fn();
    const body = new ReadableStream({ cancel });
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(body, { status: 503 }));
    const instance = worker();
    await expect(
      mode === 'buffer'
        ? instance.fetchProviderBytes('https://provider.test/output')
        : instance.spoolProviderUrlToFile(
            'https://provider.test/output',
            '/unused-path',
          ),
    ).rejects.toThrow('provider URL fetch failed: HTTP 503');
    expect(cancel).toHaveBeenCalledTimes(1);
  },
);

it('preserves the HTTP error when cleanup rejects', async () => {
  const body = new ReadableStream({
    cancel() {
      throw new Error('cleanup failed');
    },
  });
  jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(body, { status: 502 }));
  await expect(
    worker().fetchProviderBytes('https://provider.test/output'),
  ).rejects.toThrow('HTTP 502');
});
it('retains successful buffer and disk output with exact hashing', async () => {
  const bytes = Buffer.from('provider output bytes');
  jest
    .spyOn(global, 'fetch')
    .mockImplementation(() => Promise.resolve(new Response(bytes)));
  const instance = worker();
  expect(
    await instance.fetchProviderBytes('https://provider.test/output'),
  ).toEqual(bytes);
  const directory = await mkdtemp(join(tmpdir(), 'draft19-output-'));
  try {
    const path = join(directory, 'output');
    expect(
      await instance.spoolProviderUrlToFile(
        'https://provider.test/output',
        path,
      ),
    ).toEqual({
      bytes: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    expect(await readFile(path)).toEqual(bytes);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

// Use a small ceiling to exercise the production reader without allocating GiB.
it('rejects oversized Content-Length before reading buffered output', async () => {
  const cancel = jest.fn();
  const response = new Response(new ReadableStream({ cancel }), {
    headers: { 'Content-Length': '9' },
  });
  jest.spyOn(global, 'fetch').mockResolvedValue(response);
  // The old arrayBuffer path resolves small bytes instead of enforcing the limit.
  jest.spyOn(response, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(9));
  await expect(
    worker().fetchProviderBytes('https://provider.test/output', 8),
  ).rejects.toThrow('provider output exceeds 8 bytes');
  expect(cancel).toHaveBeenCalledTimes(1);
});

it.each([undefined, '1'])(
  'enforces streamed byte count despite Content-Length %s',
  async (length) => {
    const cancel = jest.fn().mockRejectedValue(new Error('cleanup failure'));
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(9));
        },
        cancel,
      }),
      { headers: length ? { 'Content-Length': length } : {} },
    );
    jest.spyOn(global, 'fetch').mockResolvedValue(response);
    jest.spyOn(response, 'arrayBuffer').mockResolvedValue(new ArrayBuffer(9));
    await expect(
      worker().fetchProviderBytes('https://provider.test/output', 8),
    ).rejects.toThrow('provider output exceeds 8 bytes');
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(response.body?.locked).toBe(false);
  },
);

it('accepts multiple chunks at the exact buffered byte ceiling', async () => {
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array([3, 4]));
        controller.close();
      },
    }),
  );
  jest.spyOn(global, 'fetch').mockResolvedValue(response);
  await expect(
    worker().fetchProviderBytes('https://provider.test/output', 4),
  ).resolves.toEqual(Buffer.from([1, 2, 3, 4]));
  expect(response.body?.locked).toBe(false);
});
