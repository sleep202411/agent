import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { ContentGpsMapController } from './content-gps-map';
import { RateLimitService } from '../common/throttle/rate-limit.service';

it('serves runtime config and routes nested Gaode SDK requests through the registered controller', async () => {
  const original = process.env;
  process.env = {
    ...original,
    NEXT_PUBLIC_SITE_REGION: 'cn',
    CONTENT_GPS_MAP_ENABLED: 'true',
    CONTENT_GPS_GAODE_KEY: 'browser-key',
    CONTENT_GPS_GAODE_SECURITY_CODE: 'private-secret',
  };
  const module = await Test.createTestingModule({
    controllers: [ContentGpsMapController],
    providers: [
      {
        provide: RateLimitService,
        useValue: { guard: jest.fn().mockResolvedValue({}) },
      },
    ],
  }).compile();
  const app = module.createNestApplication();
  const fetcher = jest
    .spyOn(globalThis, 'fetch')
    .mockResolvedValue(Response.json({ status: '1' }));
  try {
    await app.init();
    const config = await request(app.getHttpServer() as Server)
      .get('/ip-commerce/content-gps-map/config')
      .expect(200);
    expect((config.body as { data: { provider: string } }).data.provider).toBe(
      'gaode',
    );
    expect(config.headers['cache-control']).toBe('no-store');
    expect(JSON.stringify(config.body)).not.toContain('private-secret');
    await request(app.getHttpServer() as Server)
      .get(
        '/ip-commerce/content-gps-map/_AMapService/v4/map/styles?callback=ready',
      )
      .expect(200);
    expect((fetcher.mock.calls[0][0] as URL).hostname).toBe('webapi.amap.com');
    delete process.env.CONTENT_GPS_GAODE_SECURITY_CODE;
    await request(app.getHttpServer() as Server)
      .get('/ip-commerce/content-gps-map/config')
      .expect(503);
  } finally {
    await app.close();
    process.env = original;
    fetcher.mockRestore();
  }
});
