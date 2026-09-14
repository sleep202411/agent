/**
 * Per-locale posters: for each IP, generate a poster per locale whose TEXT is
 * <locale language> + <region language> (dedup to one when they're the same /
 * both Chinese). Upload to Blob, create a MediaAsset, set IpLocalization.coverAssetId.
 * The trilingual Ip.coverAssetId stays as the fallback. Idempotent + resumable
 * (skips a (ip,locale) whose coverAssetId is already set); marks perlocale-todo.json.
 *
 *   DATABASE_URL=... tsx scripts/ip-3lang-perlocale.ts [--write] [--limit 10] [--owner 15] [-c 12]
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { BlobServiceClient } from '@azure/storage-blob';
import type { PrismaClient } from '@prisma/client';

const repoRoot = resolve(__dirname, '../../..');
loadDotenv({ path: resolve(repoRoot, 'apps/server/.env'), override: false });
const OUT = resolve(__dirname, '../outputs/ip-bulk-seed');
const TODO = resolve(OUT, 'perlocale-todo.json');
const LOCALES = ['zh-CN', 'en-US', 'zh-HK'] as const;
const LOCALE_LANG: Record<string, string> = {
  'zh-CN': '中文',
  'en-US': '英文',
  'zh-HK': '繁体中文',
};
const W = 1344,
  H = 768,
  CT = 'image/webp',
  FMT = 'webp';
const KEY = (process.env.FAL_API_KEY || process.env.FAL_KEY || '').trim();
const ENDPOINT = 'openai/gpt-image-2',
  QBASE = 'https://queue.fal.run';

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
function displayClause(locale: string, region: string): string {
  const ll = LOCALE_LANG[locale];
  const chineseRegion = region === '中文' || region === '繁体中文';
  const chineseLocale = locale === 'zh-CN' || locale === 'zh-HK';
  if (region === ll || (chineseLocale && chineseRegion)) return `${ll}显示`;
  return `${ll}和${region}双语显示，${ll}在上，${region}在下`;
}
function buildPrompt(
  title: string,
  locale: string,
  region: string,
  synopsis: string,
  strip: boolean,
): string {
  const syn = strip || !synopsis ? '' : ` 改编方向：${synopsis.slice(0, 260)}`;
  return `帮我制作一个影视海报，片名：${title}。${displayClause(locale, region)}，简约风格，文字仅有主题文字。${syn}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function falJson(
  url: string,
  init: RequestInit,
  a = 0,
): Promise<{ json: FalResponse; headers: Headers }> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Key ${KEY}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
    const text = await res.text().catch(() => '');
    if (res.status >= 500 && a < 3) {
      await sleep(1000 * (a + 1) ** 2);
      return falJson(url, init, a + 1);
    }
    if (!res.ok) throw new Error(`fal ${res.status}: ${text.slice(0, 160)}`);
    return {
      json: text ? (JSON.parse(text) as FalResponse) : {},
      headers: res.headers,
    };
  } catch (e) {
    if (a < 3) {
      await sleep(1000 * (a + 1) ** 2);
      return falJson(url, init, a + 1);
    }
    throw e;
  }
}
async function genPoster(
  prompt: string,
): Promise<{ url: string; billable: number | null }> {
  const { json: sub } = await falJson(`${QBASE}/${ENDPOINT}`, {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      image_size: { width: W, height: H },
      quality: 'high',
      num_images: 1,
      output_format: FMT,
    }),
  });
  const id = sub.request_id ?? sub.requestId;
  if (!id) throw new Error('no request_id');
  for (let i = 0; i < 240; i++) {
    await sleep(2500);
    const { json: st } = await falJson(
      `${QBASE}/${ENDPOINT}/requests/${id}/status`,
      { method: 'GET' },
    );
    const s = String(st.status ?? '').toUpperCase();
    if (s === 'COMPLETED') break;
    if (s === 'FAILED' || s === 'ERROR') throw new Error('fal ' + s);
    if (i === 239) throw new Error('poll timeout');
  }
  const { json: res, headers } = await falJson(
    `${QBASE}/${ENDPOINT}/requests/${id}`,
    { method: 'GET' },
  );
  const f = res.images?.[0];
  const url = typeof f === 'string' ? f : (f?.url ?? res.image?.url);
  if (!url) throw new Error('no url');
  const b = headers.get('x-fal-billable-units');
  return { url, billable: b != null ? Number(b) : null };
}
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
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
  const owner = (argv[argv.indexOf('--owner') + 1] || '15').trim();
  const limit = Number(argv[argv.indexOf('--limit') + 1]) || 10;
  const concurrency = Number(argv[argv.indexOf('-c') + 1]) || 12;
  if (!KEY) throw new Error('FAL_API_KEY unset');
  const container = process.env.AZURE_BLOB_CONTAINER!.trim();
  const blob = BlobServiceClient.fromConnectionString(
    process.env.AZURE_BLOB_CONNECTION_STRING!.trim(),
  ).getContainerClient(container);

  type Todo = {
    ipId: string;
    title: string;
    regionLang: string;
    perLocaleDone?: boolean;
  };
  const todo = JSON.parse(readFileSync(TODO, 'utf-8')) as Todo[];
  const plan = JSON.parse(
    readFileSync(resolve(OUT, 'plan-3lang.json'), 'utf-8'),
  ) as { ipId: string; summary: string }[];
  const synById = new Map(plan.map((p) => [p.ipId, p.summary]));
  const batch = todo.filter((t) => !t.perLocaleDone).slice(0, limit);
  console.log(
    `${write ? 'WRITE' : 'DRY'} — per-locale for ${batch.length} IPs (${batch.length * 3} posters max, dedup may reduce)`,
  );
  if (!write) {
    for (const t of batch)
      for (const l of LOCALES)
        console.log(`  [${t.title}/${l}] ${displayClause(l, t.regionLang)}`);
    return;
  }

  const { buildPrisma } = (await import('../src/infra/db/db.module')) as {
    buildPrisma: () => PrismaClient;
  };
  const prisma = buildPrisma();
  let ok = 0,
    fail = 0,
    cost = 0;
  for (const t of batch) {
    const locs = await prisma.ipLocalization.findMany({
      where: { ipId: t.ipId, locale: { in: [...LOCALES] } },
      select: { locale: true, title: true, coverAssetId: true },
    });
    const byLocale = new Map(locs.map((l) => [l.locale, l]));
    await pool([...LOCALES], concurrency, async (locale) => {
      const loc = byLocale.get(locale);
      if (!loc || loc.coverAssetId) return; // missing localization or already has per-locale cover
      try {
        let gen: Awaited<ReturnType<typeof genPoster>>;
        try {
          gen = await genPoster(
            buildPrompt(
              loc.title,
              locale,
              t.regionLang,
              synById.get(t.ipId) || '',
              false,
            ),
          );
        } catch (e) {
          if (String(e).includes('422'))
            gen = await genPoster(
              buildPrompt(loc.title, locale, t.regionLang, '', true),
            );
          else throw e;
        }
        const bytes = Buffer.from(await (await fetch(gen.url)).arrayBuffer());
        const assetId = seedUuid('locmedia', `${t.ipId}:${locale}`);
        const objectKey = `ip-bulk-seed/perlocale/${assetId}.${FMT}`;
        await blob
          .getBlockBlobClient(objectKey)
          .uploadData(bytes, { blobHTTPHeaders: { blobContentType: CT } });
        await prisma.mediaAsset.upsert({
          where: { id: assetId },
          update: {
            objectKey,
            sizeBytes: BigInt(bytes.length),
            status: 'ready',
            visibility: 'public',
            width: W,
            height: H,
            contentType: CT,
          },
          create: {
            id: assetId,
            kind: 'image',
            storageProvider: 'azure_blob',
            bucket: container,
            region: process.env.AZURE_BLOB_REGION?.trim() || null,
            objectKey,
            contentType: CT,
            sizeBytes: BigInt(bytes.length),
            width: W,
            height: H,
            visibility: 'public',
            status: 'ready',
            source: 'imported',
            createdByUserId: owner,
          },
        });
        await prisma.ipLocalization.updateMany({
          where: { ipId: t.ipId, locale },
          data: { coverAssetId: assetId },
        });
        if (gen.billable) cost += gen.billable;
        ok++;
        console.log(
          `  ✓ [${t.title}/${locale}] ${displayClause(locale, t.regionLang)}`,
        );
      } catch (e) {
        fail++;
        console.error(
          `  ✗ [${t.title}/${locale}]: ${e instanceof Error ? e.message : e}`,
        );
      }
    });
    t.perLocaleDone = true;
    writeFileSync(TODO, JSON.stringify(todo, null, 2));
  }
  console.log(
    `\nDONE per-locale ok=${ok} fail=${fail} cost≈$${cost.toFixed(2)}`,
  );
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
});

interface FalResponse {
  request_id?: string;
  requestId?: string;
  status?: string;
  images?: (string | { url?: string })[];
  image?: { url?: string };
}
