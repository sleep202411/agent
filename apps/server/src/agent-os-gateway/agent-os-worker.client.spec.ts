import { ServiceUnavailableException } from '@nestjs/common';
import { AgentOsWorkerClient } from './agent-os-worker.client';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';

describe('AgentOsWorkerClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it('dispatches discovery with scoped context and propagates cancellation', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ status: 'clarification', question: 'Which city?' }),
    });
    const client = new AgentOsWorkerClient({
      value: {
        workerBaseUrl: 'http://127.0.0.1:4301',
        internalToken: 'test-internal-token-16',
      },
    } as AgentOsGatewayConfigService);
    const controller = new AbortController();
    const body = {
      requestId: '11111111-1111-4111-8111-111111111111',
      locale: 'en-US',
      coordinateSystem: 'WGS84',
      genres: [],
      credential: {
        requestId: '11111111-1111-4111-8111-111111111111',
        readToken: 'a'.repeat(64),
      },
      conversation: {
        current: {
          kind: 'creators',
          query: {
            basedIn: null,
            serves: null,
            remoteOnly: false,
            availableForWork: false,
            category: null,
            text: '',
          },
        },
        messages: [{ role: 'user', content: 'Find a studio' }],
      },
    };
    await expect(
      client.discoverContentGps(body, controller.signal),
    ).resolves.toEqual({ status: 'clarification', question: 'Which city?' });
    const [url, init] = requireFetchCall(global.fetch);
    expect(url).toBe('http://127.0.0.1:4301/v1/agent-os/content-gps/discover');
    expect(init?.redirect).toBe('error');
    expect(JSON.parse(init?.body as string)).toEqual(body);
    controller.abort();
    expect(init?.signal?.aborted).toBe(true);
  });

  it('preserves viewing-assistance configuration errors', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () =>
        Promise.resolve({
          error: {
            code: 'VIEWER_MODEL_NOT_CONFIGURED',
            message: 'Viewing assistance model is not configured.',
          },
        }),
    });
    const client = new AgentOsWorkerClient({
      value: {
        workerBaseUrl: 'http://127.0.0.1:4301',
        internalToken: 'test-internal-token-16',
      },
    } as AgentOsGatewayConfigService);
    await expect(
      client.recommendViewing({}, new AbortController().signal),
    ).rejects.toMatchObject({
      response: {
        code: 'VIEWER_MODEL_NOT_CONFIGURED',
        message: 'Viewing assistance model is not configured.',
      },
    });
  });

  it('forwards viewing cancellation and validates its response contract', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({ suggestions: [], privateContext: 'invalid' }),
    });
    const client = new AgentOsWorkerClient({
      value: {
        workerBaseUrl: 'http://127.0.0.1:4301',
        internalToken: 'test-internal-token-16',
      },
    } as AgentOsGatewayConfigService);
    const abort = new AbortController();
    await expect(client.recommendViewing({}, abort.signal)).rejects.toThrow();
    const [url, request] = requireFetchCall(global.fetch);
    expect(url).toBe('http://127.0.0.1:4301/v1/agent-os/viewer-assistance');
    expect(request?.headers).toEqual(
      expect.objectContaining({
        'x-agent-os-internal-token': 'test-internal-token-16',
      }),
    );
    abort.abort();
    expect(request?.signal?.aborted).toBe(true);
  });

  it('posts start run to worker', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          runId: '11111111-1111-4111-8111-111111111111',
          status: 'waiting_for_approval',
        }),
    }) as unknown as typeof fetch;

    const client = new AgentOsWorkerClient({
      value: {
        workerBaseUrl: 'http://127.0.0.1:4301',
        internalToken: 'test-internal-token-16',
        billing: 'free',
        rateLimit: 'disabled',
      },
    } as AgentOsGatewayConfigService);

    const result = await client.startRun({
      runId: '11111111-1111-4111-8111-111111111111',
      clientSubmissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      messageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      startExecutionToken: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
      startExecutionAttemptId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      startExecutionEpoch: 1,
      projectId: '22222222-2222-4222-8222-222222222222',
      conversationId: '33333333-3333-4333-8333-333333333333',
      actorId: 'user-1',
      message: 'extract characters',
      modelProfileId: 'qwen-plus',
      projectKind: 'platform',
      workbenchMode: 'storyboard',
    });

    expect(result.status).toBe('waiting_for_approval');
    const [url, request] = requireFetchCall(global.fetch);
    expect(url).toBe('http://127.0.0.1:4301/v1/agent-os/runs');
    expect(request?.method).toBe('POST');
    expect(request?.body).toEqual(
      expect.stringContaining('"runId":"11111111-1111-4111-8111-111111111111"'),
    );
  });

  it('maps network failure to ServiceUnavailable', async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED'));

    const client = new AgentOsWorkerClient({
      value: {
        workerBaseUrl: 'http://127.0.0.1:4301',
        internalToken: 'test-internal-token-16',
        billing: 'free',
        rateLimit: 'disabled',
      },
    } as AgentOsGatewayConfigService);

    await expect(
      client.startRun({
        runId: '11111111-1111-4111-8111-111111111111',
        clientSubmissionId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        turnId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        messageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        startExecutionToken: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        startExecutionAttemptId: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
        startExecutionEpoch: 1,
        projectId: '22222222-2222-4222-8222-222222222222',
        conversationId: '33333333-3333-4333-8333-333333333333',
        actorId: 'user-1',
        message: 'x',
        modelProfileId: 'qwen-plus',
        projectKind: 'platform',
        workbenchMode: 'storyboard',
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('forwards approvalId and responseId to the Worker', async () => {
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ runId: 'run-1', status: 'running' }),
    }) as unknown as typeof fetch;
    const client = new AgentOsWorkerClient({
      value: {
        workerBaseUrl: 'http://127.0.0.1:4301',
        internalToken: 'test-internal-token-16',
        billing: 'free',
        rateLimit: 'disabled',
      },
    } as AgentOsGatewayConfigService);

    await client.resolveApproval({
      runId: '11111111-1111-4111-8111-111111111111',
      approvalId: '22222222-2222-4222-8222-222222222222',
      responseId: '33333333-3333-4333-8333-333333333333',
      decision: 'approve',
      responseText: 'Approved',
      locale: 'en-US',
      projectId: '44444444-4444-4444-8444-444444444444',
      actorId: 'user-1',
      conversationId: '55555555-5555-4555-8555-555555555555',
      modelProfileId: 'qwen-plus',
      projectKind: 'story',
      workbenchMode: 'story',
    });

    const [url, request] = requireFetchCall(global.fetch);
    expect(url).toBe(
      'http://127.0.0.1:4301/v1/agent-os/runs/11111111-1111-4111-8111-111111111111/approvals',
    );
    expect(request?.body).toEqual(
      expect.stringContaining(
        '"responseId":"33333333-3333-4333-8333-333333333333"',
      ),
    );
    expect(request?.body).toEqual(
      expect.stringContaining('"responseText":"Approved"'),
    );
    expect(request?.body).toEqual(
      expect.stringContaining(
        '"approvalId":"22222222-2222-4222-8222-222222222222"',
      ),
    );
  });
  it('validates GPS sources before dispatch and preserves missing-profile errors', async () => {
    const fetcher = jest
      .fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'GPS_MODEL_NOT_CONFIGURED',
              message: 'GPS profile missing.',
            },
          }),
          { status: 503 },
        ),
      );
    global.fetch = fetcher;
    const client = new AgentOsWorkerClient({
      value: {
        workerBaseUrl: 'http://127.0.0.1:4301',
        internalToken: 'test-internal-token-16',
      },
    } as AgentOsGatewayConfigService);
    await expect(
      client.extractContentGps({}, new AbortController().signal),
    ).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    const body = {
      ipId: '01900000-0000-7000-8000-000000000001',
      locale: 'en-US',
      analysisVersion: 'v1',
      analyzedAt: '2026-10-01T00:00:00Z',
      sources: [],
    };
    await expect(
      client.extractContentGps(body, new AbortController().signal),
    ).rejects.toMatchObject({ response: { code: 'GPS_MODEL_NOT_CONFIGURED' } });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(
      'http://127.0.0.1:4301/v1/agent-os/content-gps/extract',
    );
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      redirect: 'error',
      headers: { 'x-agent-os-internal-token': 'test-internal-token-16' },
    });
  });
});

function requireFetchCall(fetchMock: typeof fetch): Parameters<typeof fetch> {
  const call = jest.mocked(fetchMock).mock.calls.at(-1);
  if (!call)
    throw new Error('Expected the Worker client to issue an HTTP request.');
  return call;
}
