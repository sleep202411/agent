/**
 * Phase 2 (needs prod DATABASE_URL): apply DB writes from the gen manifest.
 *   - create rows: MediaAsset + published/public Ip (owner) + zh-CN IpLocalization + genre
 *   - update rows: ONLY swap the existing cover MediaAsset's image (keep coverAssetId,
 *                  do NOT touch the IP's taxonomy / localization)
 * Idempotent + resumable (results-3lang.json). Dry-run (no --write) validates that
 * update targets exist, owner exists, and genre terms are present — no writes.
 *
 *   tsx scripts/ip-3lang-commit.ts [--write] [--owner 15] [-c 10]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { PrismaClient } from '@prisma/client';

const repoRoot = resolve(__dirname, '../../..');
loadDotenv({ path: resolve(repoRoot, 'apps/server/.env'), override: false });
const OUT = resolve(__dirname, '../outputs/ip-bulk-seed');
const SOURCE_LOCALE = 'zh-CN';
const GENRES = [
  'sci_fi',
  'fantasy',
  'mystery',
  'romance',
  'adventure',
  'action',
  'comedy',
  'drama',
  'horror',
  'children',
  'education',
  'documentary',
];
const DEFAULT_GENRE = 'drama';

type PlanRow = {
  catalogNo: number;
  title: string;
  summary: string;
  ipId: string;
  coverAssetId: string;
  mode: 'create' | 'update';
};
type ManifestRow = {
  title: string;
  ipId: string;
  coverAssetId: string;
  mode: 'create' | 'update';
  objectKey: string;
  sizeBytes: number;
  width: number;
  height: number;
  contentType: string;
  ok: boolean;
};
type ResultRow = {
  title: string;
  status: 'committed' | 'failed';
  mode: string;
  ipId?: string;
  error?: string;
};

const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf-8')) as T;
const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
function seedUuid(kind: string, key: string): string {
  const h = createHash('sha1')
    .update(`ip-bulk-seed:${kind}:${key}`)
    .digest('hex');
  const b = h.slice(0, 32).split('');
  b[12] = '5';
  b[16] = ((parseInt(b[16], 16) & 0x3) | 0x8).toString(16);
  const s = b.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
async function pool<T>(items: T[], n: number, fn: (item: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const owner = (
    argv[argv.indexOf('--owner') + 1] ||
    process.env.OWNER_USER_ID ||
    '15'
  ).trim();
  const concurrency = Number(argv[argv.indexOf('-c') + 1]) || 10;

  const plan = readJson<PlanRow[]>(resolve(OUT, 'plan-3lang.json'));
  const manifest = readJson<ManifestRow[]>(
    resolve(OUT, 'manifest-3lang.json'),
  ).filter((m) => m.ok);
  const planByTitle = new Map(plan.map((p) => [p.title, p]));
  // genre by title from plan.json (classify output)
  const genreByTitle = new Map<string, string>();
  if (existsSync(resolve(OUT, 'plan.json')))
    for (const r of readJson<{ title: string; genre?: string }[]>(
      resolve(OUT, 'plan.json'),
    ))
      if (r.genre) genreByTitle.set(r.title, r.genre);

  const container = process.env.AZURE_BLOB_CONTAINER?.trim();
  if (!container) throw new Error('AZURE_BLOB_CONTAINER unset');

  const { buildPrisma } = (await import('../src/infra/db/db.module.js'))
    .default as {
    buildPrisma: () => PrismaClient;
  };
  const prisma = buildPrisma();

  const terms = await prisma.ipTaxonomyTerm.findMany({
    where: { type: 'genre', code: { in: GENRES } },
    select: { id: true, code: true },
  });
  const termIdByCode = new Map(terms.map((t) => [t.code, t.id]));

  const creates = manifest.filter((m) => m.mode === 'create');
  const updates = manifest.filter((m) => m.mode === 'update');

  if (!write) {
    // validate: update targets exist? owner exists? genre terms present?
    const existIps = await prisma.ip.findMany({
      where: { id: { in: updates.map((u) => u.ipId) } },
      select: { id: true },
    });
    const existAssets = await prisma.mediaAsset.findMany({
      where: { id: { in: updates.map((u) => u.coverAssetId) } },
      select: { id: true },
    });
    console.log(
      `DRY RUN — manifest ok=${manifest.length} (create=${creates.length} update=${updates.length})`,
    );
    console.log(`  owner (createdById string): ${owner}`);
    console.log(
      `  update IPs found in DB: ${existIps.length}/${updates.length}  | their MediaAssets found: ${existAssets.length}/${updates.length}`,
    );
    console.log(
      `  genre terms present: ${[...termIdByCode.keys()].length}/${GENRES.length}`,
    );
    const missingGenre = creates.filter(
      (c) => !genreByTitle.has(c.title),
    ).length;
    console.log(
      `  create rows missing a classified genre (→ ${DEFAULT_GENRE}): ${missingGenre}`,
    );
    if (existIps.length !== updates.length)
      console.log(
        '  ⚠️ some update IPs not in DB — they would be skipped or need create',
      );
    await prisma.$disconnect();
    return;
  }

  const RESULTS = resolve(OUT, 'results-3lang.json');
  const results: ResultRow[] = existsSync(RESULTS)
    ? readJson<ResultRow[]>(RESULTS)
    : [];
  const doneTitles = new Set(
    results.filter((r) => r.status === 'committed').map((r) => r.title),
  );
  const pending = manifest.filter((m) => !doneTitles.has(m.title));
  let okc = 0,
    failc = 0;
  console.log(
    `committing ${pending.length}/${manifest.length} (skip ${manifest.length - pending.length}) owner=${owner} c=${concurrency}`,
  );

  await pool(pending, concurrency, async (m) => {
    const p = planByTitle.get(m.title)!;
    try {
      if (m.mode === 'update') {
        await prisma.mediaAsset.update({
          where: { id: m.coverAssetId },
          data: {
            objectKey: m.objectKey,
            sizeBytes: BigInt(m.sizeBytes),
            width: m.width,
            height: m.height,
            contentType: m.contentType,
            status: 'ready',
            visibility: 'public',
            updatedAt: new Date(),
          },
        });
      } else {
        const now = new Date();
        const genreCode =
          genreByTitle.get(m.title) &&
          termIdByCode.has(genreByTitle.get(m.title)!)
            ? genreByTitle.get(m.title)!
            : DEFAULT_GENRE;
        const termId = termIdByCode.get(genreCode);
        await prisma.mediaAsset.upsert({
          where: { id: m.coverAssetId },
          update: {
            objectKey: m.objectKey,
            sizeBytes: BigInt(m.sizeBytes),
            status: 'ready',
            visibility: 'public',
            width: m.width,
            height: m.height,
            contentType: m.contentType,
          },
          create: {
            id: m.coverAssetId,
            kind: 'image',
            storageProvider: 'azure_blob',
            bucket: container,
            region: process.env.AZURE_BLOB_REGION?.trim() || null,
            objectKey: m.objectKey,
            contentType: m.contentType,
            sizeBytes: BigInt(m.sizeBytes),
            width: m.width,
            height: m.height,
            visibility: 'public',
            status: 'ready',
            source: 'imported',
            createdByUserId: owner,
          },
        });
        await prisma.$transaction(async (tx) => {
          await tx.ip.upsert({
            where: { id: m.ipId },
            update: {
              status: 'published',
              listingVisibility: 'public',
              coverAssetId: m.coverAssetId,
              updatedById: owner,
              publishedAt: now,
              aiDisclosure: { generatedVisuals: true },
            },
            create: {
              id: m.ipId,
              status: 'published',
              listingVisibility: 'public',
              sourceLocale: SOURCE_LOCALE,
              region: 'GLOBAL',
              coverAssetId: m.coverAssetId,
              createdById: owner,
              updatedById: owner,
              publishedAt: now,
              aiDisclosure: { generatedVisuals: true },
            },
          });
          await tx.ipLocalization.upsert({
            where: { ipId_locale: { ipId: m.ipId, locale: SOURCE_LOCALE } },
            update: {
              title: clamp(p.title, 80),
              summary: clamp(p.summary || p.title, 480),
              description: p.summary || null,
              status: 'published',
            },
            create: {
              id: seedUuid('loc3', m.title),
              ipId: m.ipId,
              locale: SOURCE_LOCALE,
              title: clamp(p.title, 80),
              summary: clamp(p.summary || p.title, 480),
              description: p.summary || null,
              status: 'published',
              publishedAt: now,
            },
          });
          if (termId) {
            await tx.ipTaxonomyAssignment.deleteMany({
              where: { ipId: m.ipId, term: { is: { type: 'genre' } } },
            });
            await tx.ipTaxonomyAssignment.create({
              data: {
                id: seedUuid('asg3', `${m.title}:${genreCode}`),
                ipId: m.ipId,
                termId,
                source: 'admin',
                displayOrder: 0,
                createdById: owner,
              },
            });
          }
        });
      }
      results.push({
        title: m.title,
        status: 'committed',
        mode: m.mode,
        ipId: m.ipId,
      });
      okc++;
      console.log(
        `  ✓ [${m.mode}] ${m.title} (${okc + failc}/${pending.length})`,
      );
    } catch (err) {
      results.push({
        title: m.title,
        status: 'failed',
        mode: m.mode,
        error: err instanceof Error ? err.message : String(err),
      });
      failc++;
      console.error(
        `  ✗ [${m.mode}] ${m.title}: ${err instanceof Error ? err.message : err}`,
      );
    }
    writeFileSync(RESULTS, JSON.stringify(results, null, 2));
  });
  console.log(`\nDONE commit ok=${okc} fail=${failc}. Results: ${RESULTS}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
});
