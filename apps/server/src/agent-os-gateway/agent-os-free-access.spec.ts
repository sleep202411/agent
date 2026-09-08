import { QUOTA_METADATA_KEY } from '../quota/quota.decorator';
import { AgentOsGatewayConfigService } from './agent-os-gateway.config';
import { AgentOsGatewayController } from './agent-os-gateway.controller';

describe('Agent OS free-access contract', () => {
  it('pins billing and rate limiting off', () => {
    const previousToken = process.env.AGENT_OS_INTERNAL_TOKEN;
    const previousWorkerUrl = process.env.AGENT_OS_WORKER_URL;
    process.env.AGENT_OS_INTERNAL_TOKEN = 'agent-os-free-access-spec-secret';
    process.env.AGENT_OS_WORKER_URL = 'http://worker.test.invalid';

    try {
      expect(new AgentOsGatewayConfigService().value).toMatchObject({
        billing: 'free',
        rateLimit: 'disabled',
      });
    } finally {
      if (previousToken === undefined) {
        delete process.env.AGENT_OS_INTERNAL_TOKEN;
      } else {
        process.env.AGENT_OS_INTERNAL_TOKEN = previousToken;
      }
      if (previousWorkerUrl === undefined) {
        delete process.env.AGENT_OS_WORKER_URL;
      } else {
        process.env.AGENT_OS_WORKER_URL = previousWorkerUrl;
      }
    }
  });

  it('keeps every product route outside membership quota enforcement', () => {
    const prototype = AgentOsGatewayController.prototype as unknown as Record<
      string,
      unknown
    >;
    const handlers = Object.getOwnPropertyNames(prototype)
      .filter((name) => name !== 'constructor')
      .map((name) => prototype[name])
      .filter(
        (handler): handler is (...args: unknown[]) => unknown =>
          typeof handler === 'function',
      );

    expect(handlers.length).toBeGreaterThan(0);
    for (const handler of handlers) {
      expect(Reflect.getMetadata(QUOTA_METADATA_KEY, handler)).toBeUndefined();
    }
    expect(
      Reflect.getMetadata(QUOTA_METADATA_KEY, AgentOsGatewayController),
    ).toBeUndefined();
  });
});
