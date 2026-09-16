/**
 * Clean the messy source titles (Chinese mashed with Korean/English/SE-Asian
 * folklore fragments + the odd bare "中文" placeholder) via Qwen, and update the
 * IpLocalization.title for zh-CN / en-US / zh-HK. Only touches titles that
 * contain a non-Chinese script. Idempotent + resumable (results-cleantitle.json).
 *
 *   DATABASE_URL=... tsx scripts/ip-3lang-cleantitle.ts [--write] [-c 8]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { PrismaClient } from '@prisma/client';

const repoRoot = resolve(__dirname, '../../..');
loadDotenv({ path: resolve(repoRoot, 'apps/server/.env'), override: false });
const OUT = resolve(__dirname, '../outputs/ip-bulk-seed');
const clamp = (s: string, n: number) => (s && s.length > n ? s.slice(0, n) : s);
// Latin / Hangul / Thai / Kana / Arabic / Cyrillic → "messy" mixed-script title
const MESSY = /[A-Za-z぀-ヿ가-힯฀-๿؀-ۿЀ-ӿ]/;
async function pool<T>(items: T[], n: number, fn: (t: T) => Promise<void>) {
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) await fn(items[i++]);
    }),
  );
}

const ALIBABA = process.env.ALIBABA_API_KEY?.trim();
const SYS = `You clean a messy short-drama IP title that mixes Chinese with foreign fragments (Korean/English/SE-Asian folklore names) and sometimes a stray placeholder "中文". Output a clean, natural, READABLE title in Chinese, English, and Traditional Chinese (Hong Kong). Keep meaningful proper nouns / folklore creature names (transliterate or annotate in the target language); drop cross-language duplicates and any bare "中文" placeholder; keep titles reasonably concise. Return ONLY JSON {"zh":"","en":"","hk":""}.`;
async function cleanTitle(
  title: string,
  context: string,
): Promise<{ zh: string; en: string; hk: string }> {
  const res = await fetch(
    'https://dashscope-intl.aliyuncs.com/compatible-mode/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${ALIBABA}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen-plus',
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYS },
          {
            role: 'user',
            content: JSON.stringify({ title, context: clamp(context, 140) }),
          },
        ],
      }),
    },
  );
  const body = (await res.json()) as {
    choices?: { message?: { content?: string } }[];
  };
  const c = body.choices?.[0]?.message?.content ?? '{}';
  return JSON.parse(c.slice(c.indexOf('{'), c.lastIndexOf('}') + 1)) as Awaited<
    ReturnType<typeof cleanTitle>
  >;
}

async function main() {
  const argv = process.argv.slice(2);
  const write = argv.includes('--write');
  const concurrency = Number(argv[argv.indexOf('-c') + 1]) || 8;
  if (!ALIBABA) throw new Error('ALIBABA_API_KEY unset');
  type Row = { ipId: string; title: string; summary: string };
  const plan = (
    JSON.parse(readFileSync(resolve(OUT, 'plan-3lang.json'), 'utf-8')) as Row[]
  ).filter((p) => MESSY.test(p.title));

  const RESULTS = resolve(OUT, 'results-cleantitle.json');
  const done: string[] = existsSync(RESULTS)
    ? (JSON.parse(readFileSync(RESULTS, 'utf-8')) as string[])
    : [];
  const doneSet = new Set(done);
  const todo = plan.filter((p) => !doneSet.has(p.ipId));
  console.log(
    `${write ? 'WRITE' : 'DRY'} — messy titles to clean: ${todo.length}/${plan.length} (done ${doneSet.size})`,
  );
  if (!write) return;

  const { buildPrisma } = (await import('../src/infra/db/db.module.js'))
    .default as {
    buildPrisma: () => PrismaClient;
  };
  const prisma = buildPrisma();
  let ok = 0,
    fail = 0;
  await pool(todo, concurrency, async (p) => {
    try {
      const t = await cleanTitle(p.title, p.summary || '');
      for (const [locale, title] of [
        ['zh-CN', t.zh],
        ['en-US', t.en],
        ['zh-HK', t.hk],
      ] as const) {
        if (!title) continue;
        await prisma.ipLocalization.updateMany({
          where: { ipId: p.ipId, locale },
          data: { title: clamp(title, 160) },
        });
      }
      done.push(p.ipId);
      ok++;
      if (ok % 20 === 0) {
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
  console.log(`\nDONE cleantitle ok=${ok} fail=${fail}`);
  await prisma.$disconnect();
}
main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
});
