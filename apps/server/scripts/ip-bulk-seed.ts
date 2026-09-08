/**
 * IP bulk-seed — create public IPs from a single-column prompt Excel.
 *
 * One-off seed (mirrors ip-cn-migration.ts conventions). NOT an admin feature.
 * Pipeline, per row:
 *   1. (extract — done locally by ip-bulk-seed-extract.py → outputs/ip-bulk-seed/rows.json)
 *   2. classify  : LLM picks one genre per row → plan.json            (no DB)
 *   3. seed      : gpt-image-2 16:9 poster → Azure Blob → MediaAsset
 *                  → create PUBLISHED + PUBLIC Ip owned by OWNER_USER_ID
 *                  (dry-run unless --write)
 *
 * Run `classify` + `seed --write` INSIDE a .com server pod (it has the prod
 * DATABASE_URL + Azure Blob creds + FAL_API_KEY). Resumable: rows already
 * created (results.json) are skipped so re-runs don't re-bill posters.
 *
 *   tsx scripts/ip-bulk-seed.ts classify [--limit N] [--force]
 *   tsx scripts/ip-bulk-seed.ts seed [--write] [--limit N] [--owner <userId>]
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import { BlobServiceClient } from '@azure/storage-blob';
import type { PrismaClient } from '@prisma/client';

const repoRoot = resolve(__dirname, '../../..');
loadDotenv({ path: resolve(repoRoot, 'apps/server/.env'), override: false });

const OUT_DIR = resolve(__dirname, '../outputs/ip-bulk-seed');
const ROWS_FILE = resolve(OUT_DIR, 'rows.json');
const PLAN_FILE = resolve(OUT_DIR, 'plan.json');
const RESULTS_FILE = resolve(OUT_DIR, 'results.json');

// Only the genre codes guaranteed live in the seed taxonomy.
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
] as const;
const DEFAULT_GENRE = 'drama';

const SOURCE_LOCALE = 'zh-CN';
const POSTER_W = 1344;
const POSTER_H = 768; // 16:9 (both /16, 1.03MP, within fal gpt-image-2 limits)
const FAL_BASE =
  process.env.FAL_QUEUE_BASE_URL?.replace(/\/+$/, '') ||
  'https://queue.fal.run';
const FAL_ENDPOINT = 'openai/gpt-image-2';
const POSTER_SUFFIX = process.env.POSTER_PROMPT_SUFFIX?.trim() || ''; // prompts already say "影视海报"
// webp = smaller/faster on the plaza; png = crispest typography. Azure Blob stores any.
const POSTER_FORMAT = (
  process.env.POSTER_FORMAT?.trim() || 'webp'
).toLowerCase(); // png | jpeg | webp
const POSTER_QUALITY = process.env.POSTER_QUALITY?.trim() || 'high'; // auto | low | medium | high (cost driver)
const POSTER_CONTENT_TYPE = `image/${POSTER_FORMAT === 'jpg' ? 'jpeg' : POSTER_FORMAT}`;

type Row = {
  catalogNo: number;
  title: string;
  summary: string;
  posterLang: string | null;
  prompt: string;
};
type PlanRow = Row & { genre: string; region?: string };
type ResultRow = {
  catalogNo: number;
  title: string;
  status: 'created' | 'failed';
  ipId?: string;
  coverAssetId?: string;
  genre?: string;
  error?: string;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const readJson = <T>(p: string): T => JSON.parse(readFileSync(p, 'utf-8')) as T;
function writeJson(p: string, data: unknown) {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(p, JSON.stringify(data, null, 2));
}

/** Deterministic UUID v5-ish from a key, so re-runs upsert the same Ip / asset. */
function seedUuid(kind: string, key: string): string {
  const h = createHash('sha1')
    .update(`ip-bulk-seed:${kind}:${key}`)
    .digest('hex');
  const b = h.slice(0, 32).split('');
  b[12] = '5'; // version 5
  b[16] = ((parseInt(b[16], 16) & 0x3) | 0x8).toString(16); // variant
  const s = b.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

// ── classify ────────────────────────────────────────────────────────────────
async function classify(opts: { limit?: number; force: boolean }) {
  if (!existsSync(ROWS_FILE)) {
    throw new Error(`missing ${ROWS_FILE} — run ip-bulk-seed-extract.py first`);
  }
  if (existsSync(PLAN_FILE) && !opts.force) {
    console.log(
      `plan.json exists; pass --force to re-classify. (${PLAN_FILE})`,
    );
    return;
  }
  let rows = readJson<Row[]>(ROWS_FILE);
  if (opts.limit) rows = rows.slice(0, opts.limit);

  const plan: PlanRow[] = [];
  const CHUNK = 25;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const byNo = await classifyChunk(chunk);
    for (const r of chunk) {
      const g = byNo.get(r.catalogNo);
      plan.push({
        ...r,
        genre:
          g && (GENRES as readonly string[]).includes(g) ? g : DEFAULT_GENRE,
      });
    }
    console.log(
      `  classified ${Math.min(i + CHUNK, rows.length)}/${rows.length}`,
    );
  }
  writeJson(PLAN_FILE, plan);

  const dist: Record<string, number> = {};
  for (const p of plan) dist[p.genre] = (dist[p.genre] ?? 0) + 1;
  console.log(`wrote ${PLAN_FILE}`);
  console.log('genre distribution:', dist);
  for (const p of plan.slice(0, 8))
    console.log(`  [${p.catalogNo}] ${p.title} → ${p.genre}`);
}

async function classifyChunk(rows: Row[]): Promise<Map<number, string>> {
  const key = process.env.BAILIAN_API_KEY?.trim();
  const out = new Map<number, string>();
  if (!key) {
    console.warn('  BAILIAN_API_KEY unset — defaulting all to', DEFAULT_GENRE);
    return out;
  }
  const items = rows.map((r) => ({
    no: r.catalogNo,
    title: r.title,
    synopsis: clamp(r.summary, 300),
  }));
  const sys =
    `You classify short-drama synopses into EXACTLY ONE genre from this fixed list: ` +
    `${GENRES.join(', ')}. Reply ONLY JSON: {"assignments":[{"no":<catalogNo>,"genre":"<code>"}]}. ` +
    `Use the closest fit; if unsure use "drama". Codes must be from the list verbatim.`;
  try {
    const res = await fetch(
      'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: process.env.LLM_MODEL?.trim() || 'qwen-flash',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: sys },
            { role: 'user', content: JSON.stringify(items) },
          ],
        }),
      },
    );
    const body = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
      message?: string;
      code?: string;
    };
    if (!body.choices?.length) {
      console.warn('  LLM no choices:', JSON.stringify(body).slice(0, 160));
      return out;
    }
    const content = body.choices[0]?.message?.content ?? '';
    const json =
      content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1) || '{}';
    const parsed = JSON.parse(json) as {
      assignments?: { no: number; genre: string }[];
    };
    for (const a of parsed.assignments ?? [])
      out.set(Number(a.no), String(a.genre).trim());
  } catch (err) {
    console.warn(
      '  classify chunk failed, defaulting to',
      DEFAULT_GENRE,
      '-',
      errMsg(err),
    );
  }
  return out;
}

// ── seed ────────────────────────────────────────────────────────────────────
async function seed(opts: {
  write: boolean;
  limit?: number;
  owner?: string;
  concurrency?: number;
}) {
  if (!existsSync(PLAN_FILE))
    throw new Error(`missing ${PLAN_FILE} — run classify first`);
  let plan = readJson<PlanRow[]>(PLAN_FILE);
  if (opts.limit) plan = plan.slice(0, opts.limit);

  if (!opts.write) {
    console.log(
      `DRY RUN — ${plan.length} IPs would be created (published/public).`,
    );
    for (const p of plan.slice(0, 12)) {
      console.log(
        `  [${p.catalogNo}] "${clamp(p.title, 40)}" genre=${p.genre} promptLen=${p.prompt.length}`,
      );
    }
    if (plan.length > 12)
      console.log(
        `  …(${plan.length} total). Re-run with --write inside the .com pod.`,
      );
    return;
  }

  const owner = (opts.owner || process.env.OWNER_USER_ID || '').trim();
  if (!owner)
    throw new Error(
      'OWNER_USER_ID (business@fizzdragon.com user id) is required for --write',
    );
  const container = process.env.AZURE_BLOB_CONTAINER?.trim();
  const azureConn = process.env.AZURE_BLOB_CONNECTION_STRING?.trim();
  if (!container || !azureConn)
    throw new Error(
      'AZURE_BLOB_CONTAINER / AZURE_BLOB_CONNECTION_STRING unset',
    );
  if (!(process.env.FAL_API_KEY || process.env.FAL_KEY))
    throw new Error('FAL_API_KEY unset');

  const { buildPrisma } = (await import('../src/infra/db/db.module')) as {
    buildPrisma: () => PrismaClient;
  };
  const prisma = buildPrisma();
  const blob =
    BlobServiceClient.fromConnectionString(azureConn).getContainerClient(
      container,
    );

  // genre code -> term id (warn on any missing)
  const terms = await prisma.ipTaxonomyTerm.findMany({
    where: { type: 'genre', code: { in: [...GENRES] } },
    select: { id: true, code: true },
  });
  const termIdByCode = new Map(terms.map((t) => [t.code, t.id]));
  const missing = GENRES.filter((g) => !termIdByCode.has(g));
  if (missing.length)
    console.warn('WARN: genre terms not found in DB:', missing.join(', '));

  const results: ResultRow[] = existsSync(RESULTS_FILE)
    ? readJson<ResultRow[]>(RESULTS_FILE)
    : [];
  const doneNos = new Set(
    results.filter((r) => r.status === 'created').map((r) => r.catalogNo),
  );

  const concurrency = Math.max(1, opts.concurrency ?? 1);
  const pending = plan.filter((p) => !doneNos.has(p.catalogNo));
  const skipped = plan.length - pending.length;
  const samples: Sample[] = [];
  let created = 0;
  let failed = 0;
  console.log(
    `seeding ${pending.length} IPs (skip ${skipped}) concurrency=${concurrency} ${POSTER_FORMAT}/${POSTER_QUALITY} ${POSTER_W}x${POSTER_H}`,
  );

  const processRow = async (p: PlanRow): Promise<void> => {
    try {
      const ipId = seedUuid('ip', String(p.catalogNo));
      const fullPrompt = POSTER_SUFFIX
        ? `${p.prompt}\n${POSTER_SUFFIX}`
        : p.prompt;
      const gen = await generatePoster(fullPrompt);
      const bytes = Buffer.from(await (await fetch(gen.url)).arrayBuffer());

      const objectKey = `ip-bulk-seed/image/${dateParts()}/${seedUuid('obj', String(p.catalogNo))}.${POSTER_FORMAT}`;
      await blob.getBlockBlobClient(objectKey).uploadData(bytes, {
        blobHTTPHeaders: { blobContentType: POSTER_CONTENT_TYPE },
      });

      const coverAssetId = seedUuid('media', String(p.catalogNo));
      await prisma.mediaAsset.upsert({
        where: { id: coverAssetId },
        update: {
          objectKey,
          sizeBytes: BigInt(bytes.length),
          status: 'ready',
          visibility: 'public',
        },
        create: {
          id: coverAssetId,
          kind: 'image',
          storageProvider: 'azure_blob',
          bucket: container,
          region: process.env.AZURE_BLOB_REGION?.trim() || null,
          objectKey,
          contentType: POSTER_CONTENT_TYPE,
          sizeBytes: BigInt(bytes.length),
          width: POSTER_W,
          height: POSTER_H,
          visibility: 'public',
          status: 'ready',
          source: 'imported',
          createdByUserId: owner,
        },
      });

      const genreCode = termIdByCode.has(p.genre) ? p.genre : DEFAULT_GENRE;
      const termId = termIdByCode.get(genreCode);
      const now = new Date();
      const title = clamp(p.title, 80);
      const summary = clamp(p.summary || p.title, 280);

      await prisma.$transaction(async (tx) => {
        const region = p.region?.trim() || 'GLOBAL';
        await tx.ip.upsert({
          where: { id: ipId },
          update: {
            status: 'published',
            listingVisibility: 'public',
            coverAssetId,
            region,
            updatedById: owner,
            publishedAt: now,
            aiDisclosure: { generatedVisuals: true },
          },
          create: {
            id: ipId,
            status: 'published',
            listingVisibility: 'public',
            sourceLocale: SOURCE_LOCALE,
            region,
            coverAssetId,
            createdById: owner,
            updatedById: owner,
            publishedAt: now,
            aiDisclosure: { generatedVisuals: true },
          },
        });
        await tx.ipLocalization.upsert({
          where: { ipId_locale: { ipId, locale: SOURCE_LOCALE } },
          update: {
            title,
            summary,
            description: p.summary || null,
            status: 'published',
          },
          create: {
            id: seedUuid('loc', `${p.catalogNo}:${SOURCE_LOCALE}`),
            ipId,
            locale: SOURCE_LOCALE,
            title,
            summary,
            description: p.summary || null,
            status: 'published',
            publishedAt: now,
          },
        });
        if (termId) {
          await tx.ipTaxonomyAssignment.deleteMany({
            where: { ipId, term: { is: { type: 'genre' } } },
          });
          await tx.ipTaxonomyAssignment.create({
            data: {
              id: seedUuid('asg', `${p.catalogNo}:${genreCode}`),
              ipId,
              termId,
              source: 'admin',
              displayOrder: 0,
              createdById: owner,
            },
          });
        }
      });

      results.push({
        catalogNo: p.catalogNo,
        title: p.title,
        status: 'created',
        ipId,
        coverAssetId,
        genre: genreCode,
      });
      samples.push({
        ok: true,
        totalMs: gen.totalMs,
        submitMs: gen.submitMs,
        polls: gen.polls,
      });
      created++;
      console.log(
        `  ✓ [${p.catalogNo}] ${p.title} ip=${ipId} ${gen.totalMs}ms`,
      );
    } catch (err) {
      const m = errMsg(err);
      results.push({
        catalogNo: p.catalogNo,
        title: p.title,
        status: 'failed',
        error: m,
      });
      samples.push({ ok: false, status: statusFromErr(m), error: m });
      failed++;
      console.error(`  ✗ [${p.catalogNo}] ${p.title}: ${m}`);
    }
    writeJson(RESULTS_FILE, results); // checkpoint (resumable)
  };

  const t0 = Date.now();
  await runPool(pending, concurrency, processRow);
  const summary = summarize(samples, Date.now() - t0, concurrency);
  writeJson(resolve(OUT_DIR, 'metrics.json'), {
    at: new Date().toISOString(),
    kind: 'seed',
    ...summary,
  });
  console.log(
    `\nDONE — created=${created} failed=${failed} skipped=${skipped}. Results: ${RESULTS_FILE}`,
  );
  console.log('fal metrics:', JSON.stringify(summary, null, 2));
  await prisma.$disconnect();
}

type GenResult = {
  url: string;
  submitMs: number;
  totalMs: number;
  polls: number;
};

async function generatePoster(prompt: string): Promise<GenResult> {
  const key = (process.env.FAL_API_KEY || process.env.FAL_KEY || '').trim();
  const t0 = Date.now();
  const submit = await falFetch(`${FAL_BASE}/${FAL_ENDPOINT}`, key, {
    method: 'POST',
    body: JSON.stringify({
      prompt,
      image_size: { width: POSTER_W, height: POSTER_H },
      quality: POSTER_QUALITY,
      num_images: 1,
      output_format: POSTER_FORMAT,
    }),
  });
  const submitMs = Date.now() - t0;
  const requestId = (submit as { request_id?: string }).request_id;
  if (!requestId)
    throw new Error(
      `fal submit: no request_id (${JSON.stringify(submit).slice(0, 160)})`,
    );

  let polls = 0;
  for (let i = 0; i < 200; i++) {
    await sleep(2500);
    polls++;
    const st = (await falFetch(
      `${FAL_BASE}/${FAL_ENDPOINT}/requests/${requestId}/status`,
      key,
      {
        method: 'GET',
      },
    )) as { status?: string };
    const s = String(st.status ?? '').toUpperCase();
    if (s === 'COMPLETED') break;
    if (s === 'FAILED' || s === 'ERROR')
      throw new Error(`fal ${s}: ${JSON.stringify(st).slice(0, 160)}`);
    if (i === 199) throw new Error('fal poll timeout');
  }
  const res = (await falFetch(
    `${FAL_BASE}/${FAL_ENDPOINT}/requests/${requestId}`,
    key,
    { method: 'GET' },
  )) as {
    images?: ({ url?: string } | string)[];
    image?: { url?: string };
  };
  const first = res.images?.[0];
  const url =
    typeof first === 'string' ? first : (first?.url ?? res.image?.url);
  if (!url)
    throw new Error(`fal: no image url (${JSON.stringify(res).slice(0, 240)})`);
  return { url, submitMs, totalMs: Date.now() - t0, polls };
}

async function falFetch(
  url: string,
  key: string,
  init: RequestInit,
  attempt = 0,
): Promise<unknown> {
  const MAX = 3;
  let res: Response;
  try {
    res = await fetch(url, {
      ...init,
      headers: {
        Authorization: `Key ${key}`,
        'Content-Type': 'application/json',
        ...(init.headers ?? {}),
      },
    });
  } catch (err) {
    if (attempt < MAX) {
      await sleep(1000 * (attempt + 1) ** 2);
      return falFetch(url, key, init, attempt + 1);
    }
    throw err;
  }
  const text = await res.text().catch(() => '');
  // Transient 5xx (seen at higher concurrency) — retry the SAME call (no new job).
  if (res.status >= 500 && attempt < MAX) {
    await sleep(1000 * (attempt + 1) ** 2);
    return falFetch(url, key, init, attempt + 1);
  }
  if (!res.ok) throw new Error(`fal ${res.status}: ${text.slice(0, 160)}`);
  return text ? JSON.parse(text) : null;
}

function dateParts(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`;
}
function errMsg(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}
function statusFromErr(m: string): number | undefined {
  const x = /^fal (\d{3})/.exec(m);
  return x ? Number(x[1]) : undefined;
}

// ── metrics + pool (fal throughput / concurrency benchmark) ──────────────────
type Sample = {
  ok: boolean;
  totalMs?: number;
  submitMs?: number;
  polls?: number;
  status?: number;
  error?: string;
};

async function runPool<T>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<void>,
) {
  let next = 0;
  const worker = async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i], i);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, worker),
  );
}

function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  return sorted[
    Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  ];
}

function summarize(samples: Sample[], wallMs: number, concurrency: number) {
  const ok = samples.filter((s) => s.ok);
  const lat = ok.map((s) => s.totalMs ?? 0).sort((a, b) => a - b);
  const sub = ok.map((s) => s.submitMs ?? 0).sort((a, b) => a - b);
  const errors: Record<string, number> = {};
  for (const s of samples.filter((x) => !x.ok)) {
    const k = s.status ? `http_${s.status}` : (s.error ?? 'error').slice(0, 48);
    errors[k] = (errors[k] ?? 0) + 1;
  }
  const wallSec = wallMs / 1000;
  return {
    concurrency,
    total: samples.length,
    ok: ok.length,
    failed: samples.length - ok.length,
    wallSec: +wallSec.toFixed(1),
    throughputPerMin:
      wallSec > 0 ? +((ok.length / wallSec) * 60).toFixed(2) : 0,
    latencyMs: {
      min: lat[0] ?? 0,
      p50: pct(lat, 50),
      p90: pct(lat, 90),
      p95: pct(lat, 95),
      max: lat[lat.length - 1] ?? 0,
    },
    submitMs: { p50: pct(sub, 50), p95: pct(sub, 95) },
    errors,
  };
}

// Pure fal load test — NO DB. Generates n posters at the given concurrency.
async function bench(opts: { n?: number; concurrency?: number }) {
  if (!(process.env.FAL_API_KEY || process.env.FAL_KEY))
    throw new Error('FAL_API_KEY unset');
  const n = opts.n ?? 8;
  const concurrency = Math.max(1, opts.concurrency ?? 4);
  const prompts: string[] = existsSync(PLAN_FILE)
    ? readJson<PlanRow[]>(PLAN_FILE).map((p) => p.prompt)
    : ['帮我制作一个影视海报，片名：测试。简约风格，中英双语，仅主题文字。'];

  console.log(
    `fal bench — n=${n} concurrency=${concurrency} ${FAL_ENDPOINT} ${POSTER_W}x${POSTER_H} ${POSTER_QUALITY}/${POSTER_FORMAT}`,
  );
  const samples: Sample[] = new Array<Sample>(n);
  const urls: string[] = [];
  const t0 = Date.now();
  await runPool([...Array(n).keys()], concurrency, async (k, i) => {
    try {
      const g = await generatePoster(prompts[k % prompts.length]);
      samples[i] = {
        ok: true,
        totalMs: g.totalMs,
        submitMs: g.submitMs,
        polls: g.polls,
      };
      urls.push(g.url);
      console.log(
        `  ✓ #${k} ${g.totalMs}ms (submit ${g.submitMs}ms, ${g.polls} polls) ${g.url}`,
      );
    } catch (err) {
      const m = errMsg(err);
      samples[i] = { ok: false, status: statusFromErr(m), error: m };
      console.error(`  ✗ #${k} ${m}`);
    }
  });
  const summary = summarize(samples, Date.now() - t0, concurrency);
  writeJson(resolve(OUT_DIR, `bench-c${concurrency}-n${n}.json`), {
    at: new Date().toISOString(),
    kind: 'bench',
    ...summary,
    sampleUrls: urls.slice(0, 4),
  });
  console.log('\n=== fal bench summary ===');
  console.log(JSON.stringify(summary, null, 2));
}

// ── cli ───────────────────────────────────────────────────────────────────--
function parseArgs(argv: string[]) {
  const o: {
    command?: string;
    write: boolean;
    force: boolean;
    limit?: number;
    owner?: string;
    concurrency?: number;
    n?: number;
  } = { command: argv[0], write: false, force: false };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--write') o.write = true;
    else if (a === '--force') o.force = true;
    else if (a === '--limit') o.limit = Number(argv[++i]);
    else if (a === '--owner') o.owner = argv[++i];
    else if (a === '--concurrency' || a === '-c')
      o.concurrency = Number(argv[++i]);
    else if (a === '--n') o.n = Number(argv[++i]);
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  if (o.command === 'classify') return classify(o);
  if (o.command === 'bench') return bench(o);
  if (o.command === 'seed') return seed(o);
  console.log(`Usage:
  tsx scripts/ip-bulk-seed.ts classify [--limit N] [--force]                   # rows.json -> plan.json (genre)
  tsx scripts/ip-bulk-seed.ts bench [--n N] [--concurrency C]                  # fal load test ONLY (no DB)
  tsx scripts/ip-bulk-seed.ts seed [--write] [--limit N] [-c C] [--owner ID]   # plan.json -> posters + published IPs
                                                                               # OWNER_USER_ID = business@ (id 15)`);
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
});
