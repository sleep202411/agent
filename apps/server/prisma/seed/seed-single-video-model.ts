/**
 * LOCAL-ONLY surgical video catalog seed.
 *
 * - Upserts ONE slug from VIDEO_MODELS (no prune, no other modalities).
 * - Does NOT force-activate ops-disabled provider accounts.
 * - Does NOT touch production unless YOU set DATABASE_URL.
 * - Not wired into deploy. Do not run against prod without explicit approval.
 *
 *   npx tsx prisma/seed/seed-single-video-model.ts minimax-h3
 *   npx tsx prisma/seed/seed-single-video-model.ts minimax-h3 --apply
 */
import 'dotenv/config';

import { buildPrisma } from '../../src/infra/db/db.module';
import { seedSingleVideoModel } from './ai-catalog/seed-catalog';

type AccountSnap = {
  provider: string;
  status: string;
  archivedAt: string | null;
};
type BindingSnap = {
  provider: string;
  endpointId: string;
  status: string;
  archivedAt: string | null;
};

async function snapshotSafety(
  prisma: ReturnType<typeof buildPrisma>,
  slug: string,
) {
  const [otherCanonicals, accounts, foreignBindings] = await Promise.all([
    prisma.aiCanonicalModel.findMany({
      where: { modality: 'video', archivedAt: null, NOT: { slug } },
      select: { slug: true, status: true },
      orderBy: { slug: 'asc' },
    }),
    prisma.aiProviderAccount.findMany({
      select: { provider: true, status: true, archivedAt: true },
      orderBy: { provider: 'asc' },
    }),
    prisma.aiProviderModelBinding.findMany({
      where: { canonicalModel: { slug: { not: slug } } },
      select: {
        provider: true,
        endpointId: true,
        status: true,
        archivedAt: true,
      },
      orderBy: [{ provider: 'asc' }, { endpointId: 'asc' }],
    }),
  ]);
  return {
    otherCanonicals,
    accounts: accounts.map(
      (a): AccountSnap => ({
        provider: a.provider,
        status: a.status,
        archivedAt: a.archivedAt?.toISOString() ?? null,
      }),
    ),
    foreignBindings: foreignBindings.map(
      (b): BindingSnap => ({
        provider: b.provider,
        endpointId: b.endpointId,
        status: b.status,
        archivedAt: b.archivedAt?.toISOString() ?? null,
      }),
    ),
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2).filter((a) => a !== '--apply');
  const apply = process.argv.includes('--apply');
  const slug = args[0];
  if (!slug) {
    console.error(
      'Usage: tsx prisma/seed/seed-single-video-model.ts <slug> [--apply]',
    );
    process.exit(2);
  }
  if (!process.env.DATABASE_URL?.trim()) {
    console.error('DATABASE_URL required');
    process.exit(2);
  }

  const prisma = buildPrisma();
  await prisma.$connect();
  try {
    const before = await snapshotSafety(prisma, slug);
    console.log(
      `[seed-single] mode=${apply ? 'APPLY' : 'DRY-RUN'} slug=${slug}`,
    );
    console.log(
      `[seed-single] other video slugs: ${
        before.otherCanonicals.map((r) => r.slug).join(', ') || '(none)'
      }`,
    );
    if (!apply) {
      console.log('[seed-single] re-run with --apply to write');
      return;
    }
    const result = await seedSingleVideoModel(prisma, slug);
    console.log('[seed-single] result', result);
    const after = await snapshotSafety(prisma, slug);
    if (JSON.stringify(before) !== JSON.stringify(after)) {
      console.error(
        '[seed-single] SAFETY FAIL: other catalog/provider rows changed outside target slug',
      );
      console.error(JSON.stringify({ before, after }, null, 2).slice(0, 4000));
      process.exitCode = 2;
      return;
    }
    console.log(
      '[seed-single] SAFETY OK (canonical + accounts + foreign bindings)',
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
