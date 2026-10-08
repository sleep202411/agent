import { GameAgentConfigService, gameAgentEnabled } from './game-agent.config';

const original = process.env;
afterEach(() => {
  process.env = original;
});

it('enables independently from Agent OS and rejects malformed flags', () => {
  expect(gameAgentEnabled({ AGENT_OS_ENABLED: 'true' })).toBe(false);
  expect(
    gameAgentEnabled({ GAME_AGENT_ENABLED: 'true', AGENT_OS_ENABLED: 'false' }),
  ).toBe(true);
  expect(() => gameAgentEnabled({ GAME_AGENT_ENABLED: 'yes' })).toThrow(
    'true or false',
  );
});

it('requires its own worker origin and token', () => {
  process.env = {
    AGENT_OS_WORKER_URL: 'http://agent-os:4301',
    AGENT_OS_INTERNAL_TOKEN: 'unrelated-secret-key',
  };
  expect(() => new GameAgentConfigService()).toThrow('GAME_AGENT_WORKER_URL');
  process.env = {
    GAME_AGENT_WORKER_URL: 'http://game-agent:4396',
    GAME_AGENT_INTERNAL_TOKEN: 'independent-test-token',
    GAME_AGENT_STUDIO_ORIGIN: 'https://fizzdragon.com',
  };
  expect(new GameAgentConfigService().value).toEqual({
    workerBaseUrl: 'http://game-agent:4396',
    internalToken: 'independent-test-token',
    studioOrigin: 'https://fizzdragon.com',
  });
});

it('rejects embedded credentials, paths and known placeholder secrets', () => {
  process.env = {
    GAME_AGENT_WORKER_URL: 'http://user:secret@game-agent:4396',
    GAME_AGENT_INTERNAL_TOKEN: 'independent-test-token',
    GAME_AGENT_STUDIO_ORIGIN: 'https://fizzdragon.com',
  };
  expect(() => new GameAgentConfigService()).toThrow('service origin');
  process.env.GAME_AGENT_WORKER_URL = 'http://game-agent:4396/subpath';
  expect(() => new GameAgentConfigService()).toThrow('service origin');
  process.env.GAME_AGENT_WORKER_URL = 'http://game-agent:4396';
  process.env.GAME_AGENT_INTERNAL_TOKEN = 'dev-only-change-me-16+';
  expect(() => new GameAgentConfigService()).toThrow('real secret');
});

it('requires an exact trusted Studio origin for hosted browser sessions', () => {
  process.env = {
    GAME_AGENT_WORKER_URL: 'http://game-agent:4396',
    GAME_AGENT_INTERNAL_TOKEN: 'independent-test-token',
  };
  expect(() => new GameAgentConfigService()).toThrow(
    'GAME_AGENT_STUDIO_ORIGIN',
  );
  for (const origin of [
    'http://fizzdragon.com',
    'https://fizzdragon.com/',
    'https://fizzdragon.com/path',
    'https://fizzdragon.com?source=studio',
    'https://person:secret@fizzdragon.com',
  ]) {
    process.env.GAME_AGENT_STUDIO_ORIGIN = origin;
    expect(() => new GameAgentConfigService()).toThrow('exact HTTPS origin');
  }
  process.env.GAME_AGENT_STUDIO_ORIGIN = 'http://localhost:9541';
  expect(new GameAgentConfigService().value.studioOrigin).toBe(
    'http://localhost:9541',
  );
});
