import type { INestApplication } from '@nestjs/common';
import { UnauthorizedException } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import {
  AdminAuthGuard,
  AdminAuthService,
  AdminPermissionGuard,
  type AdminActor,
} from '../admin-auth';
import { AuthGuard, AuthService } from '../auth';
import { StoryPublicationAdminController } from './story-publication-admin.controller';
import { StoryPublicationAdminService } from './story-publication-admin.service';

const GAME_ID = crypto.randomUUID();
const actor = {
  id: 'reviewer',
  siteScope: 'global',
  permissions: ['ip.moderate'],
} as AdminActor;

describe('Story publication admin HTTP boundary', () => {
  let app: INestApplication;
  const validateSession = jest.fn();
  const validateSessionContext = jest.fn();
  const listing = jest.fn();

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StoryPublicationAdminController],
      providers: [
        { provide: AuthService, useValue: { validateSessionContext } },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: AdminAuthService, useValue: { validateSession } },
        AdminAuthGuard,
        AdminPermissionGuard,
        { provide: StoryPublicationAdminService, useValue: { listing } },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => app?.close());
  beforeEach(() => {
    validateSession.mockReset().mockImplementation((token?: string) => {
      if (token !== 'reviewer-session') throw new UnauthorizedException();
      return actor;
    });
    validateSessionContext.mockReset();
    listing.mockReset().mockResolvedValue({
      contentVersion: 'candidate-v2',
      listing: { gameId: GAME_ID, description: 'Frozen candidate' },
    });
  });

  it.each([undefined, 'satoken=creator-session'])(
    'denies anonymous or creator sessions without an admin session (%s)',
    async (cookie) => {
      const req = request(app.getHttpServer() as Server).get(
        `/admin/story-publications/${GAME_ID}/listing?contentVersion=candidate-v2`,
      );
      if (cookie) req.set('Cookie', cookie);
      await req.expect(401);
      expect(listing).not.toHaveBeenCalled();
    },
  );

  it('denies an admin without moderation permission', async () => {
    validateSession.mockResolvedValue({ ...actor, permissions: ['ip.read'] });
    await request(app.getHttpServer() as Server)
      .get(
        `/admin/story-publications/${GAME_ID}/listing?contentVersion=candidate-v2`,
      )
      .set('Cookie', 'fd_admin_session=reviewer-session')
      .expect(403);
    expect(listing).not.toHaveBeenCalled();
  });

  it('returns an exact-version listing to a moderator without exposing a public route', async () => {
    const response = await request(app.getHttpServer() as Server)
      .get(
        `/admin/story-publications/${GAME_ID}/listing?contentVersion=candidate-v2`,
      )
      .set('Cookie', 'fd_admin_session=reviewer-session')
      .expect(200);
    expect(response.body).toEqual({
      code: 200,
      data: {
        contentVersion: 'candidate-v2',
        listing: { gameId: GAME_ID, description: 'Frozen candidate' },
      },
    });
    expect(response.headers['cache-control']).toBe('private, no-store');
    expect(listing).toHaveBeenCalledWith(actor, GAME_ID, 'candidate-v2');
    expect(validateSessionContext).not.toHaveBeenCalled();
  });

  it.each([
    '',
    '?contentVersion=',
    '?contentVersion=a&extra=b',
    '?contentVersion=a&contentVersion=b',
  ])('rejects a missing or malformed version query %s', async (query) => {
    await request(app.getHttpServer() as Server)
      .get(`/admin/story-publications/${GAME_ID}/listing${query}`)
      .set('Cookie', 'fd_admin_session=reviewer-session')
      .expect(400);
    expect(listing).not.toHaveBeenCalled();
  });

  it('accepts a legacy stable game ID and version for the no-snapshot response', async () => {
    listing.mockResolvedValue({ contentVersion: 'legacy_v1', listing: null });
    await request(app.getHttpServer() as Server)
      .get(
        '/admin/story-publications/legacyfilm_1/listing?contentVersion=legacy_v1',
      )
      .set('Cookie', 'fd_admin_session=reviewer-session')
      .expect(200)
      .expect({
        code: 200,
        data: { contentVersion: 'legacy_v1', listing: null },
      });
  });
});
