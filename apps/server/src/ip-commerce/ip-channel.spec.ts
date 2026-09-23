import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException } from '@nestjs/common';
import {
  CreateIpDraftSchema,
  ListIpsQuerySchema,
  ListPublicIpDiscoveryQuerySchema,
  UpdateIpChannelSchema,
} from './dto';
import { IpCommerceService } from './ip-commerce.service';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
it('defaults existing records to community without changing publication', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(
      "CREATE TABLE ips (id int, status text, listing_visibility text); INSERT INTO ips VALUES (1,'published','public'),(2,'draft','private');",
    );
    await db.exec(
      readFileSync(
        join(
          __dirname,
          '../../prisma/migrations/20260922100000_ip_channel_type/migration.sql',
        ),
        'utf8',
      ),
    );
    expect((await db.query('SELECT * FROM ips ORDER BY id')).rows).toEqual([
      {
        id: 1,
        status: 'published',
        listing_visibility: 'public',
        channel_type: 'community',
      },
      {
        id: 2,
        status: 'draft',
        listing_visibility: 'private',
        channel_type: 'community',
      },
    ]);
    await expect(
      db.exec("UPDATE ips SET channel_type = 'other'"),
    ).rejects.toThrow();
  } finally {
    await db.close();
  }
}, 30000);
it('validates category choices and requires an Admin version', () => {
  for (const channelType of ['ip', 'community']) {
    expect(
      CreateIpDraftSchema.safeParse({
        title: 'Test',
        genreCodes: ['drama'],
        sourceLocale: 'en-US',
        channelType,
      }).success,
    ).toBe(false);
  }
  expect(
    CreateIpDraftSchema.safeParse({
      title: 'Test',
      genreCodes: ['drama'],
      sourceLocale: 'en-US',
    }).success,
  ).toBe(true);
  expect(ListIpsQuerySchema.safeParse({ channelType: 'other' }).success).toBe(
    false,
  );
  expect(UpdateIpChannelSchema.safeParse({ channelType: 'ip' }).success).toBe(
    false,
  );
});
it.each(['ip', 'community'] as const)(
  'filters curated discovery by %s before loading',
  async (channelType) => {
    const findMany = jest.fn().mockResolvedValue([]);
    const service = Object.create(
      IpCommerceService.prototype,
    ) as IpCommerceService;
    Object.assign(service, {
      prisma: { ipDiscoveryRecommendation: { findMany } },
      viewerBlockWhere: jest.fn().mockResolvedValue({}),
      engagementStatsForIps: jest.fn().mockResolvedValue(new Map()),
    });
    await service.listPublicDiscovery(
      ListPublicIpDiscoveryQuerySchema.parse({
        channelType,
        placementKey: 'ip_plaza_hero',
      }),
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          ip: expect.objectContaining({
            channelType,
            status: 'published',
            listingVisibility: 'public',
            deletedAt: null,
          }) as unknown,
        }) as unknown,
      }),
    );
  },
);
it('reclassifies without changing publication and rejects stale versions', async () => {
  const updateMany = jest.fn().mockResolvedValue({ count: 1 });
  const tx = {
    ip: {
      updateMany,
      findUniqueOrThrow: jest.fn().mockResolvedValue({ channelType: 'ip' }),
    },
  };
  const service = Object.create(
    IpCommerceService.prototype,
  ) as IpCommerceService;
  Object.assign(service, {
    prisma: { $transaction: (fn: (t: typeof tx) => unknown) => fn(tx) },
  });
  await service.updateAdminIpChannel({ userId: 'admin' }, 'id', {
    channelType: 'ip',
    expectedVersion: 3,
  });
  expect(updateMany).toHaveBeenCalledWith({
    where: { id: 'id', deletedAt: null, version: 3 },
    data: {
      channelType: 'ip',
      updatedById: 'admin',
      version: { increment: 1 },
    },
  });
  updateMany.mockResolvedValue({ count: 0 });
  await expect(
    service.updateAdminIpChannel({ userId: 'admin' }, 'id', {
      channelType: 'community',
      expectedVersion: 3,
    }),
  ).rejects.toBeInstanceOf(ConflictException);
});

it('changes only the future default and preserves existing categories', async () => {
  const db = await PGlite.create();
  try {
    await db.exec(
      "CREATE TABLE ips (id int, channel_type text DEFAULT 'community'); INSERT INTO ips VALUES (1,'community'),(2,'ip');",
    );
    await db.exec(
      readFileSync(
        join(
          __dirname,
          '../../prisma/migrations/20260923143000_new_channels_default_ip/migration.sql',
        ),
        'utf8',
      ),
    );
    await db.exec('INSERT INTO ips(id) VALUES(3)');
    expect(
      (await db.query('SELECT channel_type FROM ips ORDER BY id')).rows,
    ).toEqual([
      { channel_type: 'community' },
      { channel_type: 'ip' },
      { channel_type: 'ip' },
    ]);
  } finally {
    await db.close();
  }
});
