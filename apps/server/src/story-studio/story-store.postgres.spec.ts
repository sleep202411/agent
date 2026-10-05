import { randomUUID } from 'node:crypto';
import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { AdminActor } from '../admin-auth';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { PrismaService } from '../infra/db/db.module';
import { StoryPublicationAdminService } from './story-publication-admin.service';
import { StoryPublicationAuthorityService } from './story-publication-authority.service';
import { StoryPublicationJavaService } from './story-publication-java.service';
import { StoryStoreService } from './story-store.service';

const url = process.env.TASK01_TEST_DATABASE_URL;

(url ? describe : describe.skip)(
  'Frozen store/review isolation (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    beforeAll(async () => {
      const target = postgresFixtureUrl(url!);
      if (
        target.hostname !== '127.0.0.1' ||
        target.port !== '55439' ||
        target.pathname !== '/task01'
      )
        throw new Error('Owned loopback fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: url }),
      });
      await db.$connect();
    });
    afterAll(async () => db?.$disconnect());
    afterEach(() => jest.restoreAllMocks());

    it('keeps review and public versions separate across draft edits, approval and withdrawal', async () => {
      const rollback = new Error('rollback isolated publication fixture');
      await expect(
        db.$transaction(
          async (tx) => {
            const workspace = await tx.workspace.create({
              data: {
                name: 'Store lifecycle fixture',
                ownerUserId: 'fixture',
                createdById: 'fixture',
              },
            });
            await tx.workspaceMember.create({
              data: {
                workspaceId: workspace.id,
                userId: 'fixture',
                role: 'owner',
                status: 'active',
              },
            });
            const project = await tx.storyProject.create({
              data: {
                workspaceId: workspace.id,
                title: 'Unreviewed working title',
                createdByUserId: 'fixture',
                frameProfile: 'landscape_16_9',
                writeState: { create: {} },
                members: {
                  create: {
                    userId: 'fixture',
                    role: 'owner',
                    status: 'active',
                    grantedByUserId: 'fixture',
                  },
                },
              },
            });
            const versions = [randomUUID(), randomUUID()];
            for (const [index, contentVersion] of versions.entries()) {
              await tx.storyExperienceGameRelease.create({
                data: {
                  storyProjectId: project.id,
                  gameId: project.id,
                  contentVersion,
                  requestHash: 'a'.repeat(64),
                  requestedByUserId: 'fixture',
                  listingSnapshot: {
                    title: `Frozen version ${index + 1}`,
                    defaultLocale: 'en-US',
                    coverAssetId: randomUUID(),
                    listing: {
                      description: `Reviewed introduction ${index + 1}`,
                      tags: [],
                      developer: '',
                      trailerAssetId: null,
                      screenshotAssetIds: [],
                    },
                  },
                },
              });
            }

            // Java remains external. Its public response and private review state are
            // controlled here; all local snapshot selection uses real Prisma queries.
            let publicVersion: string | null = versions[0];
            let publicFailure = false;
            const fetchMock = jest
              .spyOn(globalThis, 'fetch')
              .mockImplementation(() =>
                Promise.resolve(
                  new Response(
                    JSON.stringify(
                      publicFailure
                        ? { code: 503, msg: 'Authority unavailable' }
                        : publicVersion
                          ? {
                              code: 200,
                              data: {
                                gameId: project.id,
                                currentVersion: publicVersion,
                                status: 'published',
                              },
                            }
                          : { code: 404 },
                    ),
                    { status: publicFailure ? 503 : publicVersion ? 200 : 404 },
                  ),
                ),
              );
            const javaRead = jest.fn().mockResolvedValue({
              gameId: project.id,
              status: 'reviewing',
              draftVersion: versions[1],
              currentVersion: versions[0],
            });
            const store = new StoryStoreService(
              tx as unknown as PrismaService,
              new StoryPublicationAuthorityService(),
            );
            const review = new StoryPublicationAdminService(
              { read: javaRead } as unknown as StoryPublicationJavaService,
              store,
            );
            const admin = {
              id: 'reviewer',
              siteScope: 'all',
              permissions: ['ip.moderate'],
            } as AdminActor;

            const first = await store.getListing(project.id);
            expect(first).toMatchObject({
              title: 'Frozen version 1',
              description: 'Reviewed introduction 1',
            });
            const candidate = await review.listing(
              admin,
              project.id,
              versions[1],
            );
            expect(candidate.listing).toMatchObject({
              title: 'Frozen version 2',
              description: 'Reviewed introduction 2',
            });
            await expect(
              review.listing(admin, project.id, versions[0]),
            ).rejects.toBeInstanceOf(ConflictException);

            await tx.storyProject.update({
              where: { id: project.id },
              data: {
                title: 'Next unpublished draft',
                storeListing: { description: 'Not reviewed' },
              },
            });
            expect(await store.getListing(project.id)).toEqual(first);
            expect(
              (await review.listing(admin, project.id, versions[1])).listing,
            ).toEqual(candidate.listing);

            publicVersion = versions[1]!;
            javaRead.mockResolvedValue({
              gameId: project.id,
              status: 'published',
              currentVersion: publicVersion,
            });
            expect(await store.getListing(project.id)).toEqual(
              candidate.listing,
            );
            expect(
              (await review.listing(admin, project.id, publicVersion)).listing,
            ).toEqual(candidate.listing);
            expect(fetchMock).toHaveBeenCalled();

            publicFailure = true;
            await expect(store.getListing(project.id)).rejects.toBeInstanceOf(
              ServiceUnavailableException,
            );
            publicFailure = false;
            publicVersion = null;
            expect(await store.getListing(project.id)).toBeNull();

            // A stale upstream public version must not override a local archive.
            publicVersion = versions[1]!;
            await tx.storyProject.update({
              where: { id: project.id },
              data: { status: 'archived', archivedAt: new Date() },
            });
            expect(await store.getListing(project.id)).toBeNull();
            expect(
              (await review.listing(admin, project.id, publicVersion)).listing,
            ).toEqual(candidate.listing);
            throw rollback;
          },
          { timeout: 20_000 },
        ),
      ).rejects.toBe(rollback);
    });
  },
);
