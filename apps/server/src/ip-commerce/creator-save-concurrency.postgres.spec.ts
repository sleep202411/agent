import { randomUUID } from 'node:crypto';
import { ConflictException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import type { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';
import { IpCommerceService } from './ip-commerce.service';

const databaseUrl = process.env.TASK01_TEST_DATABASE_URL;
const integration = databaseUrl ? describe : describe.skip;
jest.setTimeout(30000);

integration(
  'Creator IP saves reject concurrent stale drafts (owned PostgreSQL)',
  () => {
    let db: PrismaClient;
    let user: AuthUser;
    let ipId: string;
    let episodeId: string;
    let imageId: string;
    let termId: string;
    const service = (client: unknown = db) =>
      new IpCommerceService(
        client as PrismaService,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        {} as never,
      );
    beforeAll(async () => {
      const url = postgresFixtureUrl(databaseUrl!);
      if (
        !['127.0.0.1', 'localhost'].includes(url.hostname) ||
        url.port !== '55439' ||
        url.pathname !== '/task01'
      )
        throw new Error('Owned task01 fixture required');
      db = new PrismaClient({
        adapter: new PrismaPg({ connectionString: databaseUrl }),
        transactionOptions: { timeout: 15000 },
      });
      await db.$connect();
    });
    beforeEach(async () => {
      user = { userId: randomUUID() } as AuthUser;
      imageId = (
        await db.mediaAsset.create({
          data: {
            kind: 'image',
            status: 'ready',
            storageProvider: 'external_url',
            externalUrl: 'https://fixture.invalid/cover.png',
          },
        })
      ).id;
      termId = (
        await db.ipTaxonomyTerm.create({
          data: {
            type: 'genre',
            code: `save-fixture-${randomUUID()}`,
            localizations: {
              create: { locale: 'en-US', label: 'Fixture', aliases: [] },
            },
          },
        })
      ).id;
      const ip = await db.ip.create({
        data: {
          createdById: user.userId,
          sourceLocale: 'en-US',
          coverAssetId: imageId,
          channelType: 'ip',
          copyrightOwner: 'Fixture',
          rightsSummary: { statement: 'Fixture rights' },
          taxonomyAssignments: { create: { termId } },
          localizations: {
            create: {
              locale: 'en-US',
              title: 'Original',
              summary: 'Original summary',
            },
          },
          episodes: {
            create: {
              episodeNo: 1,
              createdById: user.userId,
              localizations: {
                create: { locale: 'en-US', title: 'Original episode' },
              },
            },
          },
        },
        include: { episodes: true },
      });
      ipId = ip.id;
      episodeId = ip.episodes[0].id;
    });
    afterEach(async () => {
      await db.ip.delete({ where: { id: ipId } });
      await db.ipTaxonomyTerm.delete({ where: { id: termId } });
      await db.mediaAsset.delete({ where: { id: imageId } });
    });
    afterAll(async () => {
      await db?.$disconnect();
    });

    it.each([
      'profile',
      'assets',
      'episode-create',
      'episode-edit',
      'pricing',
      'review',
    ])(
      'allows only one %s save from the same opening version',
      async (kind) => {
        // Hold both initial reads until each request has observed the same draft.
        let release!: () => void;
        const bothRead = new Promise<void>((resolve) => {
          release = resolve;
        });
        let reads = 0;
        const client = db.$extends({
          query: {
            ip: {
              async findFirst({ args, query }) {
                const result = await query(args);
                if (args.where?.id === ipId && reads < 2) {
                  reads += 1;
                  if (reads === 2) release();
                  await bothRead;
                }
                return result;
              },
            },
          },
        });
        const subject = service(client);
        const save = (title: string) => {
          switch (kind) {
            case 'review':
              return subject.submitCreatorIpForReview(user, ipId, {
                changeSummary: title,
                expectedVersion: 0,
              });
            case 'profile':
              return subject.updateCreatorIpProfile(user, ipId, {
                title,
                expectedVersion: 0,
              });
            case 'assets':
              return subject.updateCreatorIpAssets(user, ipId, {
                coverAssetId: null,
                expectedVersion: 0,
              });
            case 'episode-create':
              return subject.createCreatorIpEpisode(user, ipId, {
                title,
                expectedVersion: 0,
              });
            case 'episode-edit':
              return subject.updateCreatorIpEpisode(user, ipId, episodeId, {
                title,
                expectedVersion: 0,
              });
            default:
              return subject.upsertCreatorIpPriceRule(user, ipId, {
                targetType: 'ip',
                status: 'active',
                currency: 'community_point',
                amount: title === 'First' ? '10' : '20',
                priority: 100,
                expectedVersion: 0,
              });
          }
        };
        const results = await Promise.allSettled([
          save('First'),
          save('Second'),
        ]);
        expect(
          results.filter((result) => result.status === 'fulfilled'),
        ).toHaveLength(1);
        const rejected = results.find(
          (result) => result.status === 'rejected',
        ) as PromiseRejectedResult;
        expect(rejected.reason).toBeInstanceOf(ConflictException);
        if (!(rejected.reason instanceof ConflictException))
          throw new Error('Expected version conflict');
        expect(rejected.reason.getResponse()).toMatchObject({
          code: 'IP_VERSION_CONFLICT',
        });
        expect(
          (await db.ip.findUniqueOrThrow({ where: { id: ipId } })).version,
        ).toBe(1);
        if (kind === 'episode-create')
          expect(await db.ipEpisode.count({ where: { ipId } })).toBe(2);
        if (kind === 'review')
          expect(await db.ipReviewSubmission.count({ where: { ipId } })).toBe(
            1,
          );
        if (kind === 'pricing')
          expect(
            await db.ipPriceRule.count({ where: { ipId, archivedAt: null } }),
          ).toBe(1);
        // Refreshing the version allows a deliberate subsequent edit.
        await service().updateCreatorIpProfile(user, ipId, {
          title: 'Refreshed',
          expectedVersion: 1,
        });
        expect(
          (await db.ip.findUniqueOrThrow({ where: { id: ipId } })).version,
        ).toBe(2);
      },
    );
  },
);
