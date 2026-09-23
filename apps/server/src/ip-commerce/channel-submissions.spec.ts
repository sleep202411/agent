import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ChannelSubmissionsService } from './channel-submissions';
import type { AuthUser } from '../auth';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
const channel = '10000000-0000-4000-8000-000000000001';
const work = '10000000-0000-4000-8000-000000000002';
const owner = { userId: 'owner' } as AuthUser;
const creator = { userId: 'creator' } as AuthUser;
let db: import('@electric-sql/pglite').PGlite;
let service: ChannelSubmissionsService;
const query = (parts: TemplateStringsArray, ...values: unknown[]) =>
  db.query(
    parts.reduce((s, p, i) => s + (i ? `$${i}` : '') + p, ''),
    values,
  );
beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(
    `CREATE TABLE ips(id uuid PRIMARY KEY, created_by_id text, channel_type text, status text DEFAULT 'published', listing_visibility text DEFAULT 'public', deleted_at timestamptz); INSERT INTO ips(id,created_by_id,channel_type) VALUES ('${channel}','owner','community'),('${work}','creator','ip');`,
  );
  await db.exec(
    readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20260923144000_channel_submissions/migration.sql',
      ),
      'utf8',
    ),
  );
  const adapter = {
    $queryRaw: async (p: TemplateStringsArray, ...v: unknown[]) =>
      (await query(p, ...v)).rows,
    $executeRaw: async (p: TemplateStringsArray, ...v: unknown[]) =>
      (await query(p, ...v)).affectedRows,
    ip: { findFirst: () => Promise.resolve({ createdById: 'owner' }) },
  };
  const prisma = {
    ...adapter,
    $transaction: async (fn: (tx: typeof adapter) => Promise<unknown>) => {
      await db.exec('BEGIN');
      try {
        const value = await fn(adapter);
        await db.exec('COMMIT');
        return value;
      } catch (e) {
        await db.exec('ROLLBACK');
        throw e;
      }
    },
  };
  service = new ChannelSubmissionsService(
    prisma as never,
    {
      ensurePublicEngagementTarget: jest.fn(),
      getPublicIp: () =>
        Promise.resolve({ ip: { title: 'A work', roomNumber: '123' } }),
    } as never,
  );
});
afterEach(() => db.close());
it('requires the owner to open submissions', async () => {
  await expect(service.setOpen(channel, creator, true)).rejects.toBeInstanceOf(
    NotFoundException,
  );
  await service.setOpen(channel, owner, true);
  expect((await service.list(channel)).open).toBe(true);
});
it('rejects submissions while closed and accepts after opening', async () => {
  await expect(service.submit(channel, creator, work)).rejects.toBeInstanceOf(
    ConflictException,
  );
  await service.setOpen(channel, owner, true);
  expect(await service.submit(channel, creator, work)).toEqual({
    status: 'pending',
  });
  await expect(service.submit(channel, creator, work)).rejects.toBeInstanceOf(
    ConflictException,
  );
});
it.each([
  "status='draft'",
  "listing_visibility='private'",
  'deleted_at=now()',
  "created_by_id='other'",
])('rejects an ineligible work: %s', async (change) => {
  await service.setOpen(channel, owner, true);
  await db.exec(`UPDATE ips SET ${change} WHERE id='${work}'`);
  await expect(service.submit(channel, creator, work)).rejects.toBeInstanceOf(
    BadRequestException,
  );
});
it('hides pending work until owner approval and rejects unauthorized/stale decisions', async () => {
  await service.setOpen(channel, owner, true);
  await service.submit(channel, creator, work);
  expect((await service.list(channel)).items).toHaveLength(0);
  expect((await service.list(channel, creator)).items).toHaveLength(1);
  await expect(
    service.decide(channel, creator, {
      workId: work,
      status: 'approved',
      expectedVersion: 0,
    }),
  ).rejects.toBeInstanceOf(NotFoundException);
  await service.decide(channel, owner, {
    workId: work,
    status: 'approved',
    expectedVersion: 0,
  });
  expect((await service.list(channel)).items).toHaveLength(1);
  await expect(
    service.decide(channel, owner, {
      workId: work,
      status: 'rejected',
      expectedVersion: 0,
    }),
  ).rejects.toBeInstanceOf(ConflictException);
  await db.exec(`UPDATE ips SET status='draft' WHERE id='${work}'`);
  expect((await service.list(channel)).items).toHaveLength(0);
});
it('closing submissions keeps approved works visible', async () => {
  await service.setOpen(channel, owner, true);
  await service.submit(channel, creator, work);
  await service.decide(channel, owner, {
    workId: work,
    status: 'approved',
    expectedVersion: 0,
  });
  await service.setOpen(channel, owner, false);
  const result = await service.list(channel);
  expect(result.open).toBe(false);
  expect(result.items).toHaveLength(1);
});
it('never accepts the channel itself', async () => {
  await expect(service.submit(channel, owner, channel)).rejects.toBeInstanceOf(
    BadRequestException,
  );
});

it('permits explicitly authorized Admin review and records the reviewer', async () => {
  await service.setOpen(channel, owner, true);
  await service.submit(channel, creator, work);
  const admin = { userId: 'admin' } as AuthUser;
  await service.decide(
    channel,
    admin,
    { workId: work, status: 'approved', expectedVersion: 0 },
    true,
  );
  expect(
    (await db.query('SELECT reviewed_by_id FROM ip_channel_submissions')).rows,
  ).toEqual([{ reviewed_by_id: 'admin' }]);
});

it('rejects approval after the work is unpublished', async () => {
  await service.setOpen(channel, owner, true);
  await service.submit(channel, creator, work);
  await db.exec(`UPDATE ips SET status='draft' WHERE id='${work}'`);
  await expect(
    service.decide(channel, owner, {
      workId: work,
      status: 'approved',
      expectedVersion: 0,
    }),
  ).rejects.toBeInstanceOf(ConflictException);
});
