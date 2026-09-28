import { postgresFixtureUrl } from '../common/__tests__/postgres-fixture-url';
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import type { PrismaService } from '../infra/db/db.module';
import type { AuthUser } from '../auth';
import { IpCommerceService } from './ip-commerce.service';
import { CreateAdminIpTaxonomyTermSchema } from './dto';
const databaseUrl =
  process.env.TASK01_TEST_DATABASE_URL ??
  (process.env.DATABASE_POSTGRES_INTEGRATION === '1'
    ? process.env.DATABASE_URL
    : undefined);
const integration = databaseUrl ? describe : describe.skip;
const applicationName = `taxonomy-admin-${randomUUID()}`;
jest.setTimeout(30000);
integration('Taxonomy administrator writes (owned PostgreSQL)', () => {
  let db: PrismaClient;
  const actor = { userId: randomUUID() } as AuthUser;
  let termId: string;
  let code: string;
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
      adapter: new PrismaPg({
        connectionString: databaseUrl,
        options: '-c timezone=UTC',
        application_name: applicationName,
      }),
      transactionOptions: { timeout: 15000 },
    });
    await db.$connect();
  });
  beforeEach(async () => {
    code = `fixture-${randomUUID()}`;
    termId = (
      await db.ipTaxonomyTerm.create({
        data: {
          code,
          type: 'genre',
          status: 'active',
          localizations: {
            create: { locale: 'en-US', label: 'Original', aliases: [] },
          },
        },
      })
    ).id;
  });
  afterEach(async () => {
    await db.ipTaxonomyTerm.deleteMany({
      where: { code: { startsWith: code } },
    });
  });
  afterAll(async () => {
    await db?.$disconnect();
  });
  const input = () =>
    CreateAdminIpTaxonomyTermSchema.parse({
      code: `${code}-new`,
      type: 'genre',
      localizations: [{ locale: 'en-US', label: 'New' }],
    });
  const write = (kind: string, client: unknown = db) =>
    kind === 'create'
      ? service(client).createAdminTaxonomyTerm(actor, input())
      : service(client).updateAdminTaxonomyTerm(actor, termId, {
          status: 'archived',
          displayOrder: 4,
          localizations: [
            { locale: 'en-US', label: 'Changed', aliases: ['Alias'] },
          ],
        });
  it('keeps one term for simultaneous same-code creation', async () => {
    const outcomes = await Promise.allSettled([
      write('create'),
      write('create'),
    ]);
    expect(outcomes.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    const rejected = outcomes.find((r) => r.status === 'rejected');
    expect(rejected).toMatchObject({
      status: 'rejected',
      reason: { status: 409 },
    });
    expect(
      await db.ipTaxonomyTerm.count({ where: { code: `${code}-new` } }),
    ).toBe(1);
  });
  it('persists current translations and the official actor identifier', async () => {
    await write('create');
    await write('update');
    const term = await db.ipTaxonomyTerm.findUniqueOrThrow({
      where: { id: termId },
      include: { localizations: true },
    });
    expect(term.status).toBe('archived');
    expect(term.localizations[0].label).toBe('Changed');
    expect(term.updatedById).toBe(actor.userId);
  });
  it('serializes overlapping translation edits without mixed batches', async () => {
    const edits = ['First', 'Second'].map((label, index) =>
      service().updateAdminTaxonomyTerm(actor, termId, {
        displayOrder: index,
        localizations: (index
          ? (['zh-CN', 'en-US'] as const)
          : (['en-US', 'zh-CN'] as const)
        ).map((locale) => ({ locale, label, aliases: [] })),
      }),
    );
    await Promise.all(edits);
    const term = await db.ipTaxonomyTerm.findUniqueOrThrow({
      where: { id: termId },
      include: { localizations: true },
    });
    const expected = term.displayOrder === 0 ? 'First' : 'Second';
    expect(term.localizations).toHaveLength(2);
    expect(term.localizations.every((value) => value.label === expected)).toBe(
      true,
    );
  });
});
