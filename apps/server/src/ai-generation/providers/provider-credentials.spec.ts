import { FalConfigService } from './fal/fal-config.service';
import { BytePlusConfigService } from './byteplus/byteplus-config.service';

describe.each([
  ['fal', FalConfigService, 'FAL_ENABLED', ['FAL_API_KEY', 'FAL_KEY']],
  [
    'BytePlus',
    BytePlusConfigService,
    'BYTEPLUS_MODELARK_ENABLED',
    ['BYTEPLUS_MODELARK_API_KEY', 'BYTEPLUS_API_KEY', 'ARK_API_KEY'],
  ],
] as const)('%s startup credentials', (_name, Config, flag, keys) => {
  const tracked = [flag, ...keys];
  const original = tracked.map((key) => process.env[key]);
  beforeEach(() => {
    for (const key of tracked) delete process.env[key];
  });
  afterEach(() => {
    tracked.forEach((key, index) => {
      if (original[index] === undefined) delete process.env[key];
      else process.env[key] = original[index];
    });
  });
  it.each([undefined, '', '   '])(
    'fails startup with absent credential %p',
    (value) => {
      process.env[flag] = 'true';
      if (value !== undefined) for (const key of keys) process.env[key] = value;
      expect(() => new Config()).toThrow(`requires ${keys[0]}`);
    },
  );
  it.each(keys)('accepts the supported credential %s', (key) => {
    process.env[flag] = 'true';
    process.env[key] = ' test-key ';
    expect(new Config().config.apiKey).toBe('test-key');
  });
  it('does not require credentials when disabled', () => {
    expect(new Config().config.enabled).toBe(false);
  });
});
