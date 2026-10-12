import { Test } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import request from 'supertest';
import { AuthGuard } from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import type { Server } from 'node:http';
import type { INestApplication } from '@nestjs/common';
import { AppStoryEntryController } from './app-story-agent.controller';
import { AppStoryAgentService } from './app-story-agent.service';
import {
  AppStoryShellController,
  storyShellAsset,
} from './app-story-shell.controller';

describe('App Story hosted shell', () => {
  it('allows only generated assets and rejects path traversal', () => {
    for (const name of [
      'index.html',
      'app.js',
      'app.css',
      'chunks/player-A123.js',
      'experience-runtime/themes/core.film-dark.v1.json',
    ])
      expect(storyShellAsset(name)).toBe(name);
    for (const name of [
      '../.env',
      'chunks/../../secret.js',
      '%2e%2e/.env',
      'index.html?key=1',
      '/etc/passwd',
      'src/main.ts',
    ])
      expect(storyShellAsset(name)).toBeNull();
  });
  it('advertises an explicit disabled gate without a worker or credentials', () => {
    const previous = process.env.APP_STORY_AGENT_ENABLED;
    try {
      process.env.APP_STORY_AGENT_ENABLED = 'false';
      expect(new AppStoryShellController().config()).toEqual({
        code: 200,
        data: { enabled: false, path: '/aurora/app-story-agent/ui/index.html' },
      });
    } finally {
      if (previous === undefined) delete process.env.APP_STORY_AGENT_ENABLED;
      else process.env.APP_STORY_AGENT_ENABLED = previous;
    }
  });
});

// Exercise Nest's real wildcard routing and authentication around the built shell.
describe('App Story shell HTTP boundary', () => {
  it('serves authenticated assets without exposing arbitrary Server files', async () => {
    const previous = process.env.APP_STORY_AGENT_ENABLED;
    const entryId = '00000000-0000-4000-8000-000000000001';
    const createEntry = jest.fn().mockResolvedValue({
      ready: true,
      locale: 'en-US',
      projectId: entryId,
      chapterId: entryId,
    });
    const module = await Test.createTestingModule({
      controllers: [AppStoryShellController, AppStoryEntryController],
      providers: [{ provide: AppStoryAgentService, useValue: { createEntry } }],
    }).compile();
    const app = module.createNestApplication<INestApplication<Server>>();
    app.setGlobalPrefix('aurora');
    app.useGlobalGuards(
      new AuthGuard(
        {
          validateSessionContext: (cookie: string) =>
            Promise.resolve(
              cookie === 'satoken=fixture'
                ? { cookie, user: { id: 'fixture' } }
                : null,
            ),
        } as unknown as AuthService,
        new Reflector(),
      ),
    );
    await app.init();
    const httpServer = app.getHttpServer();
    try {
      process.env.APP_STORY_AGENT_ENABLED = 'true';
      const root = '/aurora/app-story-agent';
      await request(httpServer)
        .get(root + '/ui/index.html')
        .expect(401);
      await request(httpServer)
        .post(root + '/entry')
        .send({ entryId, locale: 'en-US', title: 'New story' })
        .expect(401);
      expect(createEntry).not.toHaveBeenCalled();
      await request(httpServer)
        .post(root + '/entry')
        .set('Cookie', 'satoken=fixture')
        .send({ entryId: 'invalid', locale: 'en-US', title: 'New story' })
        .expect(400);
      expect(createEntry).not.toHaveBeenCalled();
      await request(httpServer)
        .post(root + '/entry')
        .set('Cookie', 'satoken=fixture')
        .send({ entryId, locale: 'en-US', title: 'New story' })
        .expect(200);
      expect(createEntry).toHaveBeenCalledTimes(1);
      const result = await request(httpServer)
        .get(root + '/ui/index.html')
        .set('Cookie', 'satoken=fixture')
        .expect(200)
        .expect('Content-Type', /html/);
      expect(result.text).toContain('./app.js');
      expect(result.headers['set-cookie'][0]).toContain(
        'Path=/aurora/app-story-agent; HttpOnly; Secure; SameSite=Lax',
      );
      expect(result.headers['cache-control']).toBe('no-store');
      expect(result.headers['content-security-policy']).toContain(
        "frame-ancestors 'none'",
      );
      await request(httpServer)
        .get(root + '/ui/app.css')
        .set('Cookie', 'satoken=fixture')
        .expect(200)
        .expect('Content-Type', /css/);
      await request(httpServer)
        .get(root + '/ui/experience-runtime/themes/core.film-dark.v1.json')
        .set('Cookie', 'satoken=fixture')
        .expect(200)
        .expect('Content-Type', /json/);
      await request(httpServer)
        .get(root + '/ui/package.json')
        .set('Cookie', 'satoken=fixture')
        .expect(404);
      process.env.APP_STORY_AGENT_ENABLED = 'false';
      await request(httpServer)
        .get(root + '/ui/index.html')
        .set('Cookie', 'satoken=fixture')
        .expect(503);
    } finally {
      await app.close();
      if (previous === undefined) delete process.env.APP_STORY_AGENT_ENABLED;
      else process.env.APP_STORY_AGENT_ENABLED = previous;
    }
  });
});
