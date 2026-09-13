import { MiniMaxConfigService } from './minimax-config.service';

describe('MiniMax configuration', () => {
  const keys = [
    'MINIMAX_ENABLED',
    'MINIMAX_API_KEY',
    'MINIMAX_VIDEO_API_KEY',
  ] as const;
  const before = keys.map((key) => process.env[key]);
  beforeEach(() => {
    for (const key of keys) delete process.env[key];
  });
  afterEach(() => {
    keys.forEach((key, i) => {
      if (before[i] == null) delete process.env[key];
      else process.env[key] = before[i];
    });
  });
  it('fails startup when an enabled provider has no credential', () => {
    process.env.MINIMAX_ENABLED = 'true';
    expect(() => new MiniMaxConfigService()).toThrow(
      'requires MINIMAX_API_KEY',
    );
  });
  it('allows a deliberately disabled provider without credentials', () => {
    process.env.MINIMAX_ENABLED = 'false';
    expect(new MiniMaxConfigService().config.enabled).toBe(false);
  });
  it('rejects a mistyped feature gate', () => {
    process.env.MINIMAX_ENABLED = 'treu';
    expect(() => new MiniMaxConfigService()).toThrow('must be a boolean');
  });
  it('accepts the provisioned shared account', () => {
    process.env.MINIMAX_ENABLED = 'true';
    process.env.MINIMAX_API_KEY = 'test-only';
    expect(new MiniMaxConfigService().config.enabled).toBe(true);
  });
});
