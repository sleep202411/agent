import { BytePlusAssetsClient } from './byteplus-assets-client';
import { BytePlusAssetsConfigService } from './byteplus-assets-config.service';

// Exercise construction, not a separate policy helper: this is the value used
// by CreateAsset for both character and canvas asset registration.
describe('BytePlus asset moderation by deployment cell', () => {
  const originalEnv = process.env;
  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of [
      'NEXT_PUBLIC_SITE_REGION',
      'SITE_REGION',
      'BYTEPLUS_ASSETS_MODERATION_STRATEGY',
      'CHARACTERS_REAL_PERSON_ENABLED',
      'CHARACTERS_AIGC_REGISTRATION_ENABLED',
      'MEDIA_ASSET_AIGC_REGISTRATION_ENABLED',
    ])
      delete process.env[key];
  });
  afterEach(() => {
    process.env = originalEnv;
    jest.restoreAllMocks();
  });

  it.each(['NEXT_PUBLIC_SITE_REGION', 'SITE_REGION'])(
    'defaults to moderation in CN using %s',
    (key) => {
      process.env[key] = 'cn';
      expect(
        new BytePlusAssetsConfigService().config.assetModerationStrategy,
      ).toBe('Default');
    },
  );
  it.each(['Skip', ' skip ', 'SKIP'])(
    'rejects CN bypass configuration %s',
    (value) => {
      process.env.NEXT_PUBLIC_SITE_REGION = 'cn';
      process.env.BYTEPLUS_ASSETS_MODERATION_STRATEGY = value;
      expect(() => new BytePlusAssetsConfigService()).toThrow(
        'not allowed in the cn deployment',
      );
    },
  );
  it('accepts an explicit Default in CN', () => {
    process.env.NEXT_PUBLIC_SITE_REGION = 'cn';
    process.env.BYTEPLUS_ASSETS_MODERATION_STRATEGY = ' Default ';
    expect(
      new BytePlusAssetsConfigService().config.assetModerationStrategy,
    ).toBe('Default');
  });
  it.each(['global', 'com'])(
    'preserves the existing %s configuration',
    (region) => {
      process.env.NEXT_PUBLIC_SITE_REGION = region;
      expect(
        new BytePlusAssetsConfigService().config.assetModerationStrategy,
      ).toBe('Skip');
      process.env.BYTEPLUS_ASSETS_MODERATION_STRATEGY = 'Default';
      expect(
        new BytePlusAssetsConfigService().config.assetModerationStrategy,
      ).toBe('Default');
    },
  );
  it('uses the same region precedence as the server cell', () => {
    process.env.NEXT_PUBLIC_SITE_REGION = 'cn';
    process.env.SITE_REGION = 'global';
    expect(
      new BytePlusAssetsConfigService().config.assetModerationStrategy,
    ).toBe('Default');
  });
  it('continues rejecting unknown moderation values', () => {
    process.env.NEXT_PUBLIC_SITE_REGION = 'cn';
    process.env.BYTEPLUS_ASSETS_MODERATION_STRATEGY = 'invalid';
    expect(() => new BytePlusAssetsConfigService()).toThrow(
      'must be either Default or Skip',
    );
  });
  it('sends Default on the signed CN CreateAsset request', async () => {
    process.env.NEXT_PUBLIC_SITE_REGION = 'cn';
    process.env.BYTEPLUS_ASSETS_AK = 'test-ak';
    process.env.BYTEPLUS_ASSETS_SK = 'test-sk';
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ Result: { Id: 'asset-1' } }), {
        status: 200,
      }),
    );
    const client = new BytePlusAssetsClient(new BytePlusAssetsConfigService());
    await expect(
      client.createAsset({
        groupId: 'group-1',
        url: 'https://example.test/image.png',
        assetType: 'Image',
      }),
    ).resolves.toEqual({ Id: 'asset-1' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = fetchMock.mock.calls[0]?.[1]?.body;
    expect(JSON.parse(String(body))).toMatchObject({
      Moderation: { Strategy: 'Default' },
    });
  });
});
