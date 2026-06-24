/**
 * IP machine-translation — Phase 1. Reads each IP's source-locale IpLocalization
 * and machine-translates title/subtitle/summary/description into target locales
 * via Qwen (the same Alibaba key Spark uses), writing `status=machine_translated`
 * rows that the existing selectLocalization read path serves (human translations
 * always rank higher). Dry-run prints source vs translation; `--write` upserts.
 *
 * The translate() function below is the extractable core of a future Nest
 * TranslationService. No schema change (IpLocalization already has
 * translatedFromLocale / translationProvider / sourceHash / machine_translated).
 *
 *   tsx scripts/ip-translate.ts [--write] [--limit N] [--locales en-US,zh-HK] [--source zh-CN] [--owner 15]
 */
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
import type { PrismaClient } from '@prisma/client';

const repoRoot = resolve(__dirname, '../../..');
loadDotenv({ path: resolve(repoRoot, 'apps/server/.env'), override: false });

const PROVIDER = 'qwen';
const LLM_BASE =
  process.env.TRANSLATE_BASE_URL?.replace(/\/+$/, '') ||
  'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
const LLM_MODEL = process.env.TRANSLATE_MODEL?.trim() || 'qwen-plus';
const MAX_TITLE = 160;
const MAX_SUMMARY = 500;

const LOCALE_NAME: Record<string, string> = {
  'en-US': 'English (US)',
  'zh-CN': 'Simplified Chinese',
  'zh-HK': 'Traditional Chinese (Hong Kong)',
};

type Fields = {
  title: string;
  subtitle: string | null;
  summary: string;
  description: string | null;
};

const clamp = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Core: machine-translate the UGC fields. Extractable to TranslationService. */
async function translate(
  fields: Fields,
  from: string,
  to: string,
): Promise<Fields> {
  const key = (
    process.env.ALIBABA_API_KEY ||
    process.env.DASHSCOPE_API_KEY ||
    ''
  ).trim();
  if (!key) throw new Error('ALIBABA_API_KEY unset');
  const sys =
    `You are a professional localizer for a short-drama / IP platform. Translate the user's JSON ` +
    `fields from ${LOCALE_NAME[from] ?? from} to ${LOCALE_NAME[to] ?? to}. Keep proper nouns and ` +
    `title intent natural and idiomatic (a film-title feel for "title"); preserve tone; do NOT add ` +
    `or omit meaning. Return ONLY JSON with the same keys: {"title","subtitle","summary","description"}. ` +
    `Use null for any field that was null/empty.`;
  const res = await fetch(`${LLM_BASE}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: JSON.stringify(fields) },
      ],
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`qwen ${res.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text) as {
    choices?: { message?: { content?: string } }[];
  };
  const content = body.choices?.[0]?.message?.content ?? '{}';
  const json =
    content.slice(content.indexOf('{'), content.lastIndexOf('}') + 1) || '{}';
  const out = JSON.parse(json) as Partial<Fields>;
  return {
    title: clamp((out.title || fields.title).trim(), MAX_TITLE),
    subtitle: out.subtitle
      ? clamp(String(out.subtitle).trim(), MAX_TITLE)
      : null,
    summary: clamp((out.summary || fields.summary).trim(), MAX_SUMMARY),
    description: out.description ? String(out.description).trim() : null,
  };
}

const sourceHashOf = (f: Fields) =>
  createHash('sha1')
    .update(
      [f.title, f.subtitle ?? '', f.summary, f.description ?? ''].join(''),
    )
    .digest('hex')
    .slice(0, 64);

async function main() {
  const a = process.argv.slice(2);
  const write = a.includes('--write');
  const arg = (k: string) => {
    const i = a.indexOf(k);
    return i >= 0 ? a[i + 1] : undefined;
  };
  const limit = Number(arg('--limit')) || (write ? 1000 : 5);
  const source = arg('--source') || 'zh-CN';
  const targets = (arg('--locales') || 'en-US')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const owner = arg('--owner');

  const { buildPrisma } = (await import('../src/infra/db/db.module')) as {
    buildPrisma: () => PrismaClient;
  };
  const prisma = buildPrisma();

  const ips = await prisma.ip.findMany({
    where: {
      ...(owner ? { createdById: owner } : {}),
      localizations: { some: { locale: source } },
    },
    include: { localizations: true },
    orderBy: { updatedAt: 'desc' },
    take: limit,
  });
  console.log(
    `${write ? 'WRITE' : 'DRY-RUN'} — ${ips.length} IPs, ${source} -> [${targets.join(', ')}], model=${LLM_MODEL}\n`,
  );

  let translated = 0;
  let skipped = 0;
  for (const ip of ips) {
    const src = ip.localizations.find((l: any) => l.locale === source);
    if (!src) continue;
    const fields: Fields = {
      title: src.title,
      subtitle: src.subtitle ?? null,
      summary: src.summary ?? '',
      description: src.description ?? null,
    };
    for (const to of targets) {
      if (ip.localizations.some((l: any) => l.locale === to)) {
        skipped++;
        continue; // already has a localization (human or machine) — don't clobber
      }
      try {
        const out = await translate(fields, source, to);
        translated++;
        console.log(`[${to}] ${ip.id}`);
        console.log(`   title:   ${fields.title}   ->   ${out.title}`);
        console.log(`   summary: ${clamp(fields.summary, 60)}…`);
        console.log(`            -> ${clamp(out.summary, 90)}…`);
        if (write) {
          const now = new Date();
          await prisma.ipLocalization.upsert({
            where: { ipId_locale: { ipId: ip.id, locale: to } },
            update: {
              title: out.title,
              subtitle: out.subtitle,
              summary: out.summary,
              description: out.description,
              status: 'machine_translated',
              translatedFromLocale: source,
              translationProvider: PROVIDER,
              sourceHash: sourceHashOf(fields),
            },
            create: {
              ipId: ip.id,
              locale: to,
              status: 'machine_translated',
              title: out.title,
              subtitle: out.subtitle,
              summary: out.summary,
              description: out.description,
              translatedFromLocale: source,
              translationProvider: PROVIDER,
              sourceHash: sourceHashOf(fields),
              publishedAt: now,
            },
          });
        }
        await sleep(200);
      } catch (err) {
        console.error(
          `   ✗ [${to}] ${ip.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
    console.log('');
  }
  console.log(`DONE — translated=${translated} skipped(existing)=${skipped}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.stack : e);
  process.exitCode = 1;
});
