import {
  contentGpsMapConfig,
  gaodeProxyUrl,
  ContentGpsMapController,
} from './content-gps-map';
import type { RateLimitService } from '../common/throttle/rate-limit.service';
import type { Request, Response } from 'express';

const cn = {
  SITE_REGION: 'cn',
  CONTENT_GPS_MAP_ENABLED: 'true',
  CONTENT_GPS_GAODE_KEY: 'browser-key',
  CONTENT_GPS_GAODE_SECURITY_CODE: 'server-secret',
};
describe('regional map configuration and proxy', () => {
  const original = process.env;
  afterEach(() => {
    process.env = original;
    jest.restoreAllMocks();
  });
  it('returns only browser configuration, never the CN security code', () => {
    expect(contentGpsMapConfig(cn)).toEqual({
      provider: 'gaode',
      key: 'browser-key',
      securityProxyPath: '/aurora/ip-commerce/content-gps-map/_AMapService',
    });
    expect(JSON.stringify(contentGpsMapConfig(cn))).not.toContain(
      'server-secret',
    );
    expect(
      contentGpsMapConfig({
        SITE_REGION: 'global',
        CONTENT_GPS_MAP_ENABLED: 'true',
        CONTENT_GPS_GOOGLE_KEY: 'google-key',
        CONTENT_GPS_GOOGLE_MAP_ID: 'owned-map',
      }),
    ).toEqual({ provider: 'google', key: 'google-key', mapId: 'owned-map' });
  });
  it('fails explicitly for missing regional credentials or disabled maps', () => {
    for (const missing of [
      'CONTENT_GPS_MAP_ENABLED',
      'CONTENT_GPS_GAODE_KEY',
      'CONTENT_GPS_GAODE_SECURITY_CODE',
    ]) {
      expect(() => contentGpsMapConfig({ ...cn, [missing]: '' })).toThrow(
        'Map configuration missing',
      );
    }
    expect(() =>
      contentGpsMapConfig({ ...cn, CONTENT_GPS_MAP_ENABLED: 'false' }),
    ).toThrow('not enabled');
    expect(() => contentGpsMapConfig({ ...cn, SITE_REGION: 'global' })).toThrow(
      'CONTENT_GPS_GOOGLE_KEY',
    );
  });
  it('pins hosts and overwrites caller credentials without permitting path traversal', () => {
    for (const path of ['v4/map/styles', 'v4/map/lange', 'v3/log/init']) {
      const url = gaodeProxyUrl(
        path,
        'key=attacker&jscode=attacker&callback=mapReady',
        cn,
      );
      expect(url.hostname).toBe(
        path.startsWith('v4/map/') ? 'webapi.amap.com' : 'restapi.amap.com',
      );
      expect(url.searchParams.getAll('key')).toEqual(['browser-key']);
      expect(url.searchParams.getAll('jscode')).toEqual(['server-secret']);
    }
    for (const path of [
      '../admin',
      'v3/../admin',
      'v3/%2e%2e',
      '//evil.test',
      'https://evil.test',
    ])
      expect(() => gaodeProxyUrl(path, '', cn)).toThrow('Invalid map request');
  });
  it('forwards a bounded response, with no cookies or credentials forwarded from the caller', async () => {
    process.env = { ...cn };
    const guard = jest.fn().mockResolvedValue({});
    const controller = new ContentGpsMapController({
      guard,
    } as unknown as RateLimitService);
    const fetcher = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new globalThis.Response('{"ok":true}', {
        headers: {
          'content-type': 'application/json',
          'set-cookie': 'private=value',
        },
      }),
    );
    const response = { setHeader: jest.fn(), send: jest.fn() };
    await controller.gaode(
      ['v3', 'log', 'init'],
      { originalUrl: '/map?key=wrong', ip: '127.0.0.1' } as Request,
      response as unknown as Response,
    );
    expect(guard).toHaveBeenCalled();
    expect(fetcher.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    expect(fetcher.mock.calls[0][1]?.headers).toBeUndefined();
    expect(response.send).toHaveBeenCalledWith(Buffer.from('{"ok":true}'));
    expect(response.setHeader).not.toHaveBeenCalledWith(
      'set-cookie',
      expect.anything(),
    );
  });
  it('does not leak credential-bearing upstream errors or echoed secrets', async () => {
    process.env = { ...cn };
    const controller = new ContentGpsMapController({
      guard: jest.fn().mockResolvedValue({}),
    } as unknown as RateLimitService);
    const fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('https://example/?jscode=server-secret'));
    const run = () =>
      controller.gaode(
        'v3/log/init',
        { originalUrl: '/map', ip: '127.0.0.1' } as Request,
        {} as Response,
      );
    await expect(run()).rejects.toThrow('Map provider request failed');
    fetcher.mockResolvedValue(new globalThis.Response('server-secret'));
    await expect(run()).rejects.toThrow('Map provider request failed');
  });
});
