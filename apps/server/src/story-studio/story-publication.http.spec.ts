import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AuthGuard, AuthService } from '../auth';
import { PrismaService } from '../infra/db/db.module';
import { PlatformAuditLogService } from '../workspaces';
import { canonicalJsonHash } from './canonical-json';
import { StoryPermissionService } from './story-permission.service';
import { StoryBuildService } from './story-build.service';
import { StoryPublicationController } from './story-publication.controller';
import { StoryPublicationJavaService } from './story-publication-java.service';
import { StoryPublicationService } from './story-publication.service';

const PROJECT = '019f60f4-b101-70d4-8000-000000000002';
const BUILD = '019f60f4-b101-70d4-8000-000000000011';
const candidate = {
  gameId: PROJECT,
  contentVersion: BUILD,
  title: 'Film',
  status: 'draft',
  setCurrent: true,
  manifest: {
    frozen: true,
    gameId: PROJECT,
    buildId: BUILD,
    contentVersion: BUILD,
  },
};

describe('Project publication HTTP boundary (real guard/controller/service, fixture Java)', () => {
  let app: INestApplication;
  const java = { read: jest.fn(), upload: jest.fn(), transition: jest.fn() };
  const audit = { record: jest.fn() };
  const permissions = { requireProject: jest.fn() };
  const builds = { getBuild: jest.fn() };
  const tx = {
    $queryRaw: jest.fn(),
    storyExperienceDraftRelease: { findFirst: jest.fn() },
    storyExperienceGameRelease: { findFirst: jest.fn() },
  };
  const prisma = {
    $transaction: (run: (value: typeof tx) => Promise<unknown>) => run(tx),
  };

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [StoryPublicationController],
      providers: [
        StoryPublicationService,
        { provide: StoryPublicationJavaService, useValue: java },
        { provide: StoryPermissionService, useValue: permissions },
        { provide: StoryBuildService, useValue: builds },
        { provide: PrismaService, useValue: prisma },
        { provide: PlatformAuditLogService, useValue: audit },
        {
          provide: AuthService,
          useValue: {
            validateSessionContext: (cookie: string) =>
              cookie.includes('expired')
                ? null
                : { user: { userId: cookie.split('=')[1] }, cookie },
          },
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
    }).compile();
    app = module.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => app.close());
  beforeEach(() => {
    jest.clearAllMocks();
    permissions.requireProject.mockImplementation(
      (userId: string, _id: string, capability: string) => {
        if (capability === 'story.release' && userId !== 'producer')
          throw new ForbiddenException({
            code: 'STORY_PERMISSION_DENIED',
            message: 'You do not have permission to perform this story action.',
          });
        return { project: { workspaceId: 'workspace-1' } };
      },
    );
    java.read.mockResolvedValue({
      gameId: PROJECT,
      status: 'draft',
      draftVersion: BUILD,
      creatorId: 'owner-not-actor',
      rejectReason: null,
    });
    java.upload.mockResolvedValue(undefined);
    java.transition.mockResolvedValue({
      gameId: PROJECT,
      status: 'reviewing',
      draftVersion: BUILD,
    });
    audit.record.mockResolvedValue(undefined);
    tx.$queryRaw.mockResolvedValue([{ acquired: true }]);
    tx.storyExperienceDraftRelease.findFirst.mockResolvedValue({
      requestHash: canonicalJsonHash(candidate),
      build: {
        id: BUILD,
        storyProjectId: PROJECT,
        status: 'ready',
        completedAt: new Date(),
        runtimeSchemaVersion: 2,
        runtimeJson: candidate.manifest,
        runtimeHash: canonicalJsonHash(candidate.manifest),
      },
    });
    tx.storyExperienceGameRelease.findFirst.mockResolvedValue(null);
    builds.getBuild.mockResolvedValue({
      id: BUILD,
      projectId: PROJECT,
      kind: 'production',
      status: 'ready',
      completedAt: new Date().toISOString(),
      runtimeSchemaVersion: 2,
      runtimeJson: candidate.manifest,
      runtimeHash: canonicalJsonHash(candidate.manifest),
      diagnostics: [],
    });
  });

  it.each(['missing', 'expired'])(
    'requires a valid user session for reads (%s)',
    async (kind) => {
      const r = request(app.getHttpServer() as Server).get(
        `/story-projects/${PROJECT}/publication`,
      );
      if (kind === 'expired') r.set('Cookie', 'satoken=expired');
      await r.expect(401);
      expect(java.read).not.toHaveBeenCalled();
    },
  );
  it('allows collaborator reads and filters the private Java detail', async () => {
    await request(app.getHttpServer() as Server)
      .get(`/story-projects/${PROJECT}/publication`)
      .set('Cookie', 'satoken=editor')
      .expect(200)
      .expect({
        code: 200,
        data: { gameId: PROJECT, status: 'draft', rejectReason: null },
      });
    expect(permissions.requireProject).toHaveBeenCalledWith(
      'editor',
      PROJECT,
      'story.read',
    );
  });
  it.each(['editor', 'viewer'])(
    'denies %s submission and offline before any Java access',
    async (role) => {
      await request(app.getHttpServer() as Server)
        .post(`/story-projects/${PROJECT}/publication/submit`)
        .set('Cookie', `satoken=${role}`)
        .send(candidate)
        .expect(403);
      await request(app.getHttpServer() as Server)
        .post(`/story-projects/${PROJECT}/publication/offline`)
        .set('Cookie', `satoken=${role}`)
        .send({})
        .expect(403);
      expect(java.read).not.toHaveBeenCalled();
      expect(java.upload).not.toHaveBeenCalled();
      expect(java.transition).not.toHaveBeenCalled();
    },
  );
  it('submits a producer candidate through both project and Java boundaries', async () => {
    await request(app.getHttpServer() as Server)
      .post(`/story-projects/${PROJECT}/publication/submit`)
      .set('Cookie', 'satoken=producer')
      .send(candidate)
      .expect(200)
      .expect({
        code: 200,
        data: { gameId: PROJECT, status: 'reviewing', rejectReason: null },
      });
    expect(java.upload).toHaveBeenCalledWith(
      candidate,
      'satoken=producer',
      expect.any(AbortSignal),
    );
    expect(java.transition).toHaveBeenCalledWith(
      PROJECT,
      'submit',
      expect.any(AbortSignal),
    );
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ actorUserId: 'producer' }),
    );
  });
  it.each(['approve', 'reject', 'force_offline'])(
    'does not expose the service moderation action %s',
    async (action) => {
      await request(app.getHttpServer() as Server)
        .post(`/story-projects/${PROJECT}/publication/offline`)
        .set('Cookie', 'satoken=producer')
        .send({ action })
        .expect(400);
      await request(app.getHttpServer() as Server)
        .post(`/story-projects/${PROJECT}/publication/submit`)
        .set('Cookie', 'satoken=producer')
        .send({ ...candidate, action })
        .expect(400);
      expect(java.read).not.toHaveBeenCalled();
      expect(java.transition).not.toHaveBeenCalled();
    },
  );
  it('rejects malformed project IDs before management access', async () => {
    await request(app.getHttpServer() as Server)
      .get('/story-projects/arbitrary-path/publication')
      .set('Cookie', 'satoken=viewer')
      .expect(400);
    expect(java.read).not.toHaveBeenCalled();
  });
});
