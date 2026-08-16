import { FalHappyOysterConfig } from './fal-happy-oyster.config';

describe('FalHappyOysterConfig', () => {
  const originalEnabled = process.env.WORLD_MODEL_HAPPY_OYSTER_ENABLED;
  const originalApiKey = process.env.FAL_API_KEY;

  afterEach(() => {
    restoreEnv('WORLD_MODEL_HAPPY_OYSTER_ENABLED', originalEnabled);
    restoreEnv('FAL_API_KEY', originalApiKey);
  });

  it('stays unavailable without requiring a credential when explicitly disabled', () => {
    process.env.WORLD_MODEL_HAPPY_OYSTER_ENABLED = 'false';
    delete process.env.FAL_API_KEY;

    expect(new FalHappyOysterConfig()).toMatchObject({
      enabled: false,
      apiKey: null,
    });
  });

  it('fails at startup when the provider is enabled without its canonical key', () => {
    process.env.WORLD_MODEL_HAPPY_OYSTER_ENABLED = 'true';
    delete process.env.FAL_API_KEY;

    expect(() => new FalHappyOysterConfig()).toThrow(
      'WORLD_MODEL_HAPPY_OYSTER_ENABLED=true requires FAL_API_KEY.',
    );
  });

  it('accepts FAL_API_KEY as the single credential contract', () => {
    process.env.WORLD_MODEL_HAPPY_OYSTER_ENABLED = 'true';
    process.env.FAL_API_KEY = 'fal-key';

    expect(new FalHappyOysterConfig()).toMatchObject({
      enabled: true,
      apiKey: 'fal-key',
    });
  });
});

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
