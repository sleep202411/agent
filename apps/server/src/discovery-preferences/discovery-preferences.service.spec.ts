import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import {
  DiscoveryPreferencesSchema,
  DiscoveryPreferenceUpdateSchema,
  discoveryLocalDay,
} from '@repo/shared/discovery-preferences';
import { DiscoveryPreferencesService } from './discovery-preferences.service';
const { PGlite } = process.getBuiltinModule('module').createRequire(__filename)(
  '@electric-sql/pglite',
) as typeof import('@electric-sql/pglite');
type Sql = Pick<import('@electric-sql/pglite').PGlite, 'query' | 'transaction'>;
function queryAdapter(sql: Pick<Sql, 'query'>) {
  const query = (
    parts: TemplateStringsArray | Prisma.Sql,
    ...values: unknown[]
  ) => {
    const stmt = Array.isArray(parts)
      ? Prisma.sql(parts as TemplateStringsArray, ...values)
      : (parts as Prisma.Sql);
    return sql.query(stmt.text, stmt.values);
  };
  return {
    $queryRaw: async (
      parts: TemplateStringsArray | Prisma.Sql,
      ...values: unknown[]
    ) => (await query(parts, ...values)).rows,
    $executeRaw: async (
      parts: TemplateStringsArray | Prisma.Sql,
      ...values: unknown[]
    ) => (await query(parts, ...values)).affectedRows,
  };
}
function adapter(sql: Sql) {
  return {
    ...queryAdapter(sql),
    $transaction: (
      run: (tx: ReturnType<typeof queryAdapter>) => Promise<unknown>,
    ) => sql.transaction((tx) => run(queryAdapter(tx))),
  };
}
const originalSite = process.env.NEXT_PUBLIC_SITE_REGION;
const user = { userId: 'owner' };
const preferences = {
  intents: ['support_nearby_ips', 'find_collaborators'] as const,
  interests: ['Animation', 'Film'],
  area: 'Singapore',
  locale: 'en-US',
  timeZone: 'Asia/Singapore',
  channels: { inApp: true, email: false },
};
let db: InstanceType<typeof PGlite>;
let service: DiscoveryPreferencesService;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(
    readFileSync(
      join(
        __dirname,
        '../..',
        'prisma/migrations/20261006170000_discovery_preferences/migration.sql',
      ),
      'utf8',
    ),
  );
  service = new DiscoveryPreferencesService(adapter(db) as never);
});
beforeEach(async () => {
  process.env.NEXT_PUBLIC_SITE_REGION = 'global';
  await db.exec('TRUNCATE discovery_daily_plans, discovery_preferences');
});
afterAll(async () => {
  await db.close();
  if (originalSite === undefined) delete process.env.NEXT_PUBLIC_SITE_REGION;
  else process.env.NEXT_PUBLIC_SITE_REGION = originalSite;
});
const update = (expectedRevision = 0, value: unknown = preferences) => ({
  mutationId: randomUUID(),
  expectedRevision,
  preferences: value,
});
it('starts without consent and persists user-scoped preferences across service instances', async () => {
  expect(await service.get(user)).toMatchObject({
    revision: 0,
    preferences: null,
    deliveryState: 'awaiting_design',
  });
  expect(await service.update(user, update())).toMatchObject({
    revision: 1,
    preferences,
  });
  expect(
    await new DiscoveryPreferencesService(adapter(db) as never).get(user),
  ).toMatchObject({ revision: 1 });
  expect(await service.get({ userId: 'other' })).toMatchObject({
    revision: 0,
    preferences: null,
  });
  process.env.NEXT_PUBLIC_SITE_REGION = 'cn';
  expect(await service.get(user)).toMatchObject({ site: 'cn', revision: 0 });
});
it('replays a lost save response without incrementing revision or reviving cancelled work', async () => {
  const command = update();
  const saved = await service.update(user, command);
  expect(await service.update(user, command)).toEqual(saved);
  await expect(
    service.update(user, {
      ...command,
      preferences: { ...preferences, area: 'Tokyo' },
    }),
  ).rejects.toThrow('different input');
});
it('allows only one concurrent save for an expected revision', async () => {
  const results = await Promise.allSettled([
    service.update(user, update()),
    service.update(user, update()),
  ]);
  expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
});
it('reserves a daily plan once under concurrent attempts without delivering anything', async () => {
  await service.update(user, update());
  const now = new Date('2026-10-06T18:00:00Z');
  const plans = await Promise.all([
    service.reserveDay(user, 1, now),
    service.reserveDay(user, 1, now),
  ]);
  expect(plans.filter(Boolean)).toEqual([
    { site: 'global', ownerId: 'owner', localDay: '2026-10-07', revision: 1 },
  ]);
  expect(
    await service.reserveDay(user, 1, new Date('2026-10-07T18:00:00Z')),
  ).toMatchObject({ localDay: '2026-10-08' });
});
it('clearing preferences cancels reservations and prevents stale saves from re-enabling consent', async () => {
  const original = update();
  await service.update(user, original);
  await service.reserveDay(user, 1);
  expect(await service.update(user, update(1, null))).toMatchObject({
    revision: 2,
    preferences: null,
  });
  expect(
    (await db.query('SELECT status FROM discovery_daily_plans')).rows,
  ).toEqual([{ status: 'cancelled' }]);
  expect(await service.reserveDay(user, 2)).toBeNull();
  await expect(service.update(user, original)).rejects.toThrow('changed');
  await expect(service.reserveDay(user, 1)).rejects.toThrow('changed');
});
it('does not reserve when both channels are off', async () => {
  await service.update(
    user,
    update(0, { ...preferences, channels: { inApp: false, email: false } }),
  );
  expect(await service.reserveDay(user, 1)).toBeNull();
});
it('changing timezone or opting in again cannot create another plan inside 24 hours', async () => {
  await service.update(user, update());
  const now = new Date('2026-10-06T23:00:00Z');
  await service.reserveDay(user, 1, now);
  await service.update(
    user,
    update(1, { ...preferences, timeZone: 'America/Los_Angeles' }),
  );
  expect(
    await service.reserveDay(user, 2, new Date('2026-10-07T00:00:00Z')),
  ).toBeNull();
});
it('requires explicit site and valid input without accepting client identity or email destinations', async () => {
  delete process.env.NEXT_PUBLIC_SITE_REGION;
  await expect(service.get(user)).rejects.toThrow('site must be configured');
  expect(
    DiscoveryPreferenceUpdateSchema.safeParse({ ...update(), ownerId: 'other' })
      .success,
  ).toBe(false);
  expect(
    DiscoveryPreferencesSchema.safeParse({
      ...preferences,
      email: 'other@example.com',
    }).success,
  ).toBe(false);
  expect(
    DiscoveryPreferencesSchema.safeParse({
      ...preferences,
      channels: undefined,
    }).success,
  ).toBe(false);
  expect(
    DiscoveryPreferencesSchema.safeParse({
      ...preferences,
      timeZone: 'not/a-zone',
    }).success,
  ).toBe(false);
  expect(
    DiscoveryPreferencesSchema.safeParse({
      ...preferences,
      interests: [' Film ', 'film'],
    }).success,
  ).toBe(false);
});
it('computes local calendar days across DST and international midnight boundaries', () => {
  expect(
    discoveryLocalDay(new Date('2026-10-06T18:00:00Z'), 'Asia/Singapore'),
  ).toBe('2026-10-07');
  expect(
    discoveryLocalDay(new Date('2026-03-08T07:30:00Z'), 'America/New_York'),
  ).toBe('2026-03-08');
  expect(
    discoveryLocalDay(new Date('2026-11-01T06:30:00Z'), 'America/New_York'),
  ).toBe('2026-11-01');
});
