import { resolveLegacyOssBaseUrl } from './legacy-projects.config';

describe('LegacyProjectsConfigService', () => {
  it.each([{}, { LEGACY_OSS_BASE_URL: '' }, { LEGACY_OSS_BASE_URL: '   ' }])(
    'fails loudly when the region-owned OSS base is missing',
    (env) => {
      expect(() => resolveLegacyOssBaseUrl(env)).toThrow(
        'Missing required env var: LEGACY_OSS_BASE_URL',
      );
    },
  );

  it.each([
    'fizzstudio-sg.oss-ap-southeast-1.aliyuncs.com',
    '/relative/path',
    'ftp://example.com',
    'https://user:password@example.com',
    'https://example.com?region=cn',
    'https://example.com/#cn',
  ])('rejects invalid OSS base URL %p', (value) => {
    expect(() =>
      resolveLegacyOssBaseUrl({ LEGACY_OSS_BASE_URL: value }),
    ).toThrow('LEGACY_OSS_BASE_URL must be an absolute HTTP(S) URL');
  });

  it('normalizes whitespace and trailing slashes without changing the region host', () => {
    expect(
      resolveLegacyOssBaseUrl({
        LEGACY_OSS_BASE_URL:
          '  https://shotive.oss-cn-hangzhou.aliyuncs.com///  ',
      }),
    ).toBe('https://shotive.oss-cn-hangzhou.aliyuncs.com');
  });
});
