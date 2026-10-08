import {
  ForbiddenException,
  NotFoundException,
  type INestApplication,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthGuard, AuthService } from '../auth';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { GameAgentAppearanceController } from './game-agent-appearance.controller';
import { GameAgentWorkerClient } from './game-agent-worker.client';
import { GameAgentConfigService } from './game-agent.config';

const PROJECT = '019f60f4-b101-70d4-8000-000000000002';
const ID = '019f60f4-b101-70d4-8000-000000000003';
const ORIGIN = 'https://fizzdragon.com';
const opening = {
  action: 'open',
  key: '019f60f4-b101-70d4-8000-000000000004',
  leaseId: '019f60f4-b101-70d4-8000-000000000005',
  request: {
    requestId: '019f60f4-b101-70d4-8000-000000000006',
    prompt: 'Center the menu',
    locale: 'en-US',
    appearance: { version: 1 },
    context: { title: 'Untrusted title', choiceLabels: [] },
    history: [],
  },
  draft: 'Center the menu',
};

describe('hosted Harness browser admission', () => {
  let app: INestApplication;
  const permissions = { requireProject: jest.fn() };
  const worker = {
    controlAppearanceWeb: jest.fn(),
    designAppearance: jest.fn(),
  };
  const auth = {
    validateSessionContext: jest.fn((cookie: string) =>
      Promise.resolve(
        cookie === 'satoken=actor'
          ? { user: { userId: 'actor' }, cookie }
          : null,
      ),
    ),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [GameAgentAppearanceController],
      providers: [
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: AuthService, useValue: auth },
        { provide: StoryPermissionService, useValue: permissions },
        { provide: GameAgentWorkerClient, useValue: worker },
        {
          provide: GameAgentConfigService,
          useValue: { value: { studioOrigin: ORIGIN } },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    permissions.requireProject.mockResolvedValue({
      project: { title: 'Authorized project title' },
      capabilities: ['story.generate', 'story.edit'],
    });
    worker.controlAppearanceWeb.mockResolvedValue({
      id: ID,
      url: `/aurora/game-agent/projects/${PROJECT}/appearance/web/${ID}/`,
      leaseId: opening.leaseId,
      requestId: opening.request.requestId,
    });
  });

  function post(body: object, project = PROJECT) {
    return request(app.getHttpServer() as Server)
      .post(`/game-agent/projects/${project}/appearance/web`)
      .set('Cookie', 'satoken=actor')
      .set('Origin', ORIGIN)
      .send(body);
  }

  it('requires the existing FD session instead of accepting browser actor IDs', async () => {
    await request(app.getHttpServer() as Server)
      .post(`/game-agent/projects/${PROJECT}/appearance/web`)
      .set('Origin', ORIGIN)
      .send(opening)
      .expect(401);
    expect(worker.controlAppearanceWeb).not.toHaveBeenCalled();
  });

  it.each([
    { scope: { userId: 'another-user', projectId: PROJECT } },
    { parentOrigin: 'https://other.example' },
    { copy: { working: 'Untrusted', workingFor: 'Untrusted' } },
    { workspace: '/etc' },
  ])('rejects client trust metadata %j', async (metadata) => {
    await post({ ...opening, ...metadata }).expect(400);
    expect(worker.controlAppearanceWeb).not.toHaveBeenCalled();
  });

  it('rejects a forged or missing browser Origin', async () => {
    await post(opening).set('Origin', 'https://other.example').expect(403);
    await request(app.getHttpServer() as Server)
      .post(`/game-agent/projects/${PROJECT}/appearance/web`)
      .set('Cookie', 'satoken=actor')
      .send(opening)
      .expect(403);
    expect(worker.controlAppearanceWeb).not.toHaveBeenCalled();
  });

  it('binds the authenticated actor and existing project with its real title', async () => {
    await post(opening).expect(201);
    expect(permissions.requireProject).toHaveBeenCalledWith(
      'actor',
      PROJECT,
      'story.generate',
    );
    expect(worker.controlAppearanceWeb).toHaveBeenCalledWith(
      {
        ...opening,
        request: {
          ...opening.request,
          context: {
            ...opening.request.context,
            title: 'Authorized project title',
          },
        },
      },
      { userId: 'actor', projectId: PROJECT },
      expect.any(AbortSignal),
    );
  });

  it('rejects inaccessible projects before creating or polling a session', async () => {
    permissions.requireProject.mockRejectedValue(
      new NotFoundException('Story project not found.'),
    );
    await post({ action: 'poll', id: ID }).expect(404);
    expect(worker.controlAppearanceWeb).not.toHaveBeenCalled();
  });

  it('requires edit capability even when generation permission is present', async () => {
    permissions.requireProject.mockResolvedValue({
      project: { title: 'Story' },
      capabilities: ['story.generate'],
    });
    await post({ action: 'close', id: ID, leaseId: opening.leaseId }).expect(
      403,
    );
    expect(worker.controlAppearanceWeb).not.toHaveBeenCalled();
  });

  it('rechecks project authorization for poll and close and preserves expiry for reconnect', async () => {
    worker.controlAppearanceWeb.mockResolvedValueOnce({ result: null });
    await post({ action: 'poll', id: ID }).expect(201);
    worker.controlAppearanceWeb.mockRejectedValueOnce(
      new NotFoundException('Session expired.'),
    );
    await post({ action: 'poll', id: ID }).expect(404);
    worker.controlAppearanceWeb.mockRejectedValueOnce(
      new ForbiddenException('Session belongs to another project.'),
    );
    await post({ action: 'close', id: ID, leaseId: opening.leaseId }).expect(
      403,
    );
    expect(permissions.requireProject).toHaveBeenCalledTimes(3);
    expect(worker.controlAppearanceWeb).toHaveBeenNthCalledWith(
      3,
      { action: 'close', id: ID, leaseId: opening.leaseId },
      { userId: 'actor', projectId: PROJECT },
      expect.any(AbortSignal),
    );
  });
});
