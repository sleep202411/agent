import { BailianConfigService } from './bailian-config.service';

describe('Bailian configuration', () => {
  const keys = [
    'BAILIAN_ENABLED',
    'BAILIAN_API_KEY',
    'DASHSCOPE_API_KEY',
  ] as const;
  const original = keys.map((key) => process.env[key]);

  beforeEach(() => {
    for (const key of keys) delete process.env[key];
  });

  afterEach(() => {
    keys.forEach((key, index) => {
      if (original[index] == null) delete process.env[key];
      else process.env[key] = original[index];
    });
  });

  it.each([undefined, '', '   '])(
    'rejects an enabled provider with missing key %p',
    (key) => {
      process.env.BAILIAN_ENABLED = 'true';
      if (key !== undefined) process.env.BAILIAN_API_KEY = key;
      expect(() => new BailianConfigService()).toThrow(
        'requires BAILIAN_API_KEY',
      );
    },
  );

  it('does not silently use the legacy SDK credential', () => {
    process.env.BAILIAN_ENABLED = 'true';
    process.env.DASHSCOPE_API_KEY = 'legacy-sdk-key';
    expect(() => new BailianConfigService()).toThrow(
      'requires BAILIAN_API_KEY',
    );
  });

  it('accepts the canonical credential', () => {
    process.env.BAILIAN_ENABLED = 'true';
    process.env.BAILIAN_API_KEY = ' test-only ';
    expect(new BailianConfigService().config.apiKey).toBe('test-only');
  });

  it('allows a disabled provider without credentials', () => {
    process.env.BAILIAN_ENABLED = 'false';
    expect(new BailianConfigService().config.enabled).toBe(false);
  });
});
