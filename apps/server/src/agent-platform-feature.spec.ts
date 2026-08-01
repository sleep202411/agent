import { loadAgentPlatformFeatureEnabled } from './agent-platform-feature';

describe('loadAgentPlatformFeatureEnabled', () => {
  it('requires an explicit migration decision in production', () => {
    expect(() =>
      loadAgentPlatformFeatureEnabled({ NODE_ENV: 'production' }),
    ).toThrow('AGENT_PLATFORM_ENABLED is required in production');
  });

  it('enables the complete Agent Platform boundary together', () => {
    expect(
      loadAgentPlatformFeatureEnabled({
        NODE_ENV: 'production',
        AGENT_PLATFORM_ENABLED: 'true',
      }),
    ).toBe(true);
  });

  it('keeps local boot independent until the new platform is selected', () => {
    expect(loadAgentPlatformFeatureEnabled({ NODE_ENV: 'development' })).toBe(
      false,
    );
  });
});
