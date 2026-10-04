import { ForbiddenException, type INestApplication } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { PrismaService } from '../infra/db/db.module';
import { PlatformAuditLogService } from '../workspaces';
import { canonicalJsonHash } from '../story-studio/canonical-json';
import { StoryPermissionService } from '../story-studio/story-permission.service';
import { StoryBuildService } from '../story-studio/story-build.service';
import { StoryPublicationController } from '../story-studio/story-publication.controller';
import { StoryPublicationJavaService } from '../story-studio/story-publication-java.service';
import { StoryPublicationService } from '../story-studio/story-publication.service';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import type { AuthUser } from './auth.types';
import { EmergencyAccessBlockService } from './emergency-access-block.service';

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

// Real session selection, HTTP guard, controller and publication service.
// Java, permissions, immutable receipt/build storage and audit are fixtures.
describe('Publication actor and selected session credential remain bound', () => {
  let app: INestApplication;
  let auth: AuthService;
  let check: jest.SpyInstance<Promise<AuthUser | null>, [string, string]>;
  const accounts = new Map<string, AuthUser>();
  const java = { read: jest.fn(), upload: jest.fn(), transition: jest.fn() };
  const permissions = { requireProject: jest.fn() };
  const audit = { record: jest.fn() };
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
        AuthService,
        StoryPublicationService,
        { provide: APP_GUARD, useClass: AuthGuard },
        {
          provide: EmergencyAccessBlockService,
          useValue: { assertAllowed: () => Promise.resolve() },
        },
        { provide: StoryPublicationJavaService, useValue: java },
        { provide: StoryPermissionService, useValue: permissions },
        { provide: StoryBuildService, useValue: builds },
        { provide: PrismaService, useValue: prisma },
        { provide: PlatformAuditLogService, useValue: audit },
      ],
    }).compile();
    auth = module.get(AuthService);
    check = jest
      .spyOn(
        auth as unknown as {
          validateSatoken: (
            cookie: string,
            fingerprint: string,
          ) => Promise<AuthUser | null>;
        },
        'validateSatoken',
      )
      .mockImplementation((cookie) =>
        Promise.resolve(accounts.get(cookie) ?? null),
      );
    app = module.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
  });
  afterAll(async () => {
    await app.close();
    check.mockRestore();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    accounts.clear();
    permissions.requireProject.mockImplementation(
      (userId: string, _id: string, capability: string) => {
        if (capability === 'story.release' && !userId.startsWith('producer-')) {
          throw new ForbiddenException({ code: 'STORY_PERMISSION_DENIED' });
        }
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

  async function submit(cookie: string, status = 200) {
    await request(app.getHttpServer() as Server)
      .post(`/story-projects/${PROJECT}/publication/submit`)
      .set('Cookie', cookie)
      .send(candidate)
      .expect(status);
  }
  function assertActor(userId: string, cookie: string) {
    const permissionCalls = permissions.requireProject.mock.calls as [
      string,
      string,
      string,
    ][];
    expect(permissionCalls.length).toBeGreaterThan(0);
    expect(permissionCalls.every(([actor]) => actor === userId)).toBe(true);
    expect(java.upload).toHaveBeenCalledTimes(1);
    const upload = java.upload.mock.calls[0] as [unknown, string, AbortSignal?];
    expect(upload[1]).toBe(cookie);
    const audits = audit.record.mock.calls as [{ actorUserId: string }][];
    expect(audits.length).toBeGreaterThan(0);
    expect(audits.every(([entry]) => entry.actorUserId === userId)).toBe(true);
    expect(java.transition).toHaveBeenCalledTimes(1);
  }

  it('skips an expired first token and uploads with only the verified producer token', async () => {
    accounts.set('satoken=fresh-producer', { userId: 'producer-fresh' });
    await submit('locale=zh-CN; satoken=expired; satoken=fresh-producer');
    expect(check.mock.calls.map(([cookie]) => cookie)).toEqual([
      'satoken=expired',
      'satoken=fresh-producer',
    ]);
    assertActor('producer-fresh', 'satoken=fresh-producer');
  });

  it('binds a later cached valid producer to upload and audit when both accounts are valid', async () => {
    accounts.set('satoken=valid-viewer-a', { userId: 'viewer-a' });
    accounts.set('satoken=valid-producer-b', { userId: 'producer-b' });
    await auth.validateToken('satoken=valid-producer-b');
    await submit(
      'analytics=unrelated; satoken=valid-viewer-a; satoken=valid-producer-b',
    );
    expect(check.mock.calls.map(([cookie]) => cookie)).toEqual([
      'satoken=valid-producer-b',
    ]);
    assertActor('producer-b', 'satoken=valid-producer-b');
  });

  it('denies a selected cached viewer even if the same header contains a valid producer', async () => {
    accounts.set('satoken=cached-viewer-c', { userId: 'viewer-c' });
    accounts.set('satoken=cached-producer-d', { userId: 'producer-d' });
    await auth.validateToken('satoken=cached-viewer-c');
    await auth.validateToken('satoken=cached-producer-d');
    await submit('satoken=cached-viewer-c; satoken=cached-producer-d', 403);
    expect(permissions.requireProject).toHaveBeenCalledWith(
      'viewer-c',
      PROJECT,
      'story.release',
    );
    expect(java.read).not.toHaveBeenCalled();
    expect(java.upload).not.toHaveBeenCalled();
    expect(java.transition).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });
});
