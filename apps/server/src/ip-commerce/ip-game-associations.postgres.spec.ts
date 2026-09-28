import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import { IpCommerceService } from './ip-commerce.service';
import { IpGameAssociationService } from './ip-game-associations';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.IP_GAME_POSTGRES_TEST === '1'
    ? process.env.DATABASE_URL
    : undefined);
(databaseUrl ? describe : describe.skip)(
  'Verified game associations (PostgreSQL)',
  () => {
    let db: PrismaClient;
    let ips: IpCommerceService;
    let service: IpGameAssociationService;
    let ipId: string;
    let gameId: string;
    let workspaceId: string;
    let memberId: string;
    let releaseId: string;
    const user = { userId: `game-owner-${randomUUID()}` };
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        !['localhost', '127.0.0.1'].includes(url.hostname) ||
        !(
          (url.port === '55439' && url.pathname === '/task01') ||
          (url.port === '5433' && url.pathname === '/fizzdragon_outbox_test')
        )
      )
        throw new Error('Named loopback database required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
        transactionOptions: { timeout: 15000 },
      });
      await db.$connect();
      ips = new IpCommerceService(
        db as PrismaService,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
        undefined as never,
      );
      service = new IpGameAssociationService(db as PrismaService, ips);
    });
    beforeEach(async () => {
      ipId = (
        await db.ip.create({
          data: {
            createdById: user.userId,
            status: 'published',
            listingVisibility: 'public',
            localizations: {
              create: {
                locale: 'en-US',
                title: 'Game IP',
                summary: 'Game IP',
                status: 'published',
              },
            },
          },
        })
      ).id;
      workspaceId = (
        await db.workspace.create({
          data: {
            name: 'Game test',
            ownerUserId: user.userId,
            createdById: user.userId,
            members: { create: { userId: user.userId, role: 'owner' } },
          },
        })
      ).id;
      gameId = (
        await db.$transaction(async (tx) => {
          const project = await tx.storyProject.create({
            data: {
              workspaceId,
              title: 'Confirmed game',
              frameProfile: 'landscape_16_9',
              createdByUserId: user.userId,
              sourceIpId: ipId,
              writeState: { create: {} },
            },
          });
          await tx.storyProjectMember.create({
            data: {
              storyProjectId: project.id,
              userId: user.userId,
              role: 'owner',
              grantedByUserId: user.userId,
            },
          });
          return project;
        })
      ).id;
      memberId = (
        await db.storyProjectMember.findUniqueOrThrow({
          where: {
            storyProjectId_userId: {
              storyProjectId: gameId,
              userId: user.userId,
            },
          },
        })
      ).id;
      releaseId = (
        await db.storyExperienceGameRelease.create({
          data: {
            storyProjectId: gameId,
            gameId,
            contentVersion: 'v1',
            requestHash: 'a'.repeat(64),
            status: 'confirmed',
            manifestUrl: 'https://example.com/game',
            publishedAt: new Date(),
            requestedByUserId: user.userId,
          },
        })
      ).id;
    });
    afterEach(async () => {
      jest.restoreAllMocks();
      if (!gameId) return;
      await db.ipGameAssociationRevision.deleteMany({ where: { gameId } });
      await db.storyExperienceGameRelease.deleteMany({
        where: { storyProjectId: gameId },
      });
      await db.storyProject.delete({ where: { id: gameId } });
      await db.workspace.delete({ where: { id: workspaceId } });
      await db.ip.delete({ where: { id: ipId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });
    async function transferOwner() {
      await db.workspaceMember.upsert({
        where: { id: randomUUID() },
        create: { workspaceId, userId: 'replacement-owner', role: 'editor' },
        update: {},
      });
      await db.$transaction(async (tx) => {
        await tx.storyProjectMember.update({
          where: { id: memberId },
          data: { role: 'viewer' },
        });
        await tx.storyProjectMember.create({
          data: {
            storyProjectId: gameId,
            userId: 'replacement-owner',
            role: 'owner',
            grantedByUserId: user.userId,
          },
        });
      });
    }
    const input = () => ({
      requestId: randomUUID(),
      expectedVersion: 0,
      active: true,
    });
    it('ignores unchecked sourceIpId, requires an explicit association, and preserves replay/history', async () => {
      expect(await service.resolve(gameId)).toEqual({ ipId: null });
      expect((await service.candidates(ipId, user)).items).toEqual([
        {
          gameId,
          title: 'Confirmed game',
          version: 0,
          linked: false,
          linkedElsewhere: false,
        },
      ]);
      const request = input();
      const results = await Promise.all([
        service.save(ipId, gameId, user, request),
        service.save(ipId, gameId, user, request),
      ]);
      expect(results[0]).toEqual(results[1]);
      expect(
        await db.ipGameAssociationRevision.count({ where: { gameId } }),
      ).toBe(1);
      expect(await service.resolve(gameId)).toEqual({ ipId });
      await expect(
        service.save(ipId, gameId, user, input()),
      ).rejects.toMatchObject({ status: 409 });
      await service.save(ipId, gameId, user, {
        requestId: randomUUID(),
        expectedVersion: 1,
        active: false,
      });
      expect(await service.resolve(gameId)).toEqual({ ipId: null });
      expect(
        await db.ipGameAssociationRevision.count({ where: { gameId } }),
      ).toBe(2);
    });
    it('requires both IP editing and explicit game ownership, not workspace administration', async () => {
      await expect(
        service.save(ipId, gameId, { userId: 'stranger' }, input()),
      ).rejects.toMatchObject({ status: 404 });
      await transferOwner();
      await expect(
        service.save(ipId, gameId, user, input()),
      ).rejects.toMatchObject({ status: 404 });
      expect((await service.candidates(ipId, user)).items).toEqual([]);
      await db.$transaction(async (tx) => {
        await tx.storyProjectMember.deleteMany({
          where: { storyProjectId: gameId, userId: 'replacement-owner' },
        });
        await tx.storyProjectMember.update({
          where: { id: memberId },
          data: { role: 'owner' },
        });
      });
      await db.ip.update({
        where: { id: ipId },
        data: { createdById: 'another-owner' },
      });
      await expect(
        service.save(ipId, gameId, user, input()),
      ).rejects.toMatchObject({ status: 404 });
    });
    it('rejects uncertain or revoked releases and hides private IP associations', async () => {
      await db.storyExperienceGameRelease.update({
        where: { id: releaseId },
        data: { status: 'uncertain' },
      });
      await expect(
        service.save(ipId, gameId, user, input()),
      ).rejects.toMatchObject({ status: 404 });
      await db.storyExperienceGameRelease.update({
        where: { id: releaseId },
        data: { status: 'confirmed' },
      });
      await service.save(ipId, gameId, user, input());
      await db.ip.update({
        where: { id: ipId },
        data: { listingVisibility: 'private' },
      });
      expect(await service.resolve(gameId)).toEqual({ ipId: null });
      await db.ip.update({
        where: { id: ipId },
        data: { listingVisibility: 'public' },
      });
      await db.storyExperienceGameRelease.update({
        where: { id: releaseId },
        data: {
          mediaAuthorizationRevokedAt: new Date(),
          status: 'rejected',
          rejectedAt: new Date(),
        },
      });
      expect(await service.resolve(gameId)).toEqual({ ipId: null });
    });
    it('rolls back inserted revisions when final authorization fails', async () => {
      const original = ips.requireEditableIp.bind(
        ips,
      ) as IpCommerceService['requireEditableIp'];
      let calls = 0;
      jest.spyOn(ips, 'requireEditableIp').mockImplementation((...args) => {
        calls++;
        return calls === 2
          ? Promise.reject(new ForbiddenException())
          : original(...args);
      });
      await expect(
        service.save(ipId, gameId, user, input()),
      ).rejects.toMatchObject({ status: 403 });
      expect(
        await db.ipGameAssociationRevision.count({ where: { gameId } }),
      ).toBe(0);
    });
    it('rejects membership removed while waiting for the association lock', async () => {
      let release!: () => void;
      let ready!: () => void;
      const held = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const blocker = db.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ip-game:${gameId}`},0))`;
        ready();
        await gate;
      });
      await held;
      const request = service.save(ipId, gameId, user, input());
      const outcome = expect(request).rejects.toMatchObject({ status: 404 });
      try {
        await transferOwner();
      } finally {
        release();
      }
      await blocker;
      await outcome;
      expect(
        await db.ipGameAssociationRevision.count({ where: { gameId } }),
      ).toBe(0);
    });
  },
);
