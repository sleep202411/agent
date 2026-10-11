import { AgentOsGatewayConfigService } from './agent-os-gateway.config';

describe('Agent OS mobile model configuration', () => {
  const keys = [
    'AGENT_OS_WORKER_URL',
    'AGENT_OS_INTERNAL_TOKEN',
    'AGENT_OS_MOBILE_CHAT_MODEL',
  ] as const;
  let previous: Array<string | undefined>;

  beforeEach(() => {
    previous = keys.map((key) => process.env[key]);
    process.env.AGENT_OS_WORKER_URL = 'http://worker.test.invalid';
    process.env.AGENT_OS_INTERNAL_TOKEN = 'test-only-agent-os-model-config';
  });

  afterEach(() =>
    keys.forEach((key, index) => {
      const value = previous[index];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }),
  );

  it.each([undefined, '', '   '])(
    'rejects a missing mobile model at boot (%s)',
    (value) => {
      if (value === undefined) delete process.env.AGENT_OS_MOBILE_CHAT_MODEL;
      else process.env.AGENT_OS_MOBILE_CHAT_MODEL = value;
      expect(() => new AgentOsGatewayConfigService()).toThrow(
        /AGENT_OS_MOBILE_CHAT_MODEL/,
      );
    },
  );

  it('uses the region-configured model without silently selecting Flash', () => {
    process.env.AGENT_OS_MOBILE_CHAT_MODEL = ' qwen3.7-plus ';
    expect(
      new AgentOsGatewayConfigService().value.mobileChatModelProfileId,
    ).toBe('qwen3.7-plus');
  });

  it('rejects an invalid profile id', () => {
    process.env.AGENT_OS_MOBILE_CHAT_MODEL = 'not a profile';
    expect(() => new AgentOsGatewayConfigService()).toThrow();
  });
});
