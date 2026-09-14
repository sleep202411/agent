import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { PGlite as PGliteDatabase } from '@electric-sql/pglite';
import type { Prisma } from '@prisma/client';
import { NotFoundException } from '@nestjs/common';
import {
  IpParamsSchema,
  ListAdminIpsQuerySchema,
  IpReferenceParamsSchema,
} from './dto';
import { IpCommerceService } from './ip-commerce.service';

const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
const ipId = '00000000-0000-4000-8000-000000000001';
const roomNumber = '100001';

describe('IP room number migration', () => {
  let db: PGliteDatabase;
  beforeAll(async () => {
    db = await PGlite.create();
    await db.exec(`CREATE TABLE ips (id text PRIMARY KEY, status text);
      INSERT INTO ips VALUES ('existing-published', 'published'), ('existing-draft', 'draft');`);
    await db.exec(
      readFileSync(
        join(
          __dirname,
          '../../prisma/migrations/20260909150000_ip_room_numbers/migration.sql',
        ),
        'utf8',
      ),
    );
  }, 30_000);
  afterAll(async () => {
    await db?.close();
  });

  it('backfills all existing IPs without changing their IDs or status', async () => {
    const { rows } = await db.query<{
      id: string;
      status: string;
      room_number: string;
    }>('SELECT * FROM ips ORDER BY id');
    expect(rows.map(({ id, status }) => ({ id, status }))).toEqual([
      { id: 'existing-draft', status: 'draft' },
      { id: 'existing-published', status: 'published' },
    ]);
    expect(new Set(rows.map((row) => row.room_number)).size).toBe(2);
    for (const row of rows) expect(row.room_number).toMatch(/^[1-9][0-9]+$/);
  });

  it('allocates unique strings for concurrent inserts and never reuses a deleted number', async () => {
    const rows = await Promise.all(
      Array.from({ length: 100 }, (_, i) =>
        db.query<{ room_number: string }>(
          'INSERT INTO ips(id) VALUES ($1) RETURNING room_number',
          [`new-${i}`],
        ),
      ),
    );
    const numbers = rows.map((row) => row.rows[0].room_number);
    expect(new Set(numbers).size).toBe(100);
    expect(numbers.every((number) => typeof number === 'string')).toBe(true);
    await db.exec("DELETE FROM ips WHERE id LIKE 'new-%'");
    const next = await db.query<{ room_number: string }>(
      "INSERT INTO ips(id) VALUES ('next') RETURNING room_number",
    );
    expect(numbers).not.toContain(next.rows[0].room_number);
  });

  it('rejects missing, malformed and duplicate numbers at the database boundary', async () => {
    for (const value of [
      null,
      '',
      '000001',
      '12a',
      '1.2',
      '-12',
      '12345678901234567890',
      '100001',
    ]) {
      await expect(
        db.query('INSERT INTO ips(id, room_number) VALUES ($1, $2)', [
          'invalid',
          value,
        ]),
      ).rejects.toThrow();
    }
  });
});

describe('IP room number access', () => {
  const findFirst = jest.fn<Promise<unknown>, [Prisma.IpFindFirstArgs]>();
  const entitlements = jest
    .fn<Promise<unknown[]>, [Prisma.IpContentEntitlementFindManyArgs]>()
    .mockResolvedValue([]);
  const findMany = jest
    .fn<Promise<unknown[]>, [Prisma.IpFindManyArgs]>()
    .mockResolvedValue([]);
  let service: IpCommerceService;
  beforeEach(() => {
    jest.clearAllMocks();
    service = Object.create(IpCommerceService.prototype) as IpCommerceService;
    Object.defineProperties(service, {
      prisma: {
        value: {
          ip: { findFirst, findMany },
          ipContentEntitlement: { findMany: entitlements },
          ipAclGrant: { findFirst: jest.fn().mockResolvedValue(null) },
          ipUserContentBlock: {
            findMany: jest
              .fn()
              .mockResolvedValue([
                { targetType: 'ip', targetId: 'blocked-ip' },
              ]),
          },
          ipEngagementAggregate: { findMany: jest.fn().mockResolvedValue([]) },
          ipCollectionItem: { groupBy: jest.fn().mockResolvedValue([]) },
          ipLike: { findMany: jest.fn().mockResolvedValue([]) },
        },
      },
      legacyCnVideo: {
        value: { resolveDtoVideos: jest.fn().mockResolvedValue(undefined) },
      },
    });
    findFirst.mockResolvedValue({
      id: ipId,
      roomNumber,
      status: 'published',
      listingVisibility: 'public',
      sourceLocale: 'en-US',
      ageRating: 'general',
      createdById: 'creator',
      localizations: [
        {
          locale: 'en-US',
          status: 'published',
          title: 'Test IP',
          summary: 'Summary',
          archivedAt: null,
        },
      ],
      priceRules: [],
      campaigns: [],
      episodes: [],
      contributors: [],
      taxonomyAssignments: [],
    });
  });

  it('reads by room number but uses the internal UUID for entitlements', async () => {
    const result = await service.getPublicIp(roomNumber, { userId: 'viewer' });
    expect(result.ip).toMatchObject({ id: ipId, roomNumber, title: 'Test IP' });
    const where = findFirst.mock.calls[0][0].where;
    expect(where).toMatchObject({
      roomNumber,
      deletedAt: null,
      listingVisibility: { in: ['public', 'unlisted'] },
      localizations: { some: { archivedAt: null } },
    });
    expect(where).not.toHaveProperty('id');
    expect(JSON.stringify(where)).toContain('blocked-ip');
    expect(entitlements.mock.calls[0][0].where).toMatchObject({
      ipId,
      userId: 'viewer',
    });
  });

  it('keeps UUID reads working and never treats a missing room as a legacy Java ID', async () => {
    expect((await service.getPublicIp(ipId)).ip.roomNumber).toBe(roomNumber);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({ id: ipId });
    findFirst.mockResolvedValue(null);
    await expect(service.getPublicIp('999999')).rejects.toThrow(
      NotFoundException,
    );
    expect(findFirst).toHaveBeenCalledTimes(2);
  });

  it('resolves creator previews by room number without relaxing edit permissions', async () => {
    findFirst.mockResolvedValue(null);
    await expect(
      service.getCreatorIp({ userId: 'viewer' }, roomNumber),
    ).rejects.toThrow(NotFoundException);
    expect(findFirst.mock.calls[0][0].where).toMatchObject({
      roomNumber,
      deletedAt: null,
      OR: [
        { createdById: 'viewer' },
        {
          aclGrants: {
            some: { userId: 'viewer', permission: 'edit', revokedAt: null },
          },
        },
      ],
    });
  });

  it('includes exact room numbers in admin search', async () => {
    await service.listAdminIps(
      ListAdminIpsQuerySchema.parse({ q: roomNumber }),
    );
    expect(findMany.mock.calls[0][0].where?.OR).toContainEqual({ roomNumber });
  });

  it('accepts room numbers on detail reads and preserves string precision', () => {
    for (const value of [ipId, roomNumber, '9007199254740993']) {
      expect(IpReferenceParamsSchema.parse({ ipId: value }).ipId).toBe(value);
    }
    expect(IpParamsSchema.safeParse({ ipId: roomNumber }).success).toBe(false);
    for (const value of ['', '01', '-1', '1e6', '1.5', 'abc', '1'.repeat(20)]) {
      expect(IpReferenceParamsSchema.safeParse({ ipId: value }).success).toBe(
        false,
      );
    }
  });
});
