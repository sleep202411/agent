/**
 * Enrich the batch IPs (one Qwen call each):
 *   1. translate title + summary zh-CN -> en-US + zh-HK (Traditional), upsert
 *      IpLocalization (skip locales that already exist — don't clobber Phase 1).
 *   2. classify a REAL genre (the seed run used an invalid DASHSCOPE key and
 *      defaulted everything to "drama"), re-assign IpTaxonomyAssignment.
 * Uses the valid ALIBABA_API_KEY (dashscope-intl). Idempotent + resumable
 * (results-enrich.json tracks done ipIds).
 *
 *   DATABASE_URL=... tsx scripts/ip-3lang-translate.ts [--write] [--owner 15] [-c 8]
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { PrismaClient } from '@prisma/client';

const repoRoot = resolve(__dirname, '../../..');
loadDotenv({ path: resolve(repoRoot, 'apps/server/.env'), override: false });
const OUT = resolve(__dirname, '../outputs/ip-bulk-seed');
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
const clamp = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) : s);
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
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

const ALIBABA = process.env.ALIBABA_API_KEY?.trim();
const QWEN_URL =
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions';
async function enrich(
  title: string,
  summary: string,
): Promise<{
  en: { title: string; summary: string };
  hk: { title: string; summary: string };
  genre: string;
  region: string;
}> {
  const sys = `You localize and classify a Chinese short-drama IP.
1) Translate the title and synopsis into natural English and into Traditional Chinese (Hong Kong written style).
2) Pick the single best genre from EXACTLY this list: ${GENRES.join(', ')}.
3) Identify the story's primary country setting as an ISO 3166-1 alpha-2 code (e.g. CN, JP, MX, TH, IN, ID, VN, KR, SG, MY, EG, BR). If multinational or unclear, use "GLOBAL".
Return ONLY JSON: {"en":{"title":"","summary":""},"hk":{"title":"","summary":""},"genre":"<code>","region":"<ISO2 or GLOBAL>"}. Each summary < 460 chars. genre must be one code from the list verbatim.`;
  const res = await fetch(QWEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ALIBABA}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'qwen-plus',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        {
          role: 'user',
          content: JSON.stringify({ title, summary: clamp(summary, 600) }),
        },
      ],
    }),
  });
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const c = body.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(c.slice(c.indexOf('{'), c.lastIndexOf('}') + 1));
}

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const owner = (argv[argv.indexOf('--owner') + 1] || '15').trim();
  const concurrency = Number(argv[argv.indexOf('-c') + 1]) || 8;
  if (!ALIBABA) throw new Error('ALIBABA_API_KEY unset');
  type Row = { ipId: string; title: string; summary: string };
  const plan = JSON.parse(
    readFileSync(resolve(OUT, 'plan-3lang.json'), 'utf-8'),
  ) as Row[];

  const { buildPrisma } = (await import('../src/infra/db/db.module')) as {
    buildPrisma: () => PrismaClient;
  };
  const prisma = buildPrisma();
  const terms = await prisma.ipTaxonomyTerm.findMany({
    where: { type: 'genre', code: { in: GENRES } },
    select: { id: true, code: true },
  });
  const termIdByCode = new Map(terms.map((t) => [t.code, t.id]));
  const TARGETS = ['en-US', 'zh-HK'] as const;
  const existing = await prisma.ipLocalization.findMany({
    where: {
      ipId: { in: plan.map((p) => p.ipId) },
      locale: { in: [...TARGETS] },
    },
    select: { ipId: true, locale: true },
  });
  const have = new Set(existing.map((e) => `${e.ipId}:${e.locale}`));

  const RESULTS = resolve(OUT, 'results-enrich.json');
  const done: string[] = existsSync(RESULTS)
    ? JSON.parse(readFileSync(RESULTS, 'utf-8'))
    : [];
  const doneSet = new Set(done);
  const limit = Number(argv[argv.indexOf('--limit') + 1]) || Infinity;
  const todo = plan.filter((p) => !doneSet.has(p.ipId)).slice(0, limit);
  console.log(
    `${write ? 'WRITE' : 'DRY'} — enrich ${todo.length}/${plan.length} (done ${doneSet.size}); missing en/hk for ${plan.filter((p) => TARGETS.some((l) => !have.has(`${p.ipId}:${l}`))).length}`,
  );
  if (!write) {
    await prisma.$disconnect();
    return;
  }

  let ok = 0,
    fail = 0;
  await pool(todo, concurrency, async (p) => {
    try {
      const e = await enrich(p.title, p.summary || p.title);
      const now = new Date();
      for (const [locale, tr] of [
        ['en-US', e.en],
        ['zh-HK', e.hk],
      ] as const) {
        if (have.has(`${p.ipId}:${locale}`) || !tr?.title) continue;
        await prisma.ipLocalization.upsert({
          where: { ipId_locale: { ipId: p.ipId, locale } },
          update: {},
          create: {
            id: seedUuid('loc3', `${p.title}:${locale}`),
            ipId: p.ipId,
            locale,
            title: clamp(tr.title, 160),
            summary: clamp(tr.summary || tr.title, 480),
            description: tr.summary || null,
            status: 'machine_translated',
            translatedFromLocale: 'zh-CN',
            translationProvider: 'qwen-plus',
            publishedAt: now,
          },
        });
      }
      const genreCode = termIdByCode.has(e.genre) ? e.genre : DEFAULT_GENRE;
      const termId = termIdByCode.get(genreCode);
      if (termId) {
        await prisma.$transaction(async (tx) => {
          await tx.ipTaxonomyAssignment.deleteMany({
            where: { ipId: p.ipId, term: { is: { type: 'genre' } } },
          });
          await tx.ipTaxonomyAssignment.create({
            data: {
              id: seedUuid('asg3', `${p.title}:${genreCode}`),
              ipId: p.ipId,
              termId,
              source: 'admin',
              displayOrder: 0,
              createdById: owner,
            },
          });
        });
      }
      const region = /^[A-Z]{2}$/.test(e.region)
        ? e.region
        : e.region === 'GLOBAL'
          ? 'GLOBAL'
          : null;
      if (region)
        await prisma.ip.update({ where: { id: p.ipId }, data: { region } });
      done.push(p.ipId);
      ok++;
      if (ok % 25 === 0) {
        writeFileSync(RESULTS, JSON.stringify(done));
        console.log(`  …${ok}/${todo.length}`);
      }
    } catch (err) {
      fail++;
      console.error(
        `  ✗ ${p.title}: ${err instanceof Error ? err.message : err}`,
      );
    }
  });
  writeFileSync(RESULTS, JSON.stringify(done));
  console.log(`\nDONE enrich ok=${ok} fail=${fail}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
});
