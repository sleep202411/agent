import { type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import { EmergencyAccessBlockService } from '../auth/emergency-access-block.service';
import type { AuthUser } from '../auth/auth.types';
import {
  CrewQualificationCatalogController,
  CrewQualificationsService,
} from './crew-qualifications.service';

describe('Crew catalogue uses the verified session', () => {
  let app: INestApplication;
  let validate: jest.SpyInstance;
  let fetcher: jest.SpyInstance;
  const user = { userId: 'catalog-viewer' } as AuthUser;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [CrewQualificationCatalogController],
      providers: [
        AuthService,
        CrewQualificationsService,
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: EmergencyAccessBlockService,
          useValue: { assertAllowed: async () => undefined },
        },
      ],
    }).compile();
    validate = jest
      .spyOn(
        module.get(AuthService) as unknown as {
          validateSatoken(
            cookie: string,
            fingerprint: string,
          ): Promise<AuthUser | null>;
        },
        'validateSatoken',
      )
      .mockImplementation(async (cookie) =>
        cookie === 'satoken=valid-browser' || cookie === 'satoken=valid-mobile'
          ? user
          : null,
      );
    app = module.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
    validate.mockRestore();
  });
  beforeEach(() => {
    fetcher = jest
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (_url, init) => {
        const cookie = (init?.headers as Record<string, string>)?.Cookie;
        // Java rejects the expired/duplicate credential exactly as a logged-out request.
        return new Response(
          JSON.stringify(
            ['satoken=valid-browser', 'satoken=valid-mobile'].includes(cookie)
              ? {
                  code: 200,
                  data: [
                    { id: 777, name: 'FD-I', type: 1 },
                    { id: 950, name: 'Lighting', type: 4 },
                  ],
                }
              : { code: 302, msg: 'Not logged in!' },
          ),
          { status: 200 },
        );
      });
  });
  afterEach(() => fetcher.mockRestore());

  it.each([
    [
      'Cookie',
      'satoken=expired; satoken=valid-browser',
      'satoken=valid-browser',
    ],
    ['Authorization', 'Bearer valid-mobile', 'satoken=valid-mobile'],
    ['Cookie', 'satoken=valid-browser', 'satoken=valid-browser'],
  ])(
    'loads real controller/service catalogue using %s',
    async (header, credential, expectedCookie) => {
      const result = await request(app.getHttpServer() as Server)
        .get('/crew-qualification-catalog')
        .set(header, credential)
        .expect(200);
      expect(result.body).toEqual({ skills: ['FD-I', 'Lighting'] });
      expect(fetcher).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          headers: { Accept: 'application/json', Cookie: expectedCookie },
        }),
      );
    },
  );

  it('prefers the native credential over an unrelated browser session', async () => {
    await request(app.getHttpServer() as Server)
      .get('/crew-qualification-catalog')
      .set('Authorization', 'Bearer valid-mobile')
      .set('Cookie', 'satoken=expired')
      .expect(200);
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: { Accept: 'application/json', Cookie: 'satoken=valid-mobile' },
      }),
    );
  });

  it('does not call Java for unauthenticated requests', async () => {
    await request(app.getHttpServer() as Server)
      .get('/crew-qualification-catalog')
      .expect(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
