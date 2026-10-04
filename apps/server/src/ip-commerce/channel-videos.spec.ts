import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ChannelVideosService } from './channel-videos';
import type { AuthUser } from '../auth';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
const channel = '10000000-0000-4000-8000-000000000001';
const assetId = '10000000-0000-4000-8000-000000000002';
const creator = { userId: 'creator' } as AuthUser;
const owner = { userId: 'owner' } as AuthUser;
let db: import('@electric-sql/pglite').PGlite;
let service: ChannelVideosService;
let asset: Record<string, unknown> | null;
const storage = {
  createReadUrl: jest
    .fn()
    .mockResolvedValue({ url: 'https://fixture.invalid/video' }),
};
beforeEach(async () => {
  db = await PGlite.create();
  await db.exec(
    `CREATE TABLE ips(id uuid PRIMARY KEY,created_by_id text,channel_type text,status text DEFAULT 'published',listing_visibility text DEFAULT 'public',deleted_at timestamptz); INSERT INTO ips VALUES ('${channel}','owner','community','published','public',NULL); CREATE TABLE media_assets(id uuid PRIMARY KEY); INSERT INTO media_assets VALUES ('${assetId}'); CREATE TABLE ip_channel_submission_settings(ip_id uuid,open boolean); INSERT INTO ip_channel_submission_settings VALUES ('${channel}',true);`,
  );
  await db.exec(
    readFileSync(
      join(
        __dirname,
        '../../prisma/migrations/20261004210000_channel_video_submissions/migration.sql',
      ),
      'utf8',
    ),
  );
  asset = {
    id: assetId,
    createdByUserId: 'creator',
    source: 'user_upload',
    workspaceId: null,
    moderationStatus: 'approved',
  };
  const run = (p: TemplateStringsArray, ...v: unknown[]) =>
    db.query(
      p.reduce((s, x, i) => s + (i ? `$${i}` : '') + x, ''),
      v,
    );
  const adapter = {
    $queryRaw: async (p: TemplateStringsArray, ...v: unknown[]) =>
      (await run(p, ...v)).rows,
    $executeRaw: async (p: TemplateStringsArray, ...v: unknown[]) =>
      (await run(p, ...v)).affectedRows,
    ip: { findFirst: () => Promise.resolve({ createdById: 'owner' }) },
    mediaAsset: {
      findFirst: ({ where }: { where: Record<string, unknown> }) =>
        Promise.resolve(
          asset &&
            (!where.createdByUserId ||
              where.createdByUserId === asset.createdByUserId)
            ? asset
            : null,
        ),
    },
  };
  service = new ChannelVideosService(
    {
      ...adapter,
      $transaction: async (fn: (tx: typeof adapter) => Promise<unknown>) => {
        await db.exec('BEGIN');
        try {
          const result = await fn(adapter);
          await db.exec('COMMIT');
          return result;
        } catch (e) {
          await db.exec('ROLLBACK');
          throw e;
        }
      },
    } as never,
    { ensurePublicEngagementTarget: jest.fn() } as never,
    storage as never,
  );
});
afterEach(async () => {
  delete process.env.MEDIA_REQUIRE_MODERATION_APPROVAL;
  storage.createReadUrl.mockClear();
  await db.close();
});
const input = { assetId, title: 'My video', description: 'A short film' };
it('submits once, hides pending video from visitors, and publishes only after owner review', async () => {
  const row = await service.submit(channel, creator, input);
  expect((await service.submit(channel, creator, input)).id).toBe(row.id);
  expect((await service.list(channel)).items).toHaveLength(0);
  expect((await service.list(channel, creator)).items).toHaveLength(1);
  expect((await service.list(channel, owner)).items).toHaveLength(1);
  await expect(
    service.decide(channel, creator, {
      id: row.id,
      status: 'approved',
      expectedVersion: 0,
    }),
  ).rejects.toBeInstanceOf(NotFoundException);
  await service.decide(channel, owner, {
    id: row.id,
    status: 'approved',
    expectedVersion: 0,
  });
  expect((await service.list(channel)).items).toHaveLength(1);
  await expect(
    service.decide(channel, owner, {
      id: row.id,
      status: 'rejected',
      expectedVersion: 0,
    }),
  ).rejects.toBeInstanceOf(ConflictException);
});
it('rejects closed channels and videos owned by another account', async () => {
  asset!.createdByUserId = 'other';
  await expect(service.submit(channel, creator, input)).rejects.toBeInstanceOf(
    BadRequestException,
  );
  asset!.createdByUserId = 'creator';
  await db.exec('UPDATE ip_channel_submission_settings SET open=false');
  await expect(service.submit(channel, creator, input)).rejects.toBeInstanceOf(
    ConflictException,
  );
});
it('does not grant channel viewers access to workspace assets', async () => {
  asset!.workspaceId = 'workspace';
  await expect(service.submit(channel, creator, input)).rejects.toBeInstanceOf(
    BadRequestException,
  );
});
it('keeps platform moderation in force after channel approval', async () => {
  process.env.MEDIA_REQUIRE_MODERATION_APPROVAL = 'true';
  asset!.moderationStatus = 'unreviewed';
  const row = await service.submit(channel, creator, input);
  await service.decide(channel, owner, {
    id: row.id,
    status: 'approved',
    expectedVersion: 0,
  });
  expect((await service.list(channel)).items[0].url).toBeNull();
  expect(storage.createReadUrl).not.toHaveBeenCalled();
  expect((await service.list(channel, creator)).items[0].url).not.toBeNull();
});
