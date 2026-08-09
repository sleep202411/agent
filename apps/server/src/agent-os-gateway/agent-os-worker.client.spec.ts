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
      projectId: '22222222-2222-4222-8222-222222222222',
      conversationId: '33333333-3333-4333-8333-333333333333',
      actorId: 'user-1',
      message: 'extract characters',
      modelProfileId: 'qwen-plus',
      projectKind: 'platform',
      workbenchMode: 'storyboard',
    });

    expect(result.status).toBe('waiting_for_approval');
    expect(global.fetch).toHaveBeenCalledWith(
      'http://127.0.0.1:4301/v1/agent-os/runs',
      expect.objectContaining({ method: 'POST' }),
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
});
