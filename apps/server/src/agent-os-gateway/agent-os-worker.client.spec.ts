import { ServiceUnavailableException } from '@nestjs/common';
import { AgentOsWorkerClient } from './agent-os-worker.client';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';

describe('AgentOsWorkerClient', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
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
});

function requireFetchCall(fetchMock: typeof fetch): Parameters<typeof fetch> {
  const call = jest.mocked(fetchMock).mock.calls.at(-1);
  if (!call)
    throw new Error('Expected the Worker client to issue an HTTP request.');
  return call;
}
